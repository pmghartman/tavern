// the desktop app is a window onto a Tavern server: it opens the bundled
// launcher (app/index.html), which connects to the saved server URL. The
// menu's "Change Server..." brings the launcher back to pick another, and
// "Update App from Source..." opens the bundled update page, which rebuilds
// this app from the checkout it was built from (scripts/app_build.sh)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, Url};

const CHANGE_SERVER: &str = "change-server";
const UPDATE_APP: &str = "update-app";

// a bundled page's own address, which differs per platform
fn page_url(page: &str) -> Url {
    let base = if cfg!(any(target_os = "windows", target_os = "android")) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(&format!("{base}{page}")).expect("page url")
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

// the checkout this app rebuilds itself from: TAVERN_SRC, else the one it
// was built from (baked in at build time)
fn source_dir() -> Result<PathBuf, String> {
    let dir = std::env::var_os("TAVERN_SRC")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/..")));
    let dir = dir.canonicalize().unwrap_or(dir);
    if !dir.join("scripts/app_build.sh").is_file() {
        return Err(format!("no Tavern checkout at {} (set TAVERN_SRC to one)", dir.display()));
    }
    Ok(dir)
}

#[tauri::command]
fn source() -> Result<String, String> {
    source_dir().map(|d| d.display().to_string())
}

// the version this app was built as
#[tauri::command]
fn version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

// scripts/app_build.sh --install in the checkout, its output sent to the page
// line by line as "update-log"; the exit code when it ends
#[tauri::command]
async fn update_from_source(app: tauri::AppHandle) -> Result<i32, String> {
    let dir = source_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new("bash")
            .args(["-c", "exec 2>&1; exec bash scripts/app_build.sh --install"])
            .current_dir(&dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("couldn't run scripts/app_build.sh in {}: {e}", dir.display()))?;
        let out = child.stdout.take().ok_or("no output")?;
        let _ = app.emit("update-log", format!("[app] updating from {}", dir.display()));
        for line in BufReader::new(out).lines() {
            let Ok(line) = line else { break };
            let _ = app.emit("update-log", line);
        }
        let status = child.wait().map_err(|e| e.to_string())?;
        Ok(status.code().unwrap_or(-1))
    })
    .await
    .map_err(|e| e.to_string())?
}

// this app started again, the new build when the update installed one
#[tauri::command]
fn relaunch(app: tauri::AppHandle) {
    app.restart()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![reachable, source, version, update_from_source, relaunch])
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
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, UPDATE_APP, "Update App from Source...", true, None::<&str>)?,
                ],
            )?;
            menu.append(&server)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            let Some(win) = app.get_webview_window("main") else { return };
            match event.id().as_ref() {
                CHANGE_SERVER => {
                    let _ = win.navigate(page_url("index.html?pick"));
                }
                UPDATE_APP => {
                    let _ = win.navigate(page_url("update.html"));
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
