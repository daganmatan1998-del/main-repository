/* THE APP'S OWN COMMANDS, DECLARED (2.31.0).

   Since Tauri 2.12 a page loaded from a remote address (the orb runs the
   Cloudflare site, dist/boot.html) can call none of JARVIS's own commands
   unless a capability grants them by name - "Command X not allowed by ACL".
   So every command registered in main.rs's generate_handler! gets an
   allow-<command> permission here, and permissions/jarvis-commands.toml (written
   below, from the same list) gathers them into one set, "jarvis-commands",
   which the capability files grant to the orb, the camera and the 3D viewer -
   from the app's own files and from the site alike. That is exactly what
   the three windows could call before; nothing new is opened up.

   The list is read from main.rs itself, so a command added there is
   declared here without anyone having to remember to. */
fn main() {
    println!("cargo:rerun-if-changed=src/main.rs");
    let src = std::fs::read_to_string("src/main.rs").expect("src/main.rs");
    let start = src.find("generate_handler![").expect("generate_handler! in main.rs") + "generate_handler![".len();
    let end = start + src[start..].find(']').expect("end of generate_handler!");
    let commands: Vec<&'static str> = src[start..end]
        .split(',')
        .map(|c| c.trim())
        .filter(|c| !c.is_empty())
        .map(|c| &*Box::leak(c.to_string().into_boxed_str()))
        .collect();
    let set = format!(
        "# Written by build.rs from generate_handler! in src/main.rs - do not edit.\n\n[[set]]\nidentifier = \"jarvis-commands\"\ndescription = \"Every JARVIS command, for the orb, the camera and the 3D viewer.\"\npermissions = [\n{}\n]\n",
        commands.iter().map(|c| format!("  \"allow-{}\"", c.replace('_', "-"))).collect::<Vec<_>>().join(",\n")
    );
    std::fs::create_dir_all("permissions").expect("permissions dir");
    if std::fs::read_to_string("permissions/jarvis-commands.toml").ok().as_deref() != Some(set.as_str()) {
        std::fs::write("permissions/jarvis-commands.toml", set).expect("permissions/jarvis-commands.toml");
    }
    let commands: &'static [&'static str] = Box::leak(commands.into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to run tauri-build");
}
