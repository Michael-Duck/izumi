use tauri::{AppHandle, Manager, WebviewWindow};

#[cfg(not(target_os = "android"))]
fn directories(app: &AppHandle) -> Result<Vec<std::path::PathBuf>, tauri::Error> {
    let mut roots = vec![
        app.path().app_config_dir()?,
        app.path().app_data_dir()?,
        app.path().app_local_data_dir()?,
        app.path().app_cache_dir()?,
        app.path().app_log_dir()?,
    ];
    // WKWebView also uses system-managed directories outside Application Support/Caches.
    #[cfg(target_os = "macos")]
    {
        let library = app.path().home_dir()?.join("Library");
        for parent in ["WebKit", "HTTPStorages"] {
            roots.push(library.join(parent).join(&app.config().identifier));
        }
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

/// Register before window-state and other plugins, before any WebView/database can be opened.
#[cfg(not(target_os = "android"))]
pub fn startup_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("local-reset")
        .setup(|app, _| {
            let marker = app.path().app_config_dir()?.join(crate::reset_data::MARKER);
            if !marker.try_exists()? {
                return Ok(());
            }
            let roots = directories(app)?;
            // WebView2 child processes can briefly retain file locks after their parent exits.
            let mut attempts = 0;
            loop {
                match crate::reset_data::clear_app_directories(&roots, &marker, &app.config().identifier) {
                    Ok(()) => break,
                    Err(_) if attempts < 20 => {
                        attempts += 1;
                        std::thread::sleep(std::time::Duration::from_millis(250));
                    }
                    Err(error) => return Err(format!("Local reset could not finish; close remaining izumi and extension service processes and reopen the app: {error}").into()),
                }
            }
            #[cfg(target_os = "macos")]
            {
                let cookies = app.path().home_dir()?.join("Library/Cookies")
                    .join(format!("{}.binarycookies", app.config().identifier));
                match std::fs::remove_file(cookies) {
                    Ok(()) => {},
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                    Err(error) => return Err(error.into()),
                }
            }
            std::fs::remove_file(marker)?;
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn reset_local_data(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main"
        || window.url().map_err(|error| error.to_string())?.path() != "/reset.html"
    {
        return Err("Start a reset from Settings → About.".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_extplayer::ExtPlayerExt;
        // Android owns all app-private storage, including WebView data, preferences and runtime
        // databases. Its system reset stops this process before deleting it all.
        app.extplayer()
            .reset_local_data()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let roots = directories(&app).map_err(|error| error.to_string())?;
        crate::reset_data::validate_roots(&roots, &app.config().identifier)
            .map_err(|error| error.to_string())?;
        let config = app
            .path()
            .app_config_dir()
            .map_err(|error| error.to_string())?;
        std::fs::create_dir_all(&config).map_err(|error| error.to_string())?;
        // Sync the intent to disk before stopping anything. Deletion happens in the NEXT process;
        // background downloads, sync and persisted stores cannot recreate old data afterward.
        let marker = std::fs::File::create(config.join(crate::reset_data::MARKER))
            .map_err(|error| error.to_string())?;
        marker.sync_all().map_err(|error| error.to_string())?;
        crate::jvm_extensions::jvm_extension_reload(app.state()).await?;
        crate::extension_service::stop_all(app.state()).await?;
        app.request_restart();
        Ok(())
    }
}
