mod updates;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
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
        .invoke_handler(tauri::generate_handler![write_file, keybinding_config])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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

#[tauri::command]
fn write_file(_path: String, content: String) {
    use std::fs::File;
    use std::io::Write;

    let mut path = _path;

    if path.split('.').last() == Some("h") {
        path.truncate(path.len() - 2);
    }
    if path.split('.').last() != Some("dflo") {
        path.push_str(".dflo");
    }

    let mut file = File::create(path).unwrap();
    file.write_all(content.as_bytes()).unwrap();
}

#[tauri::command]
fn read_file(_path: String) {
    use std::fs::File;
    use std::io::Read;

    let mut path = _path;

    let mut file = File::open(path).unwrap();
    let mut content = String::new();
    file.read_to_string(&mut content).unwrap();

    //use tauri::Manager;
    //emit("file-read", Some(content).unwrap());
}
