// WebView2 windows sharing the app's data directory MUST use identical browser options.
// Otherwise the second controller fails with ERROR_INVALID_STATE after Tauri has already
// returned a window handle. Keep login windows in the same environment as the main window.
// Restate wry's defaults when adding the video-composition options used by capture.
pub(crate) const DESKTOP_WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion --disable-direct-composition-video-overlays";
