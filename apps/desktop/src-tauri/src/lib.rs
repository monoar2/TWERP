/// Entry point shared by the desktop binary (and mobile targets if ever enabled).
/// The window loads the Next.js UI: the dev server in `tauri dev`, the static
/// export (apps/web/out) in `tauri build`. All data goes through the ERP HTTP API.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación ERP");
}
