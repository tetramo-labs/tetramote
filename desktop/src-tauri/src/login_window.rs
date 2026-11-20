//! Open at boot on macOS. A launch agent limited to the LoginWindow session runs this binary as a headless
//! host (`--login-window <config dir>`) whenever the login window shows, so paired devices can log in after a
//! restart. launchd stops it when someone logs in, and the app takes over. Installing or removing the agent needs an
//! administrator password; the key it uses is in the app's config dir, readable only by this user and root.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use crate::host::HostService;
use crate::store::Store;

pub const FLAG: &str = "--login-window";
const LABEL: &str = "com.tetramo.tetramote.loginwindow";
const PLIST: &str = "/Library/LaunchAgents/com.tetramo.tetramote.loginwindow.plist";
const LOG: &str = "/private/tmp/com.tetramo.tetramote.loginwindow.log";
const PROMPT: &str =
    "Tetramote needs your password to let paired devices connect at the login screen.";

fn xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Exits cleanly when Open at boot is off, and launchd only restarts a crash.
pub fn plist(exe: &Path, config_dir: &Path) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{LABEL}</string>
	<key>LimitLoadToSessionType</key>
	<string>LoginWindow</string>
	<key>ProgramArguments</key>
	<array>
		<string>{}</string>
		<string>{FLAG}</string>
		<string>{}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardErrorPath</key>
	<string>{LOG}</string>
</dict>
</plist>
"#,
        xml(&exe.to_string_lossy()),
        xml(&config_dir.to_string_lossy()),
    )
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn run_as_admin(command: &str) -> Result<(), String> {
    let script = format!(
        "do shell script {} with administrator privileges with prompt {}",
        applescript_string(command),
        applescript_string(PROMPT)
    );
    let out = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| {
            format!("macOS couldn't ask for an administrator password ({e}). Try again.")
        })?;
    if out.status.success() {
        return Ok(());
    }
    let error = String::from_utf8_lossy(&out.stderr);
    if error.contains("-128") {
        return Err(
            "Open at boot needs an administrator password. Turn it on again to enter one.".into(),
        );
    }
    Err(format!(
        "Turning on Open at boot failed ({}). Try again.",
        error.trim()
    ))
}

fn exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("Tetramote couldn't find its own app ({e})."))
}

/// On only while the installed agent starts this copy of the app with this store's key.
pub fn enabled(store: &Store) -> bool {
    let Ok(exe) = exe() else { return false };
    store.login_window_enabled()
        && fs::read_to_string(PLIST).is_ok_and(|installed| installed == plist(&exe, &store.dir()))
}

pub fn enable(store: &Store) -> Result<(), String> {
    let exe = exe()?;
    store.write_login_window_secrets()?;
    let staged = std::env::temp_dir().join(format!("{LABEL}.plist"));
    fs::write(&staged, plist(&exe, &store.dir()))
        .map_err(|e| format!("Turning on Open at boot failed ({e}). Try again."))?;
    let result = run_as_admin(&format!(
        "/bin/cp {} {PLIST} && /usr/sbin/chown root:wheel {PLIST} && /bin/chmod 644 {PLIST}",
        shell_quote(&staged.to_string_lossy())
    ));
    let _ = fs::remove_file(&staged);
    if result.is_err() {
        store.remove_login_window_secrets();
    }
    result
}

pub fn disable(store: &Store) -> Result<(), String> {
    if Path::new(PLIST).exists() {
        run_as_admin(&format!("/bin/rm -f {PLIST}"))?;
    }
    store.remove_login_window_secrets();
    Ok(())
}

/// The headless host launchd starts at the login window. Logs its status (never the link) to `LOG`.
pub fn run(config_dir: PathBuf) {
    let Some(store) = Store::open_login_window(config_dir) else {
        eprintln!("Open at boot is off; exiting.");
        return;
    };
    let host = HostService::new(
        Box::new(|state| {
            if let Ok(status) = serde_json::to_string(&state.status) {
                eprintln!("{status}");
            }
        }),
        Arc::new(store),
    );
    host.start();
    loop {
        std::thread::park();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agent_runs_this_app_at_the_login_window_only() {
        let plist = plist(
            Path::new("/Applications/Tetramote.app/Contents/MacOS/tetramote-desktop"),
            Path::new("/Users/fosse/Library/Application Support/com.tetramo.tetramote.host"),
        );
        assert!(plist.contains("<key>LimitLoadToSessionType</key>\n\t<string>LoginWindow</string>"));
        assert!(plist.contains(
            "<string>/Applications/Tetramote.app/Contents/MacOS/tetramote-desktop</string>\n\t\t<string>--login-window</string>\n\t\t<string>/Users/fosse/Library/Application Support/com.tetramo.tetramote.host</string>"
        ));
        assert!(plist.contains("<key>SuccessfulExit</key>\n\t\t<false/>"));
    }

    #[test]
    fn escapes_paths_for_xml_the_shell_and_applescript() {
        assert!(plist(Path::new("/A&B/<x>"), Path::new("/c"))
            .contains("<string>/A&amp;B/&lt;x&gt;</string>"));
        assert_eq!(shell_quote("/tmp/it's here"), r"'/tmp/it'\''s here'");
        assert_eq!(
            applescript_string(r#"say "hi" \ now"#),
            r#""say \"hi\" \\ now""#
        );
    }
}
