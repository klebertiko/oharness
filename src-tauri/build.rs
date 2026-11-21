fn main() {
    // `resources/cordis-host/` is staged by scripts/build-cordis-host.mjs (it is not in git). tauri-build
    // needs the folder to exist, so `cargo check`, clippy, tests and `tauri dev` work without staging it.
    // A release build stages it first (release.yml); without it the app runs and plugins are unavailable.
    let host = std::path::Path::new("resources").join("cordis-host");
    if !host.exists() {
        let _ = std::fs::create_dir_all(&host);
        println!("cargo:warning=resources/cordis-host is not staged; run scripts/build-cordis-host.mjs to bundle the plugin host");
    }
    tauri_build::build()
}
