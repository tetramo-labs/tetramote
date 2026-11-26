use std::fs;
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Renaming these gives this computer a new iroh identity, and every device
/// paired with it would have to pair again.
const KEY_SERVICE: &str = "com.tetramo.tetramote.host";
const HOST_KEY_ACCOUNT: &str = "endpoint-secret-key";
const CLIENT_KEY_ACCOUNT: &str = "client-secret-key";
const LINK_SECRET_ACCOUNT: &str = "link-secret";
const LOGIN_WINDOW_FILE: &str = "login-window.json";

/// What the login-window host needs and can't read from the locked login keychain. The app writes it, readable
/// only by this user and root, while Open at boot is on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LoginWindowSecrets {
    host_key: String,
    link_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: String,
    pub name: String,
    pub paired_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedHost {
    pub id: String,
    pub name: String,
    pub ticket: String,
    pub last_connected_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub relay_url: String,
    pub trusted: Vec<PairedDevice>,
    pub hosts: Vec<SavedHost>,
    pub play_audio: bool,
    pub hide_local_pointer: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            relay_url: String::new(),
            trusted: Vec::new(),
            hosts: Vec::new(),
            play_audio: true,
            hide_local_pointer: false,
        }
    }
}

pub struct Store {
    path: PathBuf,
    settings: Mutex<Settings>,
    profile: Option<String>,
    login_window: Option<Mutex<LoginWindowSecrets>>,
}

impl Store {
    /// `TETRAMOTE_PROFILE` gives test runs their own settings file and keys, so
    /// they never touch (or prompt for) the real ones.
    pub fn open(dir: PathBuf) -> Self {
        let profile = std::env::var("TETRAMOTE_PROFILE")
            .ok()
            .filter(|p| !p.is_empty());
        let file = profile.as_ref().map_or("settings.json".to_string(), |p| {
            format!("settings.{p}.json")
        });
        let path = dir.join(file);
        let settings = fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Self {
            path,
            settings: Mutex::new(settings),
            profile,
            login_window: None,
        }
    }

    /// The login-window host's store: this user's settings, with the key and link secret from the file the app
    /// wrote. `None` when Open at boot is off.
    pub fn open_login_window(dir: PathBuf) -> Option<Self> {
        let secrets = fs::read(dir.join(LOGIN_WINDOW_FILE))
            .ok()
            .and_then(|b| serde_json::from_slice::<LoginWindowSecrets>(&b).ok())?;
        let path = dir.join("settings.json");
        let settings = fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Some(Self {
            path,
            settings: Mutex::new(settings),
            profile: None,
            login_window: Some(Mutex::new(secrets)),
        })
    }

    pub fn dir(&self) -> PathBuf {
        self.path.parent().map(PathBuf::from).unwrap_or_default()
    }

    fn login_window_path(&self) -> PathBuf {
        self.path.with_file_name(
            self.profile
                .as_ref()
                .map_or(LOGIN_WINDOW_FILE.to_string(), |p| {
                    format!("login-window.{p}.json")
                }),
        )
    }

    pub fn login_window_enabled(&self) -> bool {
        self.login_window_path().exists()
    }

    pub fn write_login_window_secrets(&self) -> Result<(), String> {
        let secrets = LoginWindowSecrets {
            host_key: self.host_key()?,
            link_secret: self.link_secret()?,
        };
        let json = serde_json::to_vec(&secrets).map_err(|e| e.to_string())?;
        let path = self.login_window_path();
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::remove_file(&path);
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        options
            .open(&path)
            .and_then(|mut file| file.write_all(&json))
            .map_err(|e| {
                format!("Saving this computer's key for the login screen failed ({e}). Turn Open at boot on again.")
            })
    }

    pub fn remove_login_window_secrets(&self) {
        let _ = fs::remove_file(self.login_window_path());
    }

    pub fn get(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update(&self, f: impl FnOnce(&mut Settings)) -> Settings {
        let mut settings = self.settings.lock().unwrap();
        f(&mut settings);
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec_pretty(&*settings) {
            let _ = fs::write(&self.path, json);
        }
        settings.clone()
    }

    pub fn host_key(&self) -> Result<String, String> {
        if let Some(secrets) = &self.login_window {
            return Ok(secrets.lock().unwrap().host_key.clone());
        }
        key(&self.account(HOST_KEY_ACCOUNT))
    }

    pub fn client_key(&self) -> Result<String, String> {
        key(&self.account(CLIENT_KEY_ACCOUNT))
    }

    /// The secret in this computer's shared link, created on first use and kept until "New link" replaces it.
    pub fn link_secret(&self) -> Result<String, String> {
        if let Some(secrets) = &self.login_window {
            return Ok(secrets.lock().unwrap().link_secret.clone());
        }
        let entry = entry(&self.account(LINK_SECRET_ACCOUNT))?;
        match entry.get_password() {
            Ok(existing) if is_link_secret(&existing) => Ok(existing),
            _ => {
                let created = crate::pairing::new_secret();
                save_link_secret(&entry, &created)?;
                Ok(created)
            }
        }
    }

    /// A new link reaches the login-window host too, so the old link stops working there as well.
    pub fn set_link_secret(&self, secret: &str) -> Result<(), String> {
        if let Some(secrets) = &self.login_window {
            secrets.lock().unwrap().link_secret = secret.to_string();
            return Ok(());
        }
        save_link_secret(&entry(&self.account(LINK_SECRET_ACCOUNT))?, secret)?;
        if self.login_window_enabled() {
            self.write_login_window_secrets()?;
        }
        Ok(())
    }

    fn account(&self, base: &str) -> String {
        self.profile
            .as_ref()
            .map_or(base.to_string(), |p| format!("{base}.{p}"))
    }
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEY_SERVICE, account).map_err(|e| {
        format!("The system keychain isn't available ({e}). Unlock it and restart Tetramote.")
    })
}

fn is_link_secret(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn save_link_secret(entry: &keyring::Entry, secret: &str) -> Result<(), String> {
    entry.set_password(secret).map_err(|e| {
        format!("Saving this computer's link to the keychain failed ({e}). Unlock the keychain, then make a new link again.")
    })
}

fn key(account: &str) -> Result<String, String> {
    let entry = entry(account)?;
    match entry.get_password() {
        Ok(existing) if existing.len() == 64 => Ok(existing),
        _ => {
            let created = tetra_core::net::generate_secret_key();
            entry
                .set_password(&created)
                .map_err(|e| format!("Saving this computer's key to the keychain failed ({e}). Unlock it and restart Tetramote."))?;
            Ok(created)
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
