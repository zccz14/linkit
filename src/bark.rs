use std::{
    env, fs,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, anyhow, bail};
use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use ring::{
    rand::SystemRandom,
    signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use uuid::Uuid;

const APNS_ENDPOINT: &str = "https://api.push.apple.com/3/device/";
const APNS_PAYLOAD_MAX_BYTES: usize = 4096;
const APNS_JWT_TTL_SECONDS: u64 = 3_000;
const BARK_KEY_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BARK_KEY_MIN_LENGTH: usize = 13;

#[derive(Clone)]
pub struct BarkGateway {
    client: reqwest::Client,
    config: Option<Arc<ApnsConfig>>,
    basic_auth: Option<Arc<BarkBasicAuth>>,
    max_batch_push_count: i64,
}

struct ApnsConfig {
    key_id: String,
    team_id: String,
    topic: String,
    private_key_der: Vec<u8>,
    jwt_cache: Mutex<Option<CachedApnsJwt>>,
}

struct CachedApnsJwt {
    bearer: String,
    issued_at: u64,
}

struct BarkBasicAuth {
    username: String,
    password: String,
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
            basic_auth: bark_basic_auth(),
            max_batch_push_count: bark_max_batch_push_count().unwrap_or(-1),
        }
    }

    pub fn load() -> Result<Self> {
        let client = reqwest::Client::builder().build()?;
        let basic_auth = bark_basic_auth();
        let max_batch_push_count = bark_max_batch_push_count()?;
        let auth_key_path = match env::var("BARK_APNS_AUTH_KEY_PATH") {
            Ok(value) => value,
            Err(env::VarError::NotPresent) => {
                return Ok(Self {
                    client,
                    config: None,
                    basic_auth,
                    max_batch_push_count,
                });
            }
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
                jwt_cache: Mutex::new(None),
            })),
            basic_auth,
            max_batch_push_count,
        })
    }

    pub fn configured(&self) -> bool {
        self.config.is_some()
    }

    pub fn allows_batch_push_count(&self, count: usize) -> bool {
        self.max_batch_push_count == -1 || (count as i64) <= self.max_batch_push_count
    }

    pub fn allows_request(&self, authorization: Option<&str>) -> bool {
        let Some(basic_auth) = &self.basic_auth else {
            return true;
        };
        let Some(encoded) = authorization.and_then(|value| value.strip_prefix("Basic ")) else {
            return false;
        };
        let Ok(credentials) = STANDARD.decode(encoded) else {
            return false;
        };
        credentials == format!("{}:{}", basic_auth.username, basic_auth.password).as_bytes()
    }

    #[cfg(test)]
    pub(crate) fn test_gateway() -> Self {
        Self::test_gateway_with(None, -1)
    }

    #[cfg(test)]
    pub(crate) fn test_gateway_with(
        basic_auth: Option<(&str, &str)>,
        max_batch_push_count: i64,
    ) -> Self {
        Self {
            client: reqwest::Client::builder().no_proxy().build().unwrap(),
            config: Some(Arc::new(ApnsConfig {
                key_id: "test-key".to_owned(),
                team_id: "test-team".to_owned(),
                topic: "me.fin.bark".to_owned(),
                private_key_der: Vec::new(),
                jwt_cache: Mutex::new(None),
            })),
            basic_auth: basic_auth.map(|(username, password)| {
                Arc::new(BarkBasicAuth {
                    username: username.to_owned(),
                    password: password.to_owned(),
                })
            }),
            max_batch_push_count,
        }
    }

    pub async fn deliver(&self, device_token: &str, push: &PushInput) -> Result<Delivery> {
        let config = self
            .config
            .as_ref()
            .ok_or_else(|| anyhow!("Bark APNs is not configured"))?;
        let payload = push.apns_payload()?;
        #[cfg(test)]
        if config.private_key_der.is_empty() {
            return Ok(Delivery::Delivered);
        }
        let authorization = format!("bearer {}", cached_apns_jwt(config)?);
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
        if reason.is_empty() {
            bail!("APNs rejected the notification with HTTP {status}")
        }
        bail!(reason)
    }

    pub async fn notify(
        &self,
        endpoint: &str,
        device_key: &str,
        title: &str,
        body: &str,
        group: &str,
    ) -> Result<()> {
        let response = self
            .client
            .post(endpoint)
            .json(&json!({
                "device_key": device_key,
                "title": title,
                "body": body,
                "group": group,
            }))
            .send()
            .await
            .context("Bark notification request failed")?;
        if response.status().is_success() {
            return Ok(());
        }
        let status = response.status();
        let reason = response.text().await.unwrap_or_default();
        if reason.is_empty() {
            bail!("Bark notification failed with HTTP {status}")
        }
        bail!("Bark notification failed: {reason}")
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
            bail!("device key is empty");
        }
        Ok(())
    }

    fn is_delete(&self) -> bool {
        matches!(self.extra.get("delete"), Some(Value::String(value)) if value == "1")
            || matches!(self.extra.get("delete"), Some(Value::Number(value)) if value.as_f64() == Some(1.0))
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

pub async fn device_token_by_key(db: &SqlitePool, key: &str) -> Result<String> {
    let token: String =
        sqlx::query_scalar("SELECT device_token FROM bark_devices WHERE key_hash=?")
            .bind(hash_key(key))
            .fetch_optional(db)
            .await?
            .ok_or_else(|| anyhow!("failed to get [{key}] device token from database"))?;
    if token.is_empty() {
        bail!("device token invalid");
    }
    Ok(token)
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

fn bark_basic_auth() -> Option<Arc<BarkBasicAuth>> {
    let username = env::var("BARK_SERVER_BASIC_AUTH_USER").unwrap_or_default();
    let password = env::var("BARK_SERVER_BASIC_AUTH_PASSWORD").unwrap_or_default();
    (!(username.is_empty() && password.is_empty()))
        .then(|| Arc::new(BarkBasicAuth { username, password }))
}

fn bark_max_batch_push_count() -> Result<i64> {
    match env::var("BARK_SERVER_MAX_BATCH_PUSH_COUNT") {
        Ok(value) => value
            .parse()
            .with_context(|| "BARK_SERVER_MAX_BATCH_PUSH_COUNT must be an integer"),
        Err(env::VarError::NotPresent) => Ok(-1),
        Err(error) => Err(error.into()),
    }
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

fn cached_apns_jwt(config: &ApnsConfig) -> Result<String> {
    cached_apns_jwt_at(config, unix_timestamp()?)
}

fn cached_apns_jwt_at(config: &ApnsConfig, now: u64) -> Result<String> {
    let mut cache = config
        .jwt_cache
        .lock()
        .map_err(|_| anyhow!("Bark APNs JWT cache lock is poisoned"))?;
    if let Some(cached) = cache
        .as_ref()
        .filter(|cached| now >= cached.issued_at && now - cached.issued_at < APNS_JWT_TTL_SECONDS)
    {
        return Ok(cached.bearer.clone());
    }
    let bearer = apns_jwt(config, now)?;
    *cache = Some(CachedApnsJwt {
        bearer: bearer.clone(),
        issued_at: now,
    });
    Ok(bearer)
}

fn unix_timestamp() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs())
}

fn apns_jwt(config: &ApnsConfig, issued_at: u64) -> Result<String> {
    let header = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({
        "alg": "ES256",
        "kid": config.key_id,
    }))?);
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
    let mut value = u128::from_be_bytes(*Uuid::new_v4().as_bytes());
    let mut key = String::with_capacity(22);
    while value > 0 {
        key.push(char::from(
            BARK_KEY_ALPHABET[(value % BARK_KEY_ALPHABET.len() as u128) as usize],
        ));
        value /= BARK_KEY_ALPHABET.len() as u128;
    }
    while key.len() < BARK_KEY_MIN_LENGTH {
        key.push(char::from(BARK_KEY_ALPHABET[0]));
    }
    key
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

    fn apns_config_for_jwt_tests() -> ApnsConfig {
        let private_key_der =
            EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
                .unwrap();
        ApnsConfig {
            key_id: "test-key".to_owned(),
            team_id: "test-team".to_owned(),
            topic: "me.fin.bark".to_owned(),
            private_key_der: private_key_der.as_ref().to_vec(),
            jwt_cache: Mutex::new(None),
        }
    }

    #[test]
    fn apns_provider_jwt_is_reused_for_fifty_minutes_then_refreshed() {
        let config = apns_config_for_jwt_tests();
        let issued_at = 1_700_000_000;

        let first = cached_apns_jwt_at(&config, issued_at).unwrap();
        let cached = cached_apns_jwt_at(&config, issued_at + APNS_JWT_TTL_SECONDS - 1).unwrap();
        let refreshed = cached_apns_jwt_at(&config, issued_at + APNS_JWT_TTL_SECONDS).unwrap();

        assert_eq!(cached, first);
        assert_ne!(refreshed, first);
    }

    #[test]
    fn apns_provider_jwt_cache_is_safe_for_concurrent_pushes() {
        let config = Arc::new(apns_config_for_jwt_tests());
        let start = Arc::new(std::sync::Barrier::new(8));
        let issued_at = 1_700_000_000;
        let tokens = std::thread::scope(|scope| {
            (0..8)
                .map(|_| {
                    let config = Arc::clone(&config);
                    let start = Arc::clone(&start);
                    scope.spawn(move || {
                        start.wait();
                        cached_apns_jwt_at(&config, issued_at).unwrap()
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .collect::<Vec<_>>()
        });

        assert!(tokens.windows(2).all(|tokens| tokens[0] == tokens[1]));
    }

    #[tokio::test]
    async fn registration_returns_a_capability_key_and_updates_its_device_token() {
        let db = db::connect_memory().await.unwrap();
        let key = register_device(&db, "", "aabbccdd").await.unwrap();
        assert!((BARK_KEY_MIN_LENGTH..=22).contains(&key.len()));
        assert!(key.bytes().all(|byte| BARK_KEY_ALPHABET.contains(&byte)));
        assert_eq!(
            device_token_for_key(&db, &key).await.unwrap().as_deref(),
            Some("aabbccdd")
        );
        assert_eq!(device_token_by_key(&db, &key).await.unwrap(), "aabbccdd");
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

    #[test]
    fn push_payload_keeps_the_bark_icon_field_for_the_ios_service_extension() {
        let push = PushInput::from_params(
            serde_json::from_value(json!({
                "device_key": "key",
                "body": "Icon message",
                "icon": "https://example.test/avatar.jpg"
            }))
            .unwrap(),
        );
        let payload: Value = serde_json::from_slice(&push.apns_payload().unwrap()).unwrap();

        assert_eq!(payload["aps"]["mutable-content"], 1);
        assert_eq!(payload["aps"]["category"], "myNotificationCategory");
        assert_eq!(payload["icon"], "https://example.test/avatar.jpg");
    }

    #[test]
    fn bark_server_settings_match_basic_auth_and_batch_rules() {
        let gateway = BarkGateway::test_gateway_with(Some(("bark", "pass")), 2);

        assert!(!gateway.allows_request(None));
        assert!(!gateway.allows_request(Some("Basic YmFjazpiYWQ=")));
        assert!(gateway.allows_request(Some("Basic YmFyazpwYXNz")));
        assert!(gateway.allows_batch_push_count(2));
        assert!(!gateway.allows_batch_push_count(3));
    }
}
