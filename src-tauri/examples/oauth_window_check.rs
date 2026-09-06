//! Native regression check: run `cargo run --example oauth_window_check` on Windows.
//! Opens a main window with Izumi's browser options before exercising OAuth. No credentials
//! are exchanged or saved. Set IZUMI_SMOKE_AUTH_URL to also check a provider's login page.

#[path = "../src/desktop_webview.rs"]
mod desktop_webview;
#[path = "../src/oauth.rs"]
mod oauth;

use std::{
    io::{Read, Write},
    time::Duration,
};
use tauri::Manager;

// Match the repository's unit-test loader shim; this isolated probe opens no task dialogs.
#[cfg(windows)]
unsafe extern "system" fn task_dialog(
    _: *const std::ffi::c_void,
    _: *mut i32,
    _: *mut i32,
    _: *mut i32,
) -> i32 {
    0x80004001_u32 as i32
}
#[cfg(windows)]
#[no_mangle]
static __imp_TaskDialogIndirect: unsafe extern "system" fn(
    *const std::ffi::c_void,
    *mut i32,
    *mut i32,
    *mut i32,
) -> i32 = task_dialog;

async fn open(
    app: &tauri::AppHandle,
    base: &str,
    index: u64,
) -> (
    tokio::task::JoinHandle<Result<String, String>>,
    tauri::WebviewWindow,
) {
    let handle = app.clone();
    let auth = if index == 1 {
        std::env::var("IZUMI_SMOKE_AUTH_URL").unwrap_or_else(|_| format!("{base}/login"))
    } else {
        format!("{base}/login")
    };
    let redirect = format!("{base}/callback");
    let task = tokio::spawn(async move { oauth::capture(&handle, &auth, &redirect).await });
    let label = format!("oauth-{index}");
    let window = tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Some(window) = app.get_webview_window(&label) {
                break window;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("window should open");
    (task, window)
}

async fn result(task: tokio::task::JoinHandle<Result<String, String>>) -> Result<String, String> {
    tokio::time::timeout(Duration::from_secs(10), task)
        .await
        .expect("login should settle")
        .unwrap()
}

async fn smoke(app: tauri::AppHandle, base: String) {
    let (first, window) = open(&app, &base, 1).await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    if first.is_finished() {
        panic!("login failed during startup: {:?}", result(first).await);
    }
    assert!(window.is_visible().unwrap());
    println!("PASS: native WebView2 login remains visible after 5 seconds");
    let callback = format!("{base}/callback?code=smoke-mal&state=attempt");
    window.navigate(callback.parse().unwrap()).unwrap();
    assert_eq!(result(first).await, Ok(callback));
    println!("PASS: native navigation captures the complete MAL code callback");

    let (cancel, window) = open(&app, &base, 2).await;
    window.close().unwrap();
    assert_eq!(result(cancel).await, Err("Login window was closed.".into()));
    let (retry, window) = open(&app, &base, 3).await;
    let callback = format!("{base}/callback?code=retry");
    window.navigate(callback.parse().unwrap()).unwrap();
    assert_eq!(result(retry).await, Ok(callback));
    println!("PASS: closing then immediately retrying succeeds without label collisions");

    let (left, left_window) = open(&app, &base, 4).await;
    let (right, right_window) = open(&app, &base, 5).await;
    left_window.close().unwrap();
    assert_eq!(result(left).await, Err("Login window was closed.".into()));
    assert!(!right.is_finished());
    let callback = format!("{base}/callback#access_token=smoke-anilist&token_type=Bearer");
    right_window.navigate(callback.parse().unwrap()).unwrap();
    assert_eq!(result(right).await, Ok(callback));
    println!("PASS: simultaneous providers stay independent and preserve token fragments");
}

fn main() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for incoming in listener.incoming() {
            let mut stream = incoming.unwrap();
            let mut request = [0; 4096];
            let length = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..length]);
            if request.starts_with("GET /callback") {
                println!(
                    "Callback site intentionally unavailable: {}",
                    request.lines().next().unwrap_or("")
                );
                let _ = write!(stream, "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            let body = "<!doctype html><title>OAuth lifecycle check</title><h1>Testing login window lifecycle</h1>";
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        }
    });
    let mut context = tauri::generate_context!("examples/oauth-window-check/tauri.conf.json");
    context.config_mut().identifier = "watch.izumi.oauth-lifecycle-smoke".into();
    let app = tauri::Builder::default()
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .additional_browser_args(desktop_webview::DESKTOP_WEBVIEW_ARGS)
            .title("OAuth production lifecycle test")
            .visible(false)
            .build()?;
            Ok(())
        })
        .build(context)
        .unwrap();
    let exit_code = std::sync::Arc::new(std::sync::atomic::AtomicI32::new(1));
    let run_code = exit_code.clone();
    app.run_return(move |app, event| match event {
        tauri::RunEvent::Ready => {
            let handle = app.clone();
            let base = base.clone();
            let run_code = run_code.clone();
            tauri::async_runtime::spawn(async move {
                let exit_handle = handle.clone();
                let task = tokio::spawn(smoke(handle, base));
                let passed = tokio::time::timeout(Duration::from_secs(60), task)
                    .await
                    .is_ok_and(|result| result.is_ok());
                let code = if passed { 0 } else { 1 };
                run_code.store(code, std::sync::atomic::Ordering::SeqCst);
                exit_handle.exit(code);
            });
        }
        tauri::RunEvent::ExitRequested {
            api, code: None, ..
        } => api.prevent_exit(),
        _ => {}
    });
    std::process::exit(exit_code.load(std::sync::atomic::Ordering::SeqCst));
}
