use std::{
    env, fs,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, anyhow, bail};
use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use rand::{Rng, distr::Alphanumeric};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use ring::{
    rand::SystemRandom,
    signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

const APNS_ENDPOINT: &str = "https://api.push.apple.com/3/device/";
const APNS_PAYLOAD_MAX_BYTES: usize = 4096;

#[derive(Clone)]
pub struct BarkGateway {
    client: reqwest::Client,
    config: Option<Arc<ApnsConfig>>,
}

struct ApnsConfig {
    key_id: String,
    team_id: String,
    topic: String,
    private_key_der: Vec<u8>,
}

#[derive(Debug, Deserialize)]
pub struct RegisterInput {
    #[serde(default, alias = "devicetoken")]
    pub device_token: String,
    #[serde(default, alias = "device_key")]
    pub key: String,
}

#[derive(Clone, Debug)]
pub struct PushInput {
    pub device_key: String,
    pub title: String,
    pub subtitle: String,
    pub body: String,
    pub sound: String,
    pub id: Option<String>,
    pub extra: Map<String, Value>,
}

impl BarkGateway {
    pub fn disabled() -> Self {
        Self {
            client: reqwest::Client::new(),
            config: None,
        }
    }

    pub fn load() -> Result<Self> {
        let client = reqwest::Client::builder().build()?;
        let auth_key_path = match env::var("BARK_APNS_AUTH_KEY_PATH") {
            Ok(path) => path,
            Err(env::VarError::NotPresent) => return Ok(Self::disabled()),
            Err(error) => return Err(error.into()),
        };
        let key_id = required_env("BARK_APNS_KEY_ID")?;
        let team_id = required_env("BARK_APNS_TEAM_ID")?;
        let topic = required_env("BARK_APNS_TOPIC")?;
        let private_key_der = decode_pem_private_key(
            &fs::read(&auth_key_path)
                .with_context(|| format!("failed to read Bark APNs key from {auth_key_path}"))?,
        )?;
        EcdsaKeyPair::from_pkcs8(
            &ECDSA_P256_SHA256_FIXED_SIGNING,
            &private_key_der,
            &SystemRandom::new(),
        )
        .map_err(|_| anyhow!("BARK_APNS_AUTH_KEY_PATH is not an ES256 PKCS#8 key"))?;
        Ok(Self {
            client,
            config: Some(Arc::new(ApnsConfig {
                key_id,
                team_id,
                topic,
                private_key_der,
            })),
        })
    }

    pub fn configured(&self) -> bool {
        self.config.is_some()
    }

    #[cfg(test)]
    pub(crate) fn test_gateway() -> Self {
        Self {
            client: reqwest::Client::new(),
            config: Some(Arc::new(ApnsConfig {
                key_id: "test-key".to_owned(),
                team_id: "test-team".to_owned(),
                topic: "me.fin.bark".to_owned(),
                private_key_der: Vec::new(),
            })),
        }
    }

    pub async fn deliver(&self, device_token: &str, push: &PushInput) -> Result<Delivery> {
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| anyhow!("Bark APNs is not configured"))?;
        let payload = push.apns_payload()?;
        let authorization = format!("bearer {}", apns_jwt(config)?);
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&authorization).context("invalid APNs authorization")?,
        );
        headers.insert(
            "apns-topic",
            HeaderValue::from_str(&config.topic).context("invalid Bark APNs topic")?,
        );
        headers.insert(
            "apns-push-type",
            HeaderValue::from_static(if push.is_delete() {
                "background"
            } else {
                "alert"
            }),
        );
        let expiration = (chrono::Utc::now() + chrono::Duration::hours(24))
            .timestamp()
            .to_string();
        headers.insert(
            "apns-expiration",
            HeaderValue::from_str(&expiration).context("invalid APNs expiration")?,
        );
        if let Some(id) = push.id.as_deref() {
            headers.insert(
                "apns-collapse-id",
                HeaderValue::from_str(id).context("invalid Bark notification id")?,
            );
        }
        let response = self
            .client
            .post(format!("{APNS_ENDPOINT}{device_token}"))
            .headers(headers)
            .header(CONTENT_TYPE, "application/json")
            .body(payload)
            .send()
            .await
            .context("APNs request failed")?;
        let status = response.status();
        if status.is_success() {
            return Ok(Delivery::Delivered);
        }
        let reason = response.text().await.unwrap_or_default();
        if status.as_u16() == 410 || (status.as_u16() == 400 && reason.contains("BadDeviceToken")) {
            return Ok(Delivery::InvalidDeviceToken);
        }
        bail!("APNs rejected the notification with HTTP {status}")
    }
}

pub enum Delivery {
    Delivered,
    InvalidDeviceToken,
}

impl PushInput {
    pub fn from_params(mut params: Map<String, Value>) -> Self {
        let device_key = take_string(&mut params, "device_key").unwrap_or_default();
        let title = take_string(&mut params, "title").unwrap_or_default();
        let subtitle = take_string(&mut params, "subtitle").unwrap_or_default();
        let body = take_string(&mut params, "body").unwrap_or_default();
        let sound = take_string(&mut params, "sound").unwrap_or_else(|| "1107".to_owned());
        let id = params.get("id").and_then(Value::as_str).map(str::to_owned);
        Self {
            device_key,
            title,
            subtitle,
            body,
            sound,
            id,
            extra: params,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.device_key.is_empty() {
            bail!("device key is invalid");
        }
        Ok(())
    }

    fn is_delete(&self) -> bool {
        matches!(self.extra.get("delete"), Some(Value::String(value)) if value == "1")
            || matches!(self.extra.get("delete"), Some(Value::Number(value)) if value.as_i64() == Some(1))
    }

    fn apns_payload(&self) -> Result<Vec<u8>> {
        let mut aps = Map::new();
        aps.insert("mutable-content".to_owned(), json!(1));
        if self.is_delete() {
            aps.insert("content-available".to_owned(), json!(1));
        } else {
            let body = if self.title.is_empty() && self.subtitle.is_empty() && self.body.is_empty()
            {
                "Empty Message"
            } else {
                &self.body
            };
            aps.insert(
                "alert".to_owned(),
                json!({"title": self.title, "subtitle": self.subtitle, "body": body}),
            );
            aps.insert("category".to_owned(), json!("myNotificationCategory"));
            let sound = self
                .sound
                .strip_suffix(".caf")
                .map_or_else(|| format!("{}.caf", self.sound), ToOwned::to_owned);
            aps.insert("sound".to_owned(), json!(sound));
            if let Some(group) = self.extra.get("group").and_then(Value::as_str) {
                aps.insert("thread-id".to_owned(), json!(group));
            }
            if let Some(level) = self.apns_interruption_level() {
                aps.insert("interruption-level".to_owned(), json!(level));
            }
        }
        let mut payload = Map::new();
        payload.insert("aps".to_owned(), Value::Object(aps));
        for (key, value) in &self.extra {
            if let Value::Object(values) = value {
                for (key, value) in values {
                    payload.insert(key.to_ascii_lowercase(), bark_value(value));
                }
            } else {
                payload.insert(key.to_ascii_lowercase(), bark_value(value));
            }
        }
        let payload = serde_json::to_vec(&payload)?;
        if payload.len() > APNS_PAYLOAD_MAX_BYTES {
            bail!("notification exceeds the APNs 4 KiB payload limit");
        }
        Ok(payload)
    }

    fn apns_interruption_level(&self) -> Option<&'static str> {
        match self.extra.get("level").and_then(Value::as_str) {
            Some("critical") => Some("critical"),
            Some("active") => Some("active"),
            Some("timeSensitive" | "timesensitive") => Some("time-sensitive"),
            Some("passive") => Some("passive"),
            _ => None,
        }
    }
}

fn take_string(params: &mut Map<String, Value>, key: &str) -> Option<String> {
    let value = params.get(key)?.as_str()?.to_owned();
    params.remove(key);
    Some(value)
}

fn bark_value(value: &Value) -> Value {
    Value::String(match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Null => "<nil>".to_owned(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    })
}

pub async fn register_device(
    db: &SqlitePool,
    requested_key: &str,
    device_token: &str,
) -> Result<String> {
    validate_device_token(device_token)?;
    let key = if requested_key.is_empty() || !device_key_exists(db, requested_key).await? {
        new_device_key()
    } else {
        requested_key.to_owned()
    };
    let now = chrono::Utc::now().timestamp();
    sqlx::query("INSERT INTO bark_devices(key_hash,device_token,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET device_token=excluded.device_token,updated_at=excluded.updated_at")
        .bind(hash_key(&key))
        .bind(device_token)
        .bind(now)
        .bind(now)
        .execute(db)
        .await?;
    Ok(key)
}

pub async fn device_token_for_key(db: &SqlitePool, key: &str) -> Result<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT device_token FROM bark_devices WHERE key_hash=?")
            .bind(hash_key(key))
            .fetch_optional(db)
            .await?
            .filter(|token: &String| !token.is_empty()),
    )
}

pub async fn device_key_exists(db: &SqlitePool, key: &str) -> Result<bool> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM bark_devices WHERE key_hash=?")
            .bind(hash_key(key))
            .fetch_optional(db)
            .await?
            .is_some(),
    )
}

pub async fn invalidate_device_key(db: &SqlitePool, key: &str) -> Result<()> {
    sqlx::query("UPDATE bark_devices SET device_token='',updated_at=? WHERE key_hash=?")
        .bind(chrono::Utc::now().timestamp())
        .bind(hash_key(key))
        .execute(db)
        .await?;
    Ok(())
}

pub async fn device_count(db: &SqlitePool) -> Result<i64> {
    Ok(sqlx::query_scalar("SELECT COUNT(*) FROM bark_devices")
        .fetch_one(db)
        .await?)
}

fn required_env(name: &str) -> Result<String> {
    let value =
        env::var(name).with_context(|| format!("{name} is required when Bark APNs is enabled"))?;
    if value.is_empty() {
        bail!("{name} must not be empty");
    }
    Ok(value)
}

fn decode_pem_private_key(pem: &[u8]) -> Result<Vec<u8>> {
    let pem = std::str::from_utf8(pem).context("Bark APNs key is not UTF-8 PEM")?;
    let encoded = pem
        .lines()
        .filter(|line| !line.starts_with("---"))
        .collect::<String>();
    if encoded.is_empty() {
        bail!("Bark APNs key is empty");
    }
    STANDARD
        .decode(encoded)
        .context("Bark APNs key is not valid PEM")
}

fn apns_jwt(config: &ApnsConfig) -> Result<String> {
    let header = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({
        "alg": "ES256",
        "kid": config.key_id,
    }))?);
    let issued_at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let claims = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({
        "iss": config.team_id,
        "iat": issued_at,
    }))?);
    let signing_input = format!("{header}.{claims}");
    let key = EcdsaKeyPair::from_pkcs8(
        &ECDSA_P256_SHA256_FIXED_SIGNING,
        &config.private_key_der,
        &SystemRandom::new(),
    )
    .map_err(|_| anyhow!("Bark APNs key could not be loaded"))?;
    let signature = key
        .sign(&SystemRandom::new(), signing_input.as_bytes())
        .map_err(|_| anyhow!("Bark APNs JWT signing failed"))?;
    Ok(format!(
        "{signing_input}.{}",
        URL_SAFE_NO_PAD.encode(signature.as_ref())
    ))
}

fn new_device_key() -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn hash_key(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}

pub fn validate_device_token(device_token: &str) -> Result<()> {
    if device_token.is_empty() || device_token.len() > 160 {
        bail!("device token is invalid");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[tokio::test]
    async fn registration_returns_a_capability_key_and_updates_its_device_token() {
        let db = db::connect_memory().await.unwrap();
        let key = register_device(&db, "", "aabbccdd").await.unwrap();
        assert_eq!(key.len(), 32);
        assert_eq!(
            device_token_for_key(&db, &key).await.unwrap().as_deref(),
            Some("aabbccdd")
        );
        let same_key = register_device(&db, &key, "11223344").await.unwrap();
        assert_eq!(same_key, key);
        assert_eq!(
            device_token_for_key(&db, &key).await.unwrap().as_deref(),
            Some("11223344")
        );
        let stored_hash: String = sqlx::query_scalar("SELECT key_hash FROM bark_devices")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_ne!(stored_hash, key);

        invalidate_device_key(&db, &key).await.unwrap();
        assert!(device_token_for_key(&db, &key).await.unwrap().is_none());
        assert!(device_key_exists(&db, &key).await.unwrap());
        let restored_key = register_device(&db, &key, "deleted").await.unwrap();
        assert_eq!(restored_key, key);
        assert_eq!(
            device_token_for_key(&db, &key).await.unwrap().as_deref(),
            Some("deleted")
        );
    }

    #[test]
    fn push_payload_matches_bark_alert_shape() {
        let params = serde_json::from_value(json!({
            "device_key": "key",
            "title": "Linkit",
            "body": "New message",
            "sound": "minuet",
            "group": "conversation-1",
            "level": "timeSensitive",
            "badge": 3,
            "url": "https://linkit.ntnl.io/"
        }))
        .unwrap();
        let push = PushInput::from_params(params);
        let payload: Value = serde_json::from_slice(&push.apns_payload().unwrap()).unwrap();
        assert_eq!(payload["aps"]["alert"]["title"], "Linkit");
        assert_eq!(payload["aps"]["sound"], "minuet.caf");
        assert_eq!(payload["aps"]["thread-id"], "conversation-1");
        assert_eq!(payload["aps"]["interruption-level"], "time-sensitive");
        assert_eq!(payload["group"], "conversation-1");
        assert_eq!(payload["badge"], "3");
        assert_eq!(payload["url"], "https://linkit.ntnl.io/");
    }

    #[test]
    fn push_payload_uses_bark_defaults_and_delete_shape() {
        let params = serde_json::from_value(json!({
            "device_key": "key",
            "delete": 1,
            "level": "critical",
            "group": "urgent"
        }))
        .unwrap();
        let push = PushInput::from_params(params);
        let payload: Value = serde_json::from_slice(&push.apns_payload().unwrap()).unwrap();
        assert_eq!(payload["aps"]["content-available"], 1);
        assert_eq!(payload["delete"], "1");
        assert_eq!(payload["level"], "critical");
        assert!(payload["aps"].get("interruption-level").is_none());

        let push =
            PushInput::from_params(serde_json::from_value(json!({"device_key":"key"})).unwrap());
        let payload: Value = serde_json::from_slice(&push.apns_payload().unwrap()).unwrap();
        assert_eq!(payload["aps"]["sound"], "1107.caf");
        assert_eq!(payload["aps"]["alert"]["body"], "Empty Message");
    }

    #[test]
    fn push_payload_keeps_grouping_and_critical_alerts_in_the_apns_envelope() {
        let push = PushInput::from_params(
            serde_json::from_value(json!({
                "device_key": "key",
                "body": "Action required",
                "group": "operations",
                "level": "critical",
                "volume": 10
            }))
            .unwrap(),
        );
        let payload: Value = serde_json::from_slice(&push.apns_payload().unwrap()).unwrap();

        assert_eq!(payload["aps"]["thread-id"], "operations");
        assert_eq!(payload["aps"]["interruption-level"], "critical");
        assert_eq!(payload["group"], "operations");
        assert_eq!(payload["level"], "critical");
        assert_eq!(payload["volume"], "10");
    }
}
