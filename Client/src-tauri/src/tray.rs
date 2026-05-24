use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewWindow,
};

fn load_tray_icon() -> Result<Image<'static>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    {
        Ok(Image::from_bytes(include_bytes!("../icons/win-32x32.png"))?)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let toggle = MenuItemBuilder::with_id("toggle", "显示/隐藏窗口").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 AgentBox").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&toggle)
        .item(&separator)
        .item(&quit)
        .build()?;

    TrayIconBuilder::new()
        .icon(load_tray_icon()?)
        .tooltip("AgentBox")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn with_main_window(app: &AppHandle, handler: impl FnOnce(&WebviewWindow)) {
    if let Some(window) = app.get_webview_window("main") {
        handler(&window);
    }
}

#[cfg(target_os = "macos")]
fn set_dock_visible(app: &AppHandle, visible: bool) {
    let activation_policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };

    if let Err(error) = app.set_activation_policy(activation_policy) {
        eprintln!("failed to update macOS activation policy: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
fn set_dock_visible(_app: &AppHandle, _visible: bool) {}

pub(crate) fn show_main_window(app: &AppHandle) {
    set_dock_visible(app, true);
    with_main_window(app, |window| {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    });
}

pub(crate) fn hide_main_window(app: &AppHandle) {
    with_main_window(app, |window| {
        let _ = window.hide();
    });
    set_dock_visible(app, false);
}

pub(crate) fn toggle_main_window(app: &AppHandle) {
    with_main_window(app, |window| {
        if window.is_visible().unwrap_or(false) {
            hide_main_window(app);
        } else {
            show_main_window(app);
        }
    });
}
