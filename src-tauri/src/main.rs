// NETRA-X desktop shell.
//
// On startup this spawns the bundled Python runtime (resources/pyembed) running
// apps/api/desktop_main.py (resources/app), waits for the local API to answer
// health checks on 127.0.0.1:8000, then lets the webview (already loaded from
// the static Next.js export) start talking to it. The child process is killed
// when the app exits so a closed window never leaves an orphaned API process
// running in the background.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};

struct ApiProcess(Mutex<Option<Child>>);

/// Toggle OS-level window fullscreen, returning the state it ended up in.
///
/// This is a custom command rather than the `window` allowlist because the
/// allowlist is deliberately closed (`all: false`) and this is the only window
/// capability the UI needs -- exposing setFullscreen/isFullscreen/etc. to any
/// script in the webview to get one keybinding is a worse trade.
///
/// It also cannot be done from the web side alone: the HTML Fullscreen API
/// inside WebView2 expands the document within the webview, which already
/// fills the window, so the title bar and window chrome stay put and nothing
/// appears to happen. Only the window itself can go truly fullscreen.
#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let now = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!now).map_err(|e| e.to_string())?;
    Ok(!now)
}

/// Report current fullscreen state, so the UI can render the right affordance
/// after a reload or when the window was toggled by other means.
#[tauri::command]
fn is_fullscreen(window: tauri::Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

fn spawn_api(resource_dir: &std::path::Path) -> std::io::Result<Child> {
    let python = resource_dir
        .join("resources")
        .join("pyembed")
        .join("python.exe");
    let app_dir = resource_dir.join("resources").join("app");
    let entrypoint = app_dir.join("apps").join("api").join("desktop_main.py");

    Command::new(python)
        .arg(entrypoint)
        .current_dir(app_dir)
        .spawn()
}

fn wait_for_api(timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(
            &"127.0.0.1:8000".parse().unwrap(),
            Duration::from_millis(300),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

fn main() {
    tauri::Builder::default()
        .manage(ApiProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![toggle_fullscreen, is_fullscreen])
        .setup(|app| {
            let resource_dir = app
                .path_resolver()
                .resource_dir()
                .expect("failed to resolve resource dir");

            match spawn_api(&resource_dir) {
                Ok(child) => {
                    let state = app.state::<ApiProcess>();
                    *state.0.lock().unwrap() = Some(child);
                    // Block the setup hook briefly so the window doesn't show a
                    // connection-refused flash on first paint. If the backend is
                    // slow (first-run seed), the frontend's own retry logic in
                    // apps/web/src/lib/api.ts still covers the remainder.
                    wait_for_api(Duration::from_secs(15));
                }
                Err(e) => {
                    eprintln!("[NETRA-X Desktop] failed to start local API: {e}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building NETRA-X desktop app")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                let state = app_handle.state::<ApiProcess>();
                let mut guard = state.0.lock().unwrap();
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                }
            }
        });
}
