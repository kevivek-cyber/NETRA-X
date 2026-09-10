// NETRA-X desktop shell (thin client).
//
// The app no longer runs a backend of its own. One machine on the network runs
// the server (see apps/api/server_main.py) and owns the single shared
// database; this shell is a native window onto it.
//
// Consequences of that split, all deliberate:
//
//   * No bundled Python. The installer drops from ~119 MB to a few MB, and the
//     class of failure where a packaged interpreter cannot start is gone.
//   * No port 8000 on the client, so nothing to collide with.
//   * The UI is served by the server, not carried inside this binary. Pushing
//     to the server updates every teammate at once; the installer only needs
//     redistributing when this shell itself changes.
//   * The webview is same-origin with the API, so the CORS failure that broke
//     login in the bundled build cannot recur.
//
// First run asks for the server address and verifies it before saving. Later
// runs go straight to the app, and fall back to the setup screen -- with the
// reason shown -- if the server cannot be reached.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, CustomMenuItem, Manager, Menu, Submenu, WindowBuilder, WindowUrl};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(6);

/// Separate, shorter cap on establishing the TCP connection.
///
/// An overall timeout does not bound this on Windows: connecting to an address
/// with nothing at it (a server that is off, or an IP that moved) sits in the
/// OS connect retry for ~20s first, so the app showed no window at all for
/// that long and looked hung. Three seconds is ample on a LAN.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// Marker in GET /health identifying a real NETRA-X server.
///
/// Checking that *something* accepts a TCP connection is not enough: the
/// previous shell did exactly that, so a stale dev server -- or any unrelated
/// program holding the port -- passed the check and the app then talked to it.
const HEALTH_MARKER: &str = "NETRA-X";

/// Port the server listens on by default (see apps/api/server_main.py).
const DEFAULT_PORT: u16 = 8000;

/// Server a fresh install connects to without being asked.
///
/// Set at build time so one installer serves a whole team:
///     $env:NETRAX_DEFAULT_SERVER = "https://netra.example.com"; npm run desktop:build
///
/// The fallback below is compiled in when that is unset. Point it at a STABLE
/// address -- a named Cloudflare tunnel or a hosted deployment. A quick-tunnel
/// URL changes on every restart, so baking one in means rebuilding and
/// redistributing the installer each time, which is the problem this is meant
/// to solve.
///
/// An empty value simply means "always ask", which is the old behaviour.
const DEFAULT_SERVER_URL: &str = match option_env!("NETRAX_DEFAULT_SERVER") {
    Some(url) => url,
    None => "https://www.onnetra.in",
};

/// Which server to try at startup, and whether it came from the user.
///
/// A saved address always wins: someone who has deliberately pointed the app
/// at their own server must not be silently moved back to the shipped default
/// by an update.
fn resolve_startup_url(saved: Option<&str>, default: &str) -> Option<String> {
    match saved {
        Some(url) if !url.trim().is_empty() => Some(url.to_string()),
        _ if !default.trim().is_empty() => Some(normalize_url(default)),
        _ => None,
    }
}

#[derive(Serialize, Deserialize, Default)]
struct ClientConfig {
    server_url: Option<String>,
}

fn config_path() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("NETRA-X").join("client.json")
}

fn load_config() -> ClientConfig {
    fs::read_to_string(config_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_config(config: &ClientConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    }
    let body = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| format!("Cannot write {}: {e}", path.display()))
}

/// Accept what people actually type.
///
/// "192.168.8.113:8000" is the form the server prints and the form teammates
/// pass along verbally. Requiring a scheme would reject it, so assume http --
/// the LAN server speaks plain HTTP, and https would fail the health check in
/// a way that reads as "server down".
fn normalize_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    add_default_port(&with_scheme)
}

/// Append the server's port when a bare address omits it.
///
/// "192.168.8.113" is what people type and what gets read out loud, but with
/// no port it resolves to :80, where nothing listens -- producing a timeout
/// that looks exactly like a server that is down.
///
/// Only for addresses that are plainly a machine on the network: a bare IP or
/// localhost. A hostname is left alone, because a tunnel or reverse proxy
/// serves it on the implicit 80/443 and forcing :8000 there would break it.
fn add_default_port(url: &str) -> String {
    let (scheme, rest) = match url.split_once("://") {
        Some(parts) => parts,
        None => return url.to_string(),
    };
    let (authority, path) = match rest.split_once('/') {
        Some((a, p)) => (a, Some(p)),
        None => (rest, None),
    };
    if authority.contains(':') {
        return url.to_string(); // explicit port already
    }

    let is_bare_ipv4 = !authority.is_empty()
        && authority.split('.').count() == 4
        && authority
            .split('.')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    if !(is_bare_ipv4 || authority.eq_ignore_ascii_case("localhost")) {
        return url.to_string();
    }

    match path {
        Some(p) => format!("{scheme}://{authority}:{DEFAULT_PORT}/{p}"),
        None => format!("{scheme}://{authority}:{DEFAULT_PORT}"),
    }
}

/// Percent-encode for a query string. Small and dependency-free: the only
/// value passed through it is our own error text.
fn urlencode(input: &str) -> String {
    input
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// Confirm a real NETRA-X server answers, and say precisely what went wrong.
fn probe_server(url: &str) -> Result<(), String> {
    let endpoint = format!("{url}/health");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout(HEALTH_TIMEOUT)
        .build();
    let response = agent
        .get(&endpoint)
        .call()
        .map_err(|err| match err {
            // Distinguish "answered with an error" from "never answered": the
            // first means the address is right and something else is wrong.
            ureq::Error::Status(code, _) => {
                format!("{url} answered with HTTP {code}. Is that the NETRA-X server?")
            }
            ureq::Error::Transport(t) => format!(
                "Could not reach {url}. Check the server is running, that you are on the \
                 same Wi-Fi, and that the address is right. ({t})"
            ),
        })?;

    let body = response
        .into_string()
        .map_err(|e| format!("{url} replied, but the response could not be read: {e}"))?;

    if !body.contains(HEALTH_MARKER) {
        return Err(format!(
            "Something is running at {url}, but it is not NETRA-X. Check the address and port."
        ));
    }
    Ok(())
}

/// Menu carrying the one thing the shell owns: which server to talk to.
///
/// Without this, moving to a different server meant deleting client.json by
/// hand -- fine for whoever built the app, useless for everyone else.
fn app_menu() -> Menu {
    Menu::new().add_submenu(Submenu::new(
        "Server",
        Menu::new()
            .add_item(CustomMenuItem::new("change_server", "Change server..."))
            .add_item(CustomMenuItem::new("reload", "Reload")),
    ))
}

fn open_app_window(app: &AppHandle, url: &str) -> Result<(), String> {
    let parsed = url
        .parse()
        .map_err(|_| format!("{url} is not a valid address."))?;
    let window = WindowBuilder::new(app, "main", WindowUrl::External(parsed))
        .menu(app_menu())
        .title("NETRA-X — Threat Actor Intelligence & Attribution")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 700.0)
        .resizable(true)
        .build()
        .map_err(|e| format!("Could not open the app window: {e}"))?;
    // Configured "maximized" is unreliable on Windows here; apply it to the
    // live window. Cosmetic, so failure is ignored rather than fatal.
    let _ = window.maximize();
    Ok(())
}

fn open_setup_window(app: &AppHandle, error: Option<&str>) -> Result<(), String> {
    let target = match error {
        Some(message) => format!("index.html?error={}", urlencode(message)),
        None => "index.html".to_string(),
    };
    WindowBuilder::new(app, "setup", WindowUrl::App(target.into()))
        .title("NETRA-X — Connect")
        .inner_size(560.0, 540.0)
        .resizable(false)
        .center()
        .build()
        .map_err(|e| format!("Could not open the setup window: {e}"))?;
    Ok(())
}

#[tauri::command]
fn saved_server() -> Option<String> {
    // Falls back to the shipped default so the connect screen opens prefilled
    // with something worth trying, rather than an empty box.
    load_config()
        .server_url
        .filter(|u| !u.trim().is_empty())
        .or_else(|| {
            let d = DEFAULT_SERVER_URL.trim();
            if d.is_empty() { None } else { Some(d.to_string()) }
        })
}

#[tauri::command]
fn connect_to_server(app: AppHandle, url: String) -> Result<(), String> {
    let normalized = normalize_url(&url);
    probe_server(&normalized)?;
    save_config(&ClientConfig {
        server_url: Some(normalized.clone()),
    })?;
    // Close any existing session before opening the new one -- otherwise
    // "Change server" leaves two windows pointed at different servers, which
    // is exactly the confusion this feature exists to prevent.
    if let Some(existing) = app.get_window("main") {
        let _ = existing.close();
    }
    open_app_window(&app, &normalized)?;
    if let Some(setup) = app.get_window("setup") {
        let _ = setup.close();
    }
    Ok(())
}

/// Toggle OS-level window fullscreen.
///
/// A custom command rather than the `window` allowlist, which is deliberately
/// closed: exposing setFullscreen and friends to any script in the webview to
/// get one keybinding is a worse trade. It also cannot be done from the web
/// side -- the HTML Fullscreen API expands the document inside the webview,
/// which already fills the window, so the chrome stays put.
#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let now = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!now).map_err(|e| e.to_string())?;
    Ok(!now)
}

#[tauri::command]
fn is_fullscreen(window: tauri::Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            saved_server,
            connect_to_server,
            toggle_fullscreen,
            is_fullscreen
        ])
        .setup(|app| {
            let handle = app.handle();
            let saved = load_config().server_url;
            match resolve_startup_url(saved.as_deref(), DEFAULT_SERVER_URL) {
                // A server that has since moved, gone down, or been replaced
                // sends the user to the connect screen with the reason, rather
                // than a blank window that never loads.
                Some(url) => match probe_server(&url) {
                    Ok(()) => open_app_window(&handle, &url)?,
                    Err(reason) => open_setup_window(&handle, Some(&reason))?,
                },
                None => open_setup_window(&handle, None)?,
            }
            Ok(())
        })
        .on_menu_event(|event| {
            let app = event.window().app_handle();
            match event.menu_item_id() {
                "change_server" => {
                    // Leave the app window open: if they cancel, or the new
                    // address is wrong, they still have the working session.
                    if app.get_window("setup").is_none() {
                        let _ = open_setup_window(&app, None);
                    } else if let Some(w) = app.get_window("setup") {
                        let _ = w.set_focus();
                    }
                }
                "reload" => {
                    // The UI is served by the server, so a reload is how a
                    // teammate picks up a deploy without reinstalling.
                    if let Some(w) = app.get_window("main") {
                        let _ = w.eval("window.location.reload()");
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running NETRA-X desktop app");
}

#[cfg(test)]
mod tests {
    use super::{normalize_url, resolve_startup_url};

    #[test]
    fn bare_ip_gets_scheme_and_port() {
        // The exact thing a teammate types after being told the address aloud.
        assert_eq!(normalize_url("192.168.8.113"), "http://192.168.8.113:8000");
    }

    #[test]
    fn explicit_port_is_respected() {
        assert_eq!(normalize_url("192.168.8.113:9001"), "http://192.168.8.113:9001");
        assert_eq!(normalize_url("http://192.168.8.113:8000"), "http://192.168.8.113:8000");
    }

    #[test]
    fn hostnames_keep_their_implicit_port() {
        // A tunnel or proxy serves these on 443/80; forcing :8000 breaks them.
        assert_eq!(normalize_url("https://netra.example.com"), "https://netra.example.com");
    }

    #[test]
    fn localhost_gets_the_default_port() {
        assert_eq!(normalize_url("localhost"), "http://localhost:8000");
    }

    #[test]
    fn whitespace_and_trailing_slash_are_tolerated() {
        assert_eq!(normalize_url("  192.168.8.113:8000/  "), "http://192.168.8.113:8000");
    }

    #[test]
    fn a_fresh_install_uses_the_shipped_default() {
        assert_eq!(
            resolve_startup_url(None, "netra.example.com").as_deref(),
            Some("http://netra.example.com")
        );
    }

    #[test]
    fn a_saved_server_beats_the_default() {
        // An update must not drag someone off the server they chose.
        assert_eq!(
            resolve_startup_url(Some("http://192.168.8.113:8000"), "https://shipped.example.com")
                .as_deref(),
            Some("http://192.168.8.113:8000")
        );
    }

    #[test]
    fn no_default_and_nothing_saved_means_ask() {
        assert_eq!(resolve_startup_url(None, ""), None);
        assert_eq!(resolve_startup_url(Some("   "), ""), None);
    }
}
