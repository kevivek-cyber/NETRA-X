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
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// CREATE_NO_WINDOW -- suppress the console Windows would otherwise allocate
/// for a console-subsystem child started by a GUI process.
///
/// python.exe is a console application. Launching it from this window meant
/// Windows opened a terminal for it and left it there for the life of the app:
/// a second window beside the console the user actually wanted, showing
/// uvicorn's log. Making the shell itself windows-subsystem does not help --
/// the console belongs to the *child*, not to us.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

    let mut cmd = Command::new(python);
    cmd.arg(entrypoint).current_dir(app_dir);

    // Without this the backend gets its own terminal window next to the app.
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn()
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

            // Fill the screen on open.
            //
            // `"maximized": true` in tauri.conf.json is the documented way to
            // do this and the field exists in this version, but it does not
            // take effect on Windows here -- the window came up 1454x882 on a
            // 1536x816 work area with IsZoomed reporting false. Applying it to
            // the live window instead is deterministic, and it runs before the
            // window is shown so there is no visible resize.
            //
            // Failure is ignored on purpose: a window that opens at its
            // configured size is a cosmetic problem, not a reason to abort
            // start-up and leave the analyst with no console at all.
            if let Some(window) = app.get_window("main") {
                let _ = window.maximize();
            }

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
