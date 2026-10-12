// the desktop app is a window onto a Tavern server: it opens the bundled
// launcher (app/index.html), which connects to the saved server URL. The
// menu's "Change Server..." brings the launcher back to pick another
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, Url};

const CHANGE_SERVER: &str = "change-server";

// the launcher's own address, which differs per platform
fn launcher_url() -> Url {
    let base = if cfg!(any(target_os = "windows", target_os = "android")) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(&format!("{base}index.html?pick")).expect("launcher url")
}

// whether anything answers at the server's host and port, so the launcher
// can say so instead of navigating to a dead address (which leaves the
// window blank); a plain TCP connect, free of the page's mixed-content rules
#[tauri::command]
async fn reachable(url: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(url) = Url::parse(&url) else { return false };
        let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else { return false };
        let host = host.trim_start_matches('[').trim_end_matches(']');
        let Ok(addrs) = (host, port).to_socket_addrs() else { return false };
        addrs.into_iter().any(|a| TcpStream::connect_timeout(&a, Duration::from_secs(3)).is_ok())
    })
    .await
    .unwrap_or(false)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![reachable])
        .menu(|app| {
            let menu = Menu::default(app)?;
            let server = Submenu::with_items(
                app,
                "Server",
                true,
                &[
                    &MenuItem::with_id(app, CHANGE_SERVER, "Change Server...", true, Some("CmdOrCtrl+Shift+S"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?,
                ],
            )?;
            menu.append(&server)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            let Some(win) = app.get_webview_window("main") else { return };
            match event.id().as_ref() {
                CHANGE_SERVER => {
                    let _ = win.navigate(launcher_url());
                }
                "reload" => {
                    let _ = win.eval("location.reload()");
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tavern");
}
