use std::{
    collections::BTreeMap,
    env, fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

mod tray;

use serde::{Deserialize, Serialize};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_blur, apply_mica};

const BACKEND_SIDECAR: &str = "agentbox-sidecar";
const LOOPBACK_HOST: &str = "127.0.0.1";
const SILENT_STARTUP_ARG: &str = "--silent-startup";
const STARTUP_PREFERENCES_FILE: &str = "startup-preferences.json";
const THEME_PREFERENCES_FILE: &str = "theme-preferences.json";
const AUTH_PREFERENCES_FILE: &str = "auth-preferences.json";
const DESKTOP_STORAGE_FILE: &str = "desktop-storage.json";

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupPreferences {
    silent_startup: bool,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThemePreferences {
    theme: Option<String>,
    theme_style: Option<String>,
    theme_color: Option<String>,
    theme_general_radius: Option<f64>,
    theme_forms_radius: Option<f64>,
    theme_font: Option<String>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthPreferences {
    auth_token: Option<String>,
    api_url: Option<String>,
}

type DesktopStorage = BTreeMap<String, serde_json::Value>;

#[derive(Default)]
struct BackendState {
    child: Mutex<Option<CommandChild>>,
}

struct BackendEndpoint {
    url: String,
}

fn apply_platform_window_effects(window: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        let mica_ok = match apply_mica(window, Some(false)) {
            Ok(()) => true,
            Err(error) => {
                eprintln!("failed to apply Windows mica effect: {error}");
                false
            }
        };
        let acrylic_ok = match apply_acrylic(window, Some((18, 18, 18, 110))) {
            Ok(()) => true,
            Err(error) => {
                eprintln!("failed to apply Windows acrylic effect: {error}");
                false
            }
        };
        if !mica_ok && !acrylic_ok {
            if let Err(error) = apply_blur(window, Some((18, 18, 18, 90))) {
                eprintln!("failed to apply Windows blur fallback: {error}");
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([SILENT_STARTUP_ARG])
                .app_name("AgentBox")
                .build(),
        )
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            get_startup_preferences,
            set_startup_preferences,
            get_theme_preferences,
            set_theme_preferences,
            get_auth_preferences,
            get_desktop_storage_value,
            set_desktop_storage_value,
            remove_desktop_storage_value,
            clear_desktop_storage,
            get_desktop_update_target,
            prepare_desktop_update,
            open_external_url
        ])
        .setup(|app| {
            setup_main_window(app)?;
            if let Err(error) = tray::setup_tray(app.handle()) {
                eprintln!("failed to setup AgentBox tray: {error}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    tray::hide_main_window(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build AgentBox desktop app");

    app.run(|app_handle, event| match event {
        RunEvent::Exit | RunEvent::ExitRequested { .. } => {
            stop_backend_sidecar(app_handle);
        }
        _ => {}
    });
}

fn setup_main_window(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let url = if cfg!(debug_assertions) {
        dev_web_url()
    } else {
        start_backend_sidecar(app)?.url
    };

    let visible = !should_start_silently(app.handle());
    create_main_window(app, &url, visible)?;
    if !visible {
        tray::hide_main_window(app.handle());
    }
    Ok(())
}

#[tauri::command]
fn get_startup_preferences(app: tauri::AppHandle) -> StartupPreferences {
    read_startup_preferences(&app)
}

#[tauri::command]
fn set_startup_preferences(
    app: tauri::AppHandle,
    preferences: StartupPreferences,
) -> Result<(), String> {
    write_startup_preferences(&app, &preferences)
}

#[tauri::command]
fn get_theme_preferences(app: tauri::AppHandle) -> ThemePreferences {
    read_theme_preferences(&app)
}

#[tauri::command]
fn set_theme_preferences(
    app: tauri::AppHandle,
    preferences: ThemePreferences,
) -> Result<(), String> {
    write_theme_preferences(&app, &preferences)
}

#[tauri::command]
fn get_auth_preferences(app: tauri::AppHandle) -> AuthPreferences {
    read_auth_preferences(&app)
}

#[tauri::command]
fn get_desktop_storage_value(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let storage = read_desktop_storage(&app);
    Ok(storage.get(key.trim()).cloned())
}

#[tauri::command]
fn set_desktop_storage_value(
    app: tauri::AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("desktop storage key is required".to_string());
    }
    let mut storage = read_desktop_storage(&app);
    storage.insert(key.to_string(), value);
    write_desktop_storage(&app, &storage)
}

#[tauri::command]
fn remove_desktop_storage_value(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let mut storage = read_desktop_storage(&app);
    storage.remove(key.trim());
    write_desktop_storage(&app, &storage)
}

#[tauri::command]
fn clear_desktop_storage(app: tauri::AppHandle) -> Result<(), String> {
    let path = desktop_storage_path(&app)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn get_desktop_update_target() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        value => value,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

#[tauri::command]
fn prepare_desktop_update(app: tauri::AppHandle) {
    stop_backend_sidecar(&app);
    kill_stray_sidecar_processes();
    std::thread::sleep(Duration::from_millis(800));
}

#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed_url = url::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("仅支持打开 HTTP/HTTPS 链接".to_string());
    }

    app.opener()
        .open_url(parsed_url.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn dev_web_url() -> String {
    let port = env::var("FRONTEND_DEV_PORT")
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .unwrap_or(5122);
    format!("http://localhost:{port}")
}

fn should_start_silently(app: &tauri::AppHandle) -> bool {
    env::args().any(|arg| arg == SILENT_STARTUP_ARG) && read_startup_preferences(app).silent_startup
}

fn startup_preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(STARTUP_PREFERENCES_FILE))
        .map_err(|error| error.to_string())
}

fn theme_preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(THEME_PREFERENCES_FILE))
        .map_err(|error| error.to_string())
}

fn auth_preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(AUTH_PREFERENCES_FILE))
        .map_err(|error| error.to_string())
}

fn desktop_storage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(DESKTOP_STORAGE_FILE))
        .map_err(|error| error.to_string())
}

fn read_startup_preferences(app: &tauri::AppHandle) -> StartupPreferences {
    let Ok(path) = startup_preferences_path(app) else {
        return StartupPreferences::default();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return StartupPreferences::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_startup_preferences(
    app: &tauri::AppHandle,
    preferences: &StartupPreferences,
) -> Result<(), String> {
    let path = startup_preferences_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn read_theme_preferences(app: &tauri::AppHandle) -> ThemePreferences {
    let Ok(path) = theme_preferences_path(app) else {
        return ThemePreferences::default();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return ThemePreferences::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_theme_preferences(
    app: &tauri::AppHandle,
    preferences: &ThemePreferences,
) -> Result<(), String> {
    let path = theme_preferences_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(preferences).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn read_auth_preferences(app: &tauri::AppHandle) -> AuthPreferences {
    let Ok(path) = auth_preferences_path(app) else {
        return AuthPreferences::default();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return AuthPreferences::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn read_desktop_storage(app: &tauri::AppHandle) -> DesktopStorage {
    let Ok(path) = desktop_storage_path(app) else {
        return DesktopStorage::new();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return DesktopStorage::new();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_desktop_storage(app: &tauri::AppHandle, storage: &DesktopStorage) -> Result<(), String> {
    let path = desktop_storage_path(app)?;
    if storage.is_empty() {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let contents = serde_json::to_string_pretty(storage).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn start_backend_sidecar(app: &tauri::App) -> Result<BackendEndpoint, Box<dyn std::error::Error>> {
    let port = resolve_backend_port()?;
    let url = format!("http://{LOOPBACK_HOST}:{port}");
    let path = desktop_path_env();

    let (mut rx, child) = app
        .shell()
        .sidecar(BACKEND_SIDECAR)?
        .env("APP_ENV", "production")
        .env("SERVER_HOST", LOOPBACK_HOST)
        .env("SERVER_PORT", port.to_string())
        .env("PATH", path)
        .spawn()?;

    let pid = child.pid();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    eprintln!("[agentbox:{pid}:stdout] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[agentbox:{pid}:stderr] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[agentbox:{pid}] exited with code {:?}", payload.code);
                    break;
                }
                CommandEvent::Error(error) => {
                    eprintln!("[agentbox:{pid}] {error}");
                }
                _ => {}
            }
        }
    });

    app.state::<BackendState>()
        .child
        .lock()
        .expect("backend sidecar state poisoned")
        .replace(child);

    wait_for_backend(port, Duration::from_secs(20))?;
    Ok(BackendEndpoint { url })
}

fn stop_backend_sidecar(app: &tauri::AppHandle) {
    let Some(child) = app
        .state::<BackendState>()
        .child
        .lock()
        .expect("backend sidecar state poisoned")
        .take()
    else {
        return;
    };

    if let Err(error) = child.kill() {
        eprintln!("failed to stop AgentBox sidecar: {error}");
    }
}

#[cfg(target_os = "windows")]
fn kill_stray_sidecar_processes() {
    let output = std::process::Command::new("taskkill")
        .args(["/IM", "agentbox-sidecar.exe", "/F", "/T"])
        .output();
    if let Err(error) = output {
        eprintln!("failed to run taskkill for AgentBox sidecar: {error}");
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_stray_sidecar_processes() {}

fn create_main_window(
    app: &tauri::App,
    url: &str,
    visible: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let parsed_url = url.parse()?;
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed_url))
        .title("AgentBox")
        .inner_size(1400.0, 800.0)
        .min_inner_size(1280.0, 720.0)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::utils::config::Color(0, 0, 0, 0))
        .resizable(true)
        .visible(visible);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .effects(tauri::utils::config::WindowEffectsConfig {
                effects: vec![tauri::window::Effect::HudWindow],
                state: Some(tauri::window::EffectState::Active),
                radius: Some(24.0),
                color: None,
            });
    }

    let window = builder.build()?;
    apply_platform_window_effects(&window);
    Ok(())
}

fn resolve_backend_port() -> Result<u16, Box<dyn std::error::Error>> {
    if let Ok(value) = env::var("AGENTBOX_DESKTOP_PORT") {
        if let Ok(port) = value.parse::<u16>() {
            if port > 0 {
                return Ok(port);
            }
        }
    }

    let listener = TcpListener::bind((LOOPBACK_HOST, 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn wait_for_backend(port: u16, timeout: Duration) -> Result<(), Box<dyn std::error::Error>> {
    let started_at = Instant::now();
    loop {
        if backend_is_healthy(port) {
            return Ok(());
        }
        if started_at.elapsed() >= timeout {
            return Err(format!("AgentBox backend did not become healthy on port {port}").into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn backend_is_healthy(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect((LOOPBACK_HOST, port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: {LOOPBACK_HOST}:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200")
}

fn desktop_path_env() -> String {
    let mut entries = Vec::new();
    if let Ok(path) = env::var("PATH") {
        entries.extend(env::split_paths(&path).map(|item| item.to_string_lossy().into_owned()));
    }

    for candidate in desktop_path_candidates() {
        if !entries.iter().any(|entry| entry == &candidate) {
            entries.push(candidate);
        }
    }

    env::join_paths(entries)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn desktop_path_candidates() -> Vec<String> {
    let mut candidates = vec![
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    append_windows_desktop_path_candidates(&mut candidates);
    candidates
}

#[cfg(target_os = "windows")]
fn append_windows_desktop_path_candidates(candidates: &mut Vec<String>) {
    if let Ok(system_root) = env::var("SystemRoot") {
        candidates.push(format!("{system_root}\\System32"));
        candidates.push(format!("{system_root}\\System32\\WindowsPowerShell\\v1.0"));
    }
    for key in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        let Ok(root) = env::var(key) else {
            continue;
        };
        if key == "LOCALAPPDATA" {
            candidates.push(format!("{root}\\Programs\\Git\\cmd"));
            candidates.push(format!("{root}\\Programs\\Git\\bin"));
            candidates.push(format!("{root}\\Programs\\nodejs"));
        } else {
            candidates.push(format!("{root}\\Git\\cmd"));
            candidates.push(format!("{root}\\Git\\bin"));
            candidates.push(format!("{root}\\nodejs"));
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn append_windows_desktop_path_candidates(candidates: &mut Vec<String>) {
    let _ = candidates;
}
