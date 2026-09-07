use std::{collections::HashMap, path::Path, time::Duration};

use anyhow::{Result, ensure};
use sqlx::{
    Connection, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect(path: &Path) -> Result<SqlitePool> {
    let pool = connect_with(path, true, 4).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(pool)
}

#[cfg(test)]
pub async fn connect_memory() -> Result<SqlitePool> {
    let options = "sqlite::memory:"
        .parse::<SqliteConnectOptions>()?
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));
    migrate(
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?,
    )
    .await
}

async fn connect_with(path: &Path, create: bool, max_connections: u32) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(create)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5))
        .synchronous(SqliteSynchronous::Normal);
    migrate(
        SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect_with(options)
            .await?,
    )
    .await
}

async fn migrate(pool: SqlitePool) -> Result<SqlitePool> {
    let mut connection = pool.acquire().await?;
    sqlx::query("PRAGMA foreign_keys=OFF")
        .execute(&mut *connection)
        .await?;
    normalize_profile_usernames(&mut connection).await?;
    MIGRATOR.run(&mut *connection).await?;
    let violations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pragma_foreign_key_check")
        .fetch_one(&mut *connection)
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&mut *connection)
        .await?;
    ensure!(
        violations == 0,
        "database migration left {violations} foreign key violation(s)"
    );
    drop(connection);
    Ok(pool)
}

async fn normalize_profile_usernames(connection: &mut sqlx::SqliteConnection) -> Result<()> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='profiles'",
    )
    .fetch_one(&mut *connection)
    .await?;
    if exists == 0 {
        return Ok(());
    }
    let columns = sqlx::query_scalar::<_, String>("SELECT name FROM pragma_table_info('profiles')")
        .fetch_all(&mut *connection)
        .await?;
    if !columns.iter().any(|column| column == "display_name") {
        return Ok(());
    }
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT user_id,username FROM profiles")
        .fetch_all(&mut *connection)
        .await?;
    let mut normalized = HashMap::new();
    let mut seen = HashMap::new();
    for (user_id, username) in rows {
        let username = username.trim().to_owned();
        ensure!(
            !username.is_empty()
                && username.chars().count() <= 80
                && !username.chars().any(char::is_control),
            "profile {user_id} has an invalid username after trim"
        );
        let key = username.to_ascii_lowercase();
        if let Some(existing) = seen.insert(key, user_id.clone()) {
            ensure!(
                false,
                "username trim collision between profiles {existing} and {user_id}; resolve it before upgrading"
            );
        }
        normalized.insert(user_id, username);
    }
    let mut transaction = connection.begin().await?;
    for (user_id, username) in normalized {
        sqlx::query("UPDATE profiles SET username=? WHERE user_id=?")
            .bind(username)
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{SqliteConnection, sqlite::SqliteConnectOptions};

    #[tokio::test]
    async fn username_normalization_trims_legacy_rows_before_schema_rebuild() {
        let mut connection = SqliteConnection::connect_with(
            &"sqlite::memory:".parse::<SqliteConnectOptions>().unwrap(),
        )
        .await
        .unwrap();
        sqlx::query("CREATE TABLE profiles(user_id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL)")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO profiles(user_id,username,display_name) VALUES('one','  # / 😀  ','legacy')")
            .execute(&mut connection)
            .await
            .unwrap();
        normalize_profile_usernames(&mut connection).await.unwrap();
        let username: String =
            sqlx::query_scalar("SELECT username FROM profiles WHERE user_id='one'")
                .fetch_one(&mut connection)
                .await
                .unwrap();
        assert_eq!(username, "# / 😀");
    }

    #[tokio::test]
    async fn username_normalization_fails_before_schema_rebuild_on_trim_collision() {
        let mut connection = SqliteConnection::connect_with(
            &"sqlite::memory:".parse::<SqliteConnectOptions>().unwrap(),
        )
        .await
        .unwrap();
        sqlx::query("CREATE TABLE profiles(user_id TEXT PRIMARY KEY, username TEXT NOT NULL, display_name TEXT NOT NULL)")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO profiles(user_id,username,display_name) VALUES('one',' Alice ','legacy'),('two','alice','legacy')",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        let error = normalize_profile_usernames(&mut connection)
            .await
            .unwrap_err()
            .to_string();
        assert!(error.contains("username trim collision"));
    }

    #[tokio::test]
    async fn profile_intro_migration_renames_the_column_and_preserves_existing_content() {
        let mut connection = SqliteConnection::connect_with(
            &"sqlite::memory:".parse::<SqliteConnectOptions>().unwrap(),
        )
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE profiles(user_id TEXT PRIMARY KEY, username TEXT NOT NULL, motto TEXT NOT NULL)",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO profiles(user_id,username,motto) VALUES('one','alice','Existing introduction')",
        )
        .execute(&mut connection)
        .await
        .unwrap();

        sqlx::query(include_str!(
            "../migrations/20260907000000_profile_intro.sql"
        ))
        .execute(&mut connection)
        .await
        .unwrap();

        let columns =
            sqlx::query_scalar::<_, String>("SELECT name FROM pragma_table_info('profiles')")
                .fetch_all(&mut connection)
                .await
                .unwrap();
        assert!(columns.iter().any(|column| column == "intro"));
        assert!(!columns.iter().any(|column| column == "motto"));
        let intro: String = sqlx::query_scalar("SELECT intro FROM profiles WHERE user_id='one'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(intro, "Existing introduction");
    }

    #[tokio::test]
    async fn bot_user_migration_makes_bots_user_principals_and_group_members() {
        let mut connection = SqliteConnection::connect_with(
            &"sqlite::memory:".parse::<SqliteConnectOptions>().unwrap(),
        )
        .await
        .unwrap();
        sqlx::raw_sql(
            r#"
            CREATE TABLE users (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
            CREATE TABLE conversations (id TEXT PRIMARY KEY);
            CREATE TABLE conversation_members (
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              role TEXT NOT NULL CHECK(role IN ('member','owner')),
              joined_at INTEGER NOT NULL,
              PRIMARY KEY(conversation_id,user_id)
            );
            CREATE TABLE bots (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT NOT NULL REFERENCES users(id),
              name TEXT NOT NULL,
              token_prefix TEXT NOT NULL,
              token_hash TEXT NOT NULL UNIQUE,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE conversation_bots (
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
              added_at INTEGER NOT NULL,
              PRIMARY KEY(conversation_id,bot_id)
            );
            INSERT INTO users(id,created_at) VALUES('owner',1);
            INSERT INTO conversations(id) VALUES('group');
            INSERT INTO bots(id,owner_user_id,name,token_prefix,token_hash,created_at,updated_at)
            VALUES('bot','owner','Fund Bot','sk-prefix','hash',2,2);
            INSERT INTO conversation_bots(conversation_id,bot_id,added_at)
            VALUES('group','bot',3);
            "#,
        )
        .execute(&mut connection)
        .await
        .unwrap();

        sqlx::raw_sql(include_str!("../migrations/20260907000001_bot_users.sql"))
            .execute(&mut connection)
            .await
            .unwrap();

        let bot_type: String = sqlx::query_scalar("SELECT type FROM users WHERE id='bot'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        let owner_type: String = sqlx::query_scalar("SELECT type FROM users WHERE id='owner'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        let member_role: String = sqlx::query_scalar(
            "SELECT role FROM conversation_members WHERE conversation_id='group' AND user_id='bot'",
        )
        .fetch_one(&mut connection)
        .await
        .unwrap();
        let bot_user_fk: String = sqlx::query_scalar(
            "SELECT \"table\" FROM pragma_foreign_key_list('bots') WHERE \"from\"='id'",
        )
        .fetch_one(&mut connection)
        .await
        .unwrap();

        assert_eq!(bot_type, "bot");
        assert_eq!(owner_type, "human");
        assert_eq!(member_role, "member");
        assert_eq!(bot_user_fk, "users");
    }
}
