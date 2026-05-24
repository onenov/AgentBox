fn main() {
    ensure_debug_sidecar_placeholder();
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_startup_preferences",
            "set_startup_preferences",
            "get_theme_preferences",
            "set_theme_preferences",
            "get_auth_preferences",
            "get_desktop_storage_value",
            "set_desktop_storage_value",
            "remove_desktop_storage_value",
            "clear_desktop_storage",
            "get_desktop_update_target",
            "prepare_desktop_update",
            "open_external_url",
        ]))
        .windows_attributes(tauri_build::WindowsAttributes::new().app_manifest(WINDOWS_APP_MANIFEST));

    tauri_build::try_build(attributes).expect("failed to run Tauri build script")
}

const WINDOWS_APP_MANIFEST: &str = r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#;

fn ensure_debug_sidecar_placeholder() {
    let Ok(profile) = std::env::var("PROFILE") else {
        return;
    };
    if profile == "release" {
        return;
    }

    let Ok(target) = std::env::var("TARGET") else {
        return;
    };

    let sidecar = std::path::Path::new("binaries").join(format!("agentbox-sidecar-{target}"));
    if sidecar.exists() {
        return;
    }

    if let Some(parent) = sidecar.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    #[cfg(windows)]
    let content = "@echo off\r\necho AgentBox debug sidecar placeholder\r\n";
    #[cfg(not(windows))]
    let content = "#!/usr/bin/env sh\necho 'AgentBox debug sidecar placeholder'\n";

    if std::fs::write(&sidecar, content).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&sidecar, std::fs::Permissions::from_mode(0o755));
        }
    }
}
