//! Tetramote for desktops: shares this computer with paired devices and controls
//! other computers, from a menu bar (or tray) popover and a viewer window.

mod bitrate;
mod client;
mod clipboard;
mod commands;
mod host;
#[cfg(target_os = "macos")]
mod login_window;
mod pairing;
mod quality;
mod store;
mod system;
mod tray;

use std::sync::Arc;

use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::client::ClientService;
use crate::commands::AppState;
use crate::host::HostService;
use crate::store::Store;

fn open_links(app: &tauri::AppHandle, urls: impl IntoIterator<Item = String>) {
    let state = app.state::<AppState>();
    for url in urls {
        let Some(link) = url.strip_prefix("tetramote://") else {
            continue;
        };
        if let Err(message) = state.client.connect_link(link) {
            log::warn!("{message}");
        }
    }
}

/// `--login-window <config dir>` is the headless host launchd starts at the macOS login window.
pub fn run_from_args() {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(target_os = "macos")]
    if let Some(dir) = args
        .iter()
        .position(|a| a == login_window::FLAG)
        .and_then(|i| args.get(i + 1))
    {
        return login_window::run(dir.into());
    }
    let _ = args;
    run()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            open_links(app, args);
            tray::show(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let store = Arc::new(Store::open(app.path().app_config_dir()?));
            let handle = app.handle().clone();
            let host = HostService::new(
                Box::new(move |state| {
                    let _ = handle.emit("host-state", state);
                }),
                store.clone(),
            );
            let own = host.clone();
            let client = ClientService::new(app.handle().clone(), store.clone(), move || {
                own.endpoint_id()
            });
            host.start();
            app.manage(AppState {
                host,
                client,
                store,
            });
            tray::install(app.handle())?;

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                open_links(&handle, event.urls().into_iter().map(|u| u.to_string()));
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                open_links(app.handle(), urls.into_iter().map(|u| u.to_string()));
            }
            if let Ok(link) = std::env::var("TETRAMOTE_CONNECT") {
                open_links(app.handle(), [link]);
            }
            if std::env::var("TETRAMOTE_SHOW_POPOVER").is_ok() {
                tray::show(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match (window.label(), event) {
            (tray::POPOVER, WindowEvent::Focused(false)) => {
                if std::env::var("TETRAMOTE_SHOW_POPOVER").is_err() {
                    let _ = window.hide();
                }
            }
            (client::VIEWER, WindowEvent::Destroyed) => {
                window.app_handle().state::<AppState>().client.disconnect();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::host_state,
            commands::host_new_link,
            commands::host_remove,
            commands::host_disconnect,
            commands::request_permission,
            commands::settings_get,
            commands::set_relay,
            commands::client_state,
            commands::client_connect_link,
            commands::client_connect_saved,
            commands::client_forget,
            commands::client_disconnect,
            commands::viewer_attach,
            commands::viewer_input,
            commands::viewer_select_display,
            commands::viewer_set_audio,
            commands::viewer_set_hide_local_pointer,
            commands::viewer_keyframe,
            commands::app_quit,
            commands::login_window_get,
            commands::login_window_set,
        ])
        .build(tauri::generate_context!())
        .expect("Tetramote failed to start")
        .run(|_app, event| {
            if let RunEvent::ExitRequested {
                api, code: None, ..
            } = event
            {
                api.prevent_exit();
            }
        });
}
