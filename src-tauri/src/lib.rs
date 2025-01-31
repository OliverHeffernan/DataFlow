#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![write_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
