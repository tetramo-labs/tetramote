use std::sync::Arc;

use serde::Serialize;
use serde_json::json;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use crate::client::{ClientService, ClientState, ViewerInput};
use crate::host::{HostService, HostState};
use crate::store::Store;

pub struct AppState {
    pub host: Arc<HostService>,
    pub client: Arc<ClientService>,
    pub store: Arc<Store>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    relay_url: String,
    version: String,
    os: &'static str,
}

#[tauri::command]
pub fn host_state(state: State<AppState>) -> HostState {
    state.host.state()
}

#[tauri::command]
pub fn host_new_code(state: State<AppState>) {
    state.host.new_code();
}

#[tauri::command]
pub fn host_remove(state: State<AppState>, id: String) {
    state.host.remove(&id);
}

#[tauri::command]
pub fn host_disconnect(state: State<AppState>) {
    state.host.disconnect();
}

#[tauri::command]
pub fn request_permission(kind: String) {
    match kind.as_str() {
        "screenRecording" => tetra_media::request_screen_recording(),
        "accessibility" => tetra_media::request_accessibility(),
        _ => {}
    }
}

#[tauri::command]
pub fn settings_get(app: AppHandle, state: State<AppState>) -> SettingsView {
    SettingsView {
        relay_url: state.store.get().relay_url,
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
    }
}

/// Empty means n0's public relays; anything else must be an http(s) URL with a host.
pub fn valid_relay(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return true;
    }
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    rest.is_some_and(|r| !r.is_empty() && !r.starts_with('/') && !r.contains(char::is_whitespace))
}

#[tauri::command]
pub fn set_relay(state: State<AppState>, url: String) -> Result<(), String> {
    if !valid_relay(&url) {
        return Err("Enter a full https:// URL, or leave it empty for the public relays.".into());
    }
    state.store.update(|s| s.relay_url = url.trim().to_string());
    let host = state.host.clone();
    let client = state.client.clone();
    std::thread::spawn(move || {
        client.restart();
        host.restart();
    });
    Ok(())
}

#[tauri::command]
pub fn client_state(state: State<AppState>) -> ClientState {
    state.client.state()
}

#[tauri::command]
pub fn client_connect_link(state: State<AppState>, link: String) -> Result<(), String> {
    state.client.connect_link(&link)
}

#[tauri::command]
pub fn client_connect_saved(state: State<AppState>, id: String) -> Result<(), String> {
    state.client.connect_saved(&id)
}

#[tauri::command]
pub fn client_forget(state: State<AppState>, id: String) {
    state.client.forget(&id);
}

#[tauri::command]
pub fn client_disconnect(state: State<AppState>) {
    state.client.disconnect();
}

#[tauri::command]
pub fn viewer_attach(state: State<AppState>, frames: Channel<InvokeResponseBody>) {
    state.client.attach(frames);
}

#[tauri::command]
pub fn viewer_input(state: State<AppState>, events: Vec<ViewerInput>) {
    state.client.input(&events);
}

#[tauri::command]
pub fn viewer_select_display(state: State<AppState>, id: u64) {
    state
        .client
        .send_control(&json!({"t": "selectDisplay", "id": id}));
}

#[tauri::command]
pub fn viewer_set_audio(state: State<AppState>, enabled: bool) {
    state.client.set_audio(enabled);
}

#[tauri::command]
pub fn viewer_keyframe(state: State<AppState>) {
    state.client.send_control(&json!({"t": "keyframe"}));
}

#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::valid_relay;

    #[test]
    fn accepts_empty_and_http_urls_only() {
        assert!(valid_relay(""));
        assert!(valid_relay("https://relay.example.com"));
        assert!(valid_relay("http://10.0.0.2:3340/"));
        assert!(!valid_relay("relay.example.com"));
        assert!(!valid_relay("https://"));
        assert!(!valid_relay("ftp://relay"));
    }
}
