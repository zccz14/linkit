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
use serde_json::{Map, json};
use sha2::{Digest, Sha256};
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

#[derive(Debug, Deserialize)]
pub struct RegisterInput {
    #[serde(default, alias = "devicetoken")]
    pub device_token: String,
    #[serde(default, alias = "device_key")]
    pub key: String,
}

#[derive(Clone, Debug)]
pub struct PushInput {
    pub title: String,
    pub body: String,
    pub group: String,
    pub id: Option<String>,
    pub url: String,
}

impl PushInput {
    pub fn message(
        title: String,
        body: String,
        group: String,
        id: Option<String>,
        url: String,
    ) -> Self {
        Self {
            title,
            body,
            group,
            id,
            url,
        }
    }

    fn apns_payload(&self) -> Result<Vec<u8>> {
        let mut aps = Map::new();
        aps.insert("mutable-content".to_owned(), json!(1));
        aps.insert(
            "alert".to_owned(),
            json!({"title": self.title, "body": self.body}),
        );
        aps.insert("category".to_owned(), json!("myNotificationCategory"));
        aps.insert("sound".to_owned(), json!("1107.caf"));
        aps.insert("thread-id".to_owned(), json!(self.group));
        let payload = serde_json::to_vec(&json!({ "aps": aps, "url": self.url }))?;
        if payload.len() > APNS_PAYLOAD_MAX_BYTES {
            bail!("notification exceeds the APNs 4 KiB payload limit");
        }
        Ok(payload)
    }
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
            Ok(value) => value,
            Err(env::VarError::NotPresent) => {
                return Ok(Self {
                    client,
                    config: None,
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
        })
    }

    pub fn configured(&self) -> bool {
        self.config.is_some()
    }

    #[cfg(test)]
    pub(crate) fn test_gateway() -> Self {
        Self {
            client: reqwest::Client::builder().no_proxy().build().unwrap(),
            config: Some(Arc::new(ApnsConfig {
                key_id: "test-key".to_owned(),
                team_id: "test-team".to_owned(),
                topic: "me.fin.bark".to_owned(),
                private_key_der: Vec::new(),
                jwt_cache: Mutex::new(None),
            })),
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
        headers.insert("apns-push-type", HeaderValue::from_static("alert"));
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
}

pub enum Delivery {
    Delivered,
    InvalidDeviceToken,
}

pub fn validate_device_token(device_token: &str) -> Result<()> {
    if device_token.is_empty() || device_token.len() > 160 {
        bail!("device token is invalid");
    }
    if !device_token
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        bail!("device token is invalid");
    }
    Ok(())
}

pub fn new_device_key() -> String {
    let mut value = u128::from_be_bytes(*Uuid::new_v4().as_bytes());
    let mut key = String::with_capacity(22);
    while value > 0 {
        key.push(char::from(
            BARK_KEY_ALPHABET[(value % BARK_KEY_ALPHABET.len() as u128) as usize],
        ));
        value /= BARK_KEY_ALPHABET.len() as u128;
    }
    while key.len() < BARK_KEY_MIN_LENGTH {
        key.push('2');
    }
    key
}

pub fn hash_secret(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_payload_stays_within_the_apns_limit() {
        let push = PushInput::message(
            "Linkit".to_owned(),
            "x".repeat(3_000),
            "conversation".to_owned(),
            Some("message".to_owned()),
            "https://linkit.test/#/conversations/conversation".to_owned(),
        );
        assert!(push.apns_payload().unwrap().len() <= APNS_PAYLOAD_MAX_BYTES);
    }

    #[test]
    fn notification_payload_keeps_the_conversation_url_thread_and_collapse_id() {
        let push = PushInput::message(
            "Linkit · Bot".to_owned(),
            "A message".to_owned(),
            "conversation".to_owned(),
            Some("message".to_owned()),
            "https://linkit.test/#/conversations/conversation".to_owned(),
        );
        let payload: serde_json::Value =
            serde_json::from_slice(&push.apns_payload().unwrap()).unwrap();
        assert_eq!(
            payload["url"],
            "https://linkit.test/#/conversations/conversation"
        );
        assert_eq!(payload["aps"]["thread-id"], "conversation");
        assert_eq!(push.id.as_deref(), Some("message"));
    }

    #[test]
    fn device_keys_are_nonempty_and_hashes_do_not_reveal_them() {
        let key = new_device_key();
        assert!(key.len() >= BARK_KEY_MIN_LENGTH);
        assert_ne!(hash_secret(&key), key);
    }
}
