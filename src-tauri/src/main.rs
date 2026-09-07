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
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
