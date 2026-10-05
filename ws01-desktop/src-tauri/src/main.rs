// No console window behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/* WS-01: the web shooter's engineering sheet (dist/index.html) in a window
   of its own. Everything it needs is inside the app: three.js, the fonts
   and the page. The only thing it asks of the system is to open a web
   link in the default browser. */
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("WS-01 could not start");
}
