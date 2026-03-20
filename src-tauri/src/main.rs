#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use serde::Deserialize;
use std::process::Child;
use std::sync::Mutex;
use tauri::{command, State};

#[derive(Default)]
struct BackendHandle(Mutex<Option<Child>>);

#[derive(Deserialize)]
struct BackendConfig {
    port: Option<u16>,
}

#[command]
async fn start_backend(state: State<'_, BackendHandle>, cfg: BackendConfig) -> Result<u16, String> {
    let mut guard = state.0.lock().unwrap();
    if guard.is_some() {
        return Err("Backend already running".into());
    }

    let port = cfg.port.unwrap_or(3000);
    let port_arg = format!("--port={}", port);

    #[cfg(debug_assertions)]
    {
        println!("[Tauri] dev mode: frontend connects to localhost:3000");
        return Ok(3000);
    }

    #[cfg(not(debug_assertions))]
    {
        // Fast-track release mode: desktop app connects to an already running backend.
        // This avoids coupling installer generation to backend binary packaging.
        let _ = (&mut *guard, &port_arg);
        println!("[Tauri] prod mode: expecting external backend on localhost:{}", port);
        Ok(port)
    }
}

#[command]
async fn stop_backend(state: State<'_, BackendHandle>) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        println!("[Tauri] stopping backend process...");
        let _ = child.kill();
        let _ = child.wait();
        println!("[Tauri] backend stopped");
    }
    Ok(())
}

#[command]
async fn backend_health_check() -> Result<bool, String> {
    match reqwest::Client::new()
        .get("http://localhost:3000/health")
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
    {
        Ok(resp) => Ok(resp.status().is_success()),
        Err(_) => Ok(false),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(BackendHandle::default())
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            backend_health_check
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
