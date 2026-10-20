mod atomic;
mod lifecycle;
mod recovery;
mod updates;

use lifecycle::Lifecycle;
use recovery::{RecoveryEntry, RecoveryStore};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Lifecycle::default())
        .setup(|app| {
            let recovery_root = app
                .path()
                .app_local_data_dir()
                .map(|directory| directory.join("recovery"))
                .map_err(|error| error.to_string());
            app.manage(RecoveryStore::new(recovery_root));
            updates::setup(app)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            window.state::<Lifecycle>().on_window_event(window, event);
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                webview.state::<Lifecycle>().frontend_reset();
            }
        })
        .invoke_handler(tauri::generate_handler![
            write_file,
            keybinding_config,
            recovery_write,
            recovery_list,
            recovery_resolve,
            recovery_release,
            lifecycle::lifecycle_ready,
            lifecycle::lifecycle_complete
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app, event| {
        app.state::<Lifecycle>().on_run_event(app, &event);
    });
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

/// Atomically writes a workbook and returns the normalised destination.
#[tauri::command]
async fn write_file(path: String, content: String) -> Result<String, String> {
    blocking(move || {
        let destination = atomic::normalize_destination(&path)?;
        atomic::write_atomic(&destination, content.as_bytes())
            .map_err(|error| format!("Could not save {}: {error}", destination.display()))?;
        Ok(destination.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
async fn recovery_write(
    store: tauri::State<'_, RecoveryStore>,
    record: serde_json::Value,
) -> Result<(), String> {
    let store = store.inner().clone();
    blocking(move || store.write(record)).await
}

#[tauri::command]
async fn recovery_list(
    store: tauri::State<'_, RecoveryStore>,
) -> Result<Vec<RecoveryEntry>, String> {
    let store = store.inner().clone();
    blocking(move || store.list()).await
}

#[tauri::command]
async fn recovery_resolve(
    store: tauri::State<'_, RecoveryStore>,
    id: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    blocking(move || store.resolve(&id)).await
}

#[tauri::command]
async fn recovery_release(
    store: tauri::State<'_, RecoveryStore>,
    id: String,
) -> Result<(), String> {
    let store = store.inner().clone();
    blocking(move || store.release(&id)).await
}

#[derive(serde::Serialize)]
struct KeybindingConfig {
    path: String,
    content: Option<String>,
}

#[tauri::command]
fn keybinding_config(
    app: tauri::AppHandle,
    create: bool,
    template: Option<String>,
) -> Result<KeybindingConfig, String> {
    use tauri::Manager;
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    config_at(&directory, create, template.as_deref())
}

fn config_at(
    directory: &std::path::Path,
    create: bool,
    template: Option<&str>,
) -> Result<KeybindingConfig, String> {
    use std::io::{Read, Write};
    let path = directory.join("init.lua");
    if create {
        let template = template.unwrap_or("");
        if template.len() > 128 * 1024 {
            return Err("init.lua exceeds 128 KiB".into());
        }
        std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => file
                .write_all(template.as_bytes())
                .map_err(|e| e.to_string())?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    let content = match std::fs::File::open(&path) {
        Ok(file) => {
            let mut content = String::new();
            file.take(128 * 1024 + 1)
                .read_to_string(&mut content)
                .map_err(|e| e.to_string())?;
            if content.len() > 128 * 1024 {
                return Err("init.lua exceeds 128 KiB".into());
            }
            Some(content)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    Ok(KeybindingConfig {
        path: path.to_string_lossy().into_owned(),
        content,
    })
}

#[cfg(test)]
mod tests {
    use super::config_at;

    #[test]
    fn config_creation_preserves_user_edits_and_reload_reads_the_file() {
        let directory =
            std::env::temp_dir().join(format!("dataflow-config-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        assert!(config_at(&directory, false, None)
            .unwrap()
            .content
            .is_none());
        assert_eq!(
            config_at(&directory, true, Some("-- template"))
                .unwrap()
                .content
                .as_deref(),
            Some("-- template")
        );
        std::fs::write(directory.join("init.lua"), "-- user edit").unwrap();
        assert_eq!(
            config_at(&directory, true, Some("-- replacement"))
                .unwrap()
                .content
                .as_deref(),
            Some("-- user edit")
        );
        assert_eq!(
            config_at(&directory, false, None)
                .unwrap()
                .content
                .as_deref(),
            Some("-- user edit")
        );
        std::fs::write(directory.join("init.lua"), "x".repeat(128 * 1024 + 1)).unwrap();
        assert!(config_at(&directory, false, None).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
