use sha2::{Digest, Sha256};
use sqlx::{Sqlite, SqlitePool, Transaction};

use crate::AppError;

pub(crate) async fn ensure(db: &SqlitePool, user_id: &str) -> Result<(), AppError> {
    let ready: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND u.type='human')",
    ).bind(user_id).fetch_one(db).await?;
    if ready {
        return Ok(());
    }
    let mut tx = db.begin().await?;
    ensure_human(&mut tx, user_id, chrono::Utc::now().timestamp()).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn ensure_human(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    now: i64,
) -> Result<(), AppError> {
    // INVARIANT: write before reading so concurrent creators serialize on SQLite's
    // writer lock, rather than trying to upgrade a stale read transaction.
    sqlx::query(
        "INSERT INTO users(id,type,created_at) VALUES(?,'human',?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(user_id)
    .bind(now)
    .execute(&mut **tx)
    .await?;
    let user_type: String = sqlx::query_scalar("SELECT type FROM users WHERE id=?")
        .bind(user_id)
        .fetch_one(&mut **tx)
        .await?;
    if user_type != "human" {
        return Err(AppError::unauthorized("invalid or expired bearer token"));
    }
    ensure_profile(tx, user_id, now).await
}

async fn ensure_profile(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    now: i64,
) -> Result<(), AppError> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id=?)")
        .bind(user_id)
        .fetch_one(&mut **tx)
        .await?;
    if exists {
        return Ok(());
    }
    let base = default_username(user_id);
    let mut username = base.clone();
    let mut suffix = 1_u64;
    loop {
        let result = sqlx::query(
            "INSERT INTO profiles(user_id,username,intro,updated_at) VALUES(?,?,'',?) ON CONFLICT(username) DO NOTHING",
        ).bind(user_id).bind(&username).bind(now).execute(&mut **tx).await?;
        if result.rows_affected() == 1 {
            return Ok(());
        }
        // RECOVERY: a chosen/custom username already occupies this candidate.
        // The writer lock keeps this finite search stable; other errors propagate.
        suffix += 1;
        username = format!("{base}_{suffix}");
    }
}

fn default_username(user_id: &str) -> String {
    let digest = format!("{:x}", Sha256::digest(user_id.as_bytes()));
    format!("user_{}", &digest[..12])
}

pub(crate) async fn backfill(db: &SqlitePool) -> Result<(), AppError> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT u.id FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.type='human' AND p.user_id IS NULL ORDER BY u.id",
    ).fetch_all(db).await?;
    let now = chrono::Utc::now().timestamp();
    let mut tx = db.begin().await?;
    for id in ids {
        ensure_human(&mut tx, &id, now).await?;
    }
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use axum::http::StatusCode;
    use uuid::Uuid;

    use super::*;

    #[tokio::test]
    async fn ensure_creates_an_editable_default_profile_and_is_idempotent() {
        let db = crate::db::connect_memory().await.unwrap();
        let id = "550e8400-e29b-41d4-a716-446655440000";
        ensure(&db, id).await.unwrap();
        let before = crate::profile_for_user(&db, id).await.unwrap().unwrap();
        assert_eq!(before.username, default_username(id));
        assert_eq!(before.username.len(), 17);
        assert!(before.intro.is_empty());
        assert!(before.avatar_attachment_id.is_none());
        for _ in 0..3 {
            ensure(&db, id).await.unwrap();
        }
        let after = crate::profile_for_user(&db, id).await.unwrap().unwrap();
        assert_eq!(before.username, after.username);
        assert_eq!(before.updated_at, after.updated_at);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 1);
        sqlx::query("UPDATE profiles SET username='Custom name',intro='Custom intro',avatar_attachment_id='avatar',updated_at=7 WHERE user_id=?")
            .bind(id).execute(&db).await.unwrap();
        let mut tx = db.begin().await.unwrap();
        ensure_human(&mut tx, id, 123).await.unwrap();
        tx.commit().await.unwrap();
        ensure(&db, id).await.unwrap();
        let custom = crate::profile_for_user(&db, id).await.unwrap().unwrap();
        assert_eq!(custom.username, "Custom name");
        assert_eq!(custom.intro, "Custom intro");
        assert_eq!(custom.avatar_attachment_id.as_deref(), Some("avatar"));
        assert_eq!(custom.updated_at, 7);
    }

    #[tokio::test]
    async fn default_username_collisions_respect_case_insensitive_uniqueness() {
        let db = crate::db::connect_memory().await.unwrap();
        let base = default_username("new-user");
        for (id, username) in [
            ("first", base.to_uppercase()),
            ("second", format!("{base}_2")),
        ] {
            sqlx::query("INSERT INTO users(id,created_at) VALUES(?,1)")
                .bind(id)
                .execute(&db)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO profiles(user_id,username,intro,updated_at) VALUES(?,?,'kept',1)",
            )
            .bind(id)
            .bind(username)
            .execute(&db)
            .await
            .unwrap();
        }
        ensure(&db, "new-user").await.unwrap();
        let profile = crate::profile_for_user(&db, "new-user")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(profile.username, format!("{base}_3"));
        assert_eq!(
            crate::profile_for_user(&db, "first")
                .await
                .unwrap()
                .unwrap()
                .username,
            base.to_uppercase()
        );
    }

    #[tokio::test]
    async fn a_profile_failure_rolls_back_the_new_user() {
        let db = crate::db::connect_memory().await.unwrap();
        sqlx::query("CREATE TRIGGER reject_profiles BEFORE INSERT ON profiles BEGIN SELECT RAISE(ABORT, 'test profile failure'); END")
            .execute(&db).await.unwrap();
        assert_eq!(
            ensure(&db, "new-user").await.unwrap_err().status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn a_bot_identity_cannot_be_silently_converted_to_a_human() {
        let db = crate::db::connect_memory().await.unwrap();
        sqlx::query("INSERT INTO users(id,type,created_at) VALUES('bot','bot',1)")
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(
            ensure(&db, "bot").await.unwrap_err().status,
            StatusCode::UNAUTHORIZED
        );
        assert!(crate::profile_for_user(&db, "bot").await.unwrap().is_none());
        let kind: String = sqlx::query_scalar("SELECT type FROM users WHERE id='bot'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(kind, "bot");
    }

    #[tokio::test]
    async fn startup_backfills_existing_humans_without_changing_profiles_or_bots() {
        let dir = std::env::temp_dir().join(format!("linkit-profile-backfill-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("test.sqlite3");
        let db = crate::db::connect(&path).await.unwrap();
        sqlx::query("INSERT INTO users(id,type,created_at) VALUES('missing','human',10),('custom','human',11),('bot','bot',12)").execute(&db).await.unwrap();
        sqlx::query("INSERT INTO profiles(user_id,username,intro,updated_at) VALUES('custom','Custom','preserved',11)").execute(&db).await.unwrap();
        db.close().await;
        let db = crate::db::connect(&path).await.unwrap();
        let missing = crate::profile_for_user(&db, "missing")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(missing.username, default_username("missing"));
        let created: i64 = sqlx::query_scalar("SELECT created_at FROM users WHERE id='missing'")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(created, 10);
        let custom = crate::profile_for_user(&db, "custom")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(custom.username, "Custom");
        assert_eq!(custom.intro, "preserved");
        assert_eq!(custom.updated_at, 11);
        assert!(crate::profile_for_user(&db, "bot").await.unwrap().is_none());
        backfill(&db).await.unwrap();
        assert_eq!(
            crate::profile_for_user(&db, "missing")
                .await
                .unwrap()
                .unwrap()
                .updated_at,
            missing.updated_at
        );
        db.close().await;
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn concurrent_first_requests_create_one_profile_and_existing_accounts_need_no_write_lock()
    {
        let dir =
            std::env::temp_dir().join(format!("linkit-profile-concurrent-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let db = crate::db::connect(&dir.join("test.sqlite3")).await.unwrap();
        let mut tasks = tokio::task::JoinSet::new();
        for _ in 0..16 {
            let db = db.clone();
            tasks.spawn(async move { ensure(&db, "parallel-user").await });
        }
        while let Some(result) = tasks.join_next().await {
            result.unwrap().unwrap();
        }
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profiles")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let mut writer = db.begin().await.unwrap();
        sqlx::query("UPDATE users SET created_at=1 WHERE id='parallel-user'")
            .execute(&mut *writer)
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), ensure(&db, "parallel-user"))
            .await
            .unwrap()
            .unwrap();
        writer.rollback().await.unwrap();
        db.close().await;
        std::fs::remove_dir_all(dir).unwrap();
    }
}
