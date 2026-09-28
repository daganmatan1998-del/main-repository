// Keeps the console window from appearing behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    WebviewUrl, WebviewWindowBuilder,
    /* Emitter is what puts .emit() on the window, the same way Manager puts
       .get_webview_window() on the app. Without it in scope the method does
       not exist and the compiler reports no such method on the type. */
    Emitter, Manager, WebviewWindow,
};
/* GlobalShortcutExt is what puts .global_shortcut() on the App handle. Without
   it in scope the method simply does not exist and the compiler says the type
   has no such method — the trait has to be imported even though nothing here
   names it directly. */
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use std::sync::atomic::{AtomicBool, Ordering};

/* The hotkey. A bare Ctrl cannot be registered on its own — every OS treats a
   lone modifier as part of another combination, never as a shortcut in itself,
   so nothing would ever fire. This is the nearest thing that actually works
   and does not collide with anything common. Change it here and in
   HOTKEY_LABEL below if you would rather have something else. */
const HOTKEY_MODS: Modifiers = Modifiers::CONTROL.union(Modifiers::SHIFT);
const HOTKEY_CODE: Code = Code::Space;
const HOTKEY_LABEL: &str = "Ctrl+Shift+Space";

/* STOP TALKING, and why it has to be a global shortcut rather than anything
   in the page.

   Everything else that silences him depends on the microphone: saying his
   name has to be recorded, transcribed and recognised, and all three can be
   defeated at once by the thing you are trying to escape — his own voice
   holding the input level up so the turn never ends and nothing is ever
   sent. A key that the operating system delivers straight to the process
   cannot be drowned out. It is the one stop that works when everything
   else has failed, and it works with the window hidden and unfocused. */
const HUSH_MODS: Modifiers = Modifiers::CONTROL.union(Modifiers::SHIFT);
const HUSH_CODE: Code = Code::KeyX;
const HUSH_LABEL: &str = "Ctrl+Shift+X";

/* PUSH TO TALK: hold the key and he listens, let go and he is deaf.

   Fn was the key asked for, and it cannot be done: on nearly every laptop Fn
   is handled inside the keyboard itself and never reaches Windows at all —
   there is no key code for it to register. Caps Lock came next, and it stuck:
   Windows flips the Caps Lock light and state underneath the hotkey, so every
   hold left the keyboard typing in capitals. \ (the key above Enter) has no
   lock state to flip — one key, no combination, easy to find without looking.
   While JARVIS runs the key is his, so it does not type a backslash anywhere.

   Both edges are needed, which is why this cannot be a key listener in the
   page: the page only hears keys while it has focus, and the point is to
   talk to him from whatever you are working in. The plugin reports the
   release as well as the press, and registers with MOD_NOREPEAT, so holding
   the key sends one press and one release rather than a stream of repeats.
   Change the key here if you would rather hold something else. */
const PTT_CODE: Code = Code::Backslash;
const PTT_LABEL: &str = "\\ (backslash)";
/* Whether the key was actually won. Another program can already own it, and
   the page must not switch to push-to-talk on a key that will never arrive —
   that would be a JARVIS who cannot hear anything and no way to find out. */
static PTT_REGISTERED: AtomicBool = AtomicBool::new(false);

/* Park the panel against the right-hand edge, vertically centred — the corner
   of the screen you are least likely to be working in. Done in code rather
   than as fixed coordinates in the config because the right edge depends on
   the monitor, and a hardcoded position lands off-screen on a different one. */
fn park_on_right_edge(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen = monitor.size();
        let scale = monitor.scale_factor();
        if let Ok(win) = window.outer_size() {
            let margin = (24.0 * scale) as i32;
            let x = screen.width as i32 - win.width as i32 - margin;
            let y = (screen.height as i32 - win.height as i32) / 2;
            let _ = window.set_position(tauri::PhysicalPosition { x, y });
        }
    }
}

/* One key does both jobs: bring it up when it is away, put it away when it is
   there. A separate hide shortcut would be one more thing to remember, and the
   whole point is that this is reflexive. */
fn toggle(window: &WebviewWindow) {
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/* Closing the window you are looking at. This is the first thing JARVIS can
   do that reaches outside his own process, so it is written as narrowly as
   the capability allows: no arguments, no target selection, nothing the
   model can steer. It closes the foreground window and only that.

   WM_CLOSE is a request, not a kill. The application decides what to do with
   it — an unsaved document still prompts, exactly as clicking the X would.
   TerminateProcess would be the destructive version and is deliberately not
   used here.

   The guard that matters: refuse when the foreground window is our own.
   Without it, asking JARVIS to close a window while his own panel happens to
   have focus would close JARVIS — a confusing way to lose the assistant you
   were talking to. */
#[cfg(target_os = "windows")]
#[tauri::command]
fn close_foreground_window() -> Result<String, String> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, PostMessageW, WM_CLOSE,
    };

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        /* HWND is a raw pointer in windows-sys 0.59, not an integer, so it is
           compared against a null pointer rather than 0. */
        if hwnd.is_null() {
            return Err("no window is in the foreground".into());
        }

        // Read the title, both to report it back and to recognise ourselves.
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        let title = if len > 0 {
            String::from_utf16_lossy(&buf[..len as usize])
        } else {
            String::new()
        };

        if title == "JARVIS" || title.is_empty() {
            return Err("that is my own window — refusing to close it".into());
        }

        /* WPARAM and LPARAM are also pointer-sized newtypes here; 0 as _
           lets the compiler produce whichever zero value each one wants. */
        if PostMessageW(hwnd, WM_CLOSE, 0 as _, 0 as _) == 0 {
            return Err(format!("Windows refused to close \"{}\"", title));
        }
        Ok(title)
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn close_foreground_window() -> Result<String, String> {
    Err("only available on Windows".into())
}

/* Closing a named window — in practice a browser window, since that is what
   accumulates. Searches the visible top-level windows for one whose title
   contains the text, and sends it the same close request as clicking the X.

   Two guards, both learned from the foreground version: our own window is
   never a candidate, and an empty search string is refused outright rather
   than matching the first window it finds. A close command that can be
   talked into matching everything is worse than no close command. */
#[cfg(target_os = "windows")]
#[tauri::command]
fn close_window_named(name: String) -> Result<String, String> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, IsWindowVisible, PostMessageW, WM_CLOSE,
    };

    let needle = name.trim().to_lowercase();
    if needle.is_empty() {
        return Err("no window name given".into());
    }

    struct Search {
        needle: String,
        found: Option<(isize, String)>,
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            let search = &mut *(lparam as *mut Search);
            if search.found.is_some() || IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len <= 0 {
                return 1;
            }
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title == "JARVIS" {
                return 1; // never ourselves
            }
            if title.to_lowercase().contains(&search.needle) {
                search.found = Some((hwnd as isize, title));
                return 0; // stop enumerating
            }
            1
        }
    }

    let mut search = Search { needle: needle.clone(), found: None };
    unsafe {
        EnumWindows(Some(visit), &mut search as *mut Search as LPARAM);
    }

    match search.found {
        None => Err(format!("no open window matching \"{}\"", name)),
        Some((hwnd, title)) => unsafe {
            if PostMessageW(hwnd as HWND, WM_CLOSE, 0 as _, 0 as _) == 0 {
                Err(format!("Windows refused to close \"{}\"", title))
            } else {
                Ok(title)
            }
        },
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn close_window_named(_name: String) -> Result<String, String> {
    Err("only available on Windows".into())
}

/* Closing a single browser tab. This is a different class of action from
   everything else here: WM_CLOSE politely ASKS a window to close, whereas a
   tab has no window of its own, so the only way in is to focus the browser
   and send it Ctrl+W — synthetic keystrokes aimed at whatever happens to be
   in front.

   That is what makes it risky, and what the guard below is for. If focus
   moves between finding the window and sending the keys — a notification
   steals it, the user clicks something — Ctrl+W lands somewhere else, and in
   an editor that closes a file. So focus is set, then VERIFIED, and the
   keystroke is only sent if the intended window really is in front. If it
   is not, nothing is sent and the caller is told. */
#[cfg(target_os = "windows")]
#[tauri::command]
fn close_browser_tab(name: String) -> Result<String, String> {
    use std::{thread, time::Duration};
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_CONTROL, VK_W,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextW, IsWindowVisible, SetForegroundWindow,
    };

    let needle = name.trim().to_lowercase();
    if needle.is_empty() {
        return Err("no window name given".into());
    }

    struct Search { needle: String, found: Option<(isize, String)> }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            let search = &mut *(lparam as *mut Search);
            if search.found.is_some() || IsWindowVisible(hwnd) == 0 { return 1; }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len <= 0 { return 1; }
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title == "JARVIS" { return 1; }
            if title.to_lowercase().contains(&search.needle) {
                search.found = Some((hwnd as isize, title));
                return 0;
            }
            1
        }
    }

    let mut search = Search { needle, found: None };
    unsafe { EnumWindows(Some(visit), &mut search as *mut Search as LPARAM); }

    let (hwnd, title) = search.found.ok_or_else(|| format!("no open window matching \"{}\"", name))?;

    unsafe {
        SetForegroundWindow(hwnd as HWND);
        thread::sleep(Duration::from_millis(120));

        /* The guard. Without it a stolen focus turns this into a keystroke
           fired blindly at someone else's window. */
        if GetForegroundWindow() != hwnd as HWND {
            return Err(format!(
                "could not bring \"{}\" to the front, so nothing was sent",
                title
            ));
        }

        let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };

        let mut inputs = [
            key(VK_CONTROL, false),
            key(VK_W, false),
            key(VK_W, true),
            key(VK_CONTROL, true),
        ];
        let sent = SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
        if sent == 0 {
            return Err("Windows rejected the keystroke".into());
        }
    }

    Ok(title)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn close_browser_tab(_name: String) -> Result<String, String> {
    Err("only available on Windows".into())
}

/* Screen capture. The point is not to save a file — it is to let him SEE
   what you are looking at, so the image goes back as base64 and straight
   into the conversation as an attachment. He already handles images; this
   just gives him eyes on your screen when you ask for them.

   Captures the primary monitor only. Multi-monitor selection would need a
   way to say which one, and there is no obvious vocabulary for that by
   voice — "the left one" means nothing to a display index. */
#[tauri::command]
fn take_screenshot() -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Cursor;
    use dirs_next;
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| format!("could not list monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| "no primary monitor found".to_string())?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("capture failed: {e}"))?;

    /* Scaled down before encoding. A 4K screenshot is several megabytes of
       PNG, which is slow to encode, slow to upload and far more detail than
       a vision model needs to read what is on screen. 1600px wide keeps text
       legible while keeping the payload small. */
    let (w, h) = (image.width(), image.height());
    let image = if w > 1600 {
        let nh = (h as f32 * (1600.0 / w as f32)) as u32;
        image::imageops::resize(&image, 1600, nh, image::imageops::FilterType::Triangle)
    } else {
        image
    };

    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("could not encode the image: {e}"))?;
    let bytes = buf.into_inner();

    /* Saved where Windows puts its own screenshots, so it turns up in the
       Photos gallery alongside them rather than somewhere only this app
       knows about. Failing to save is not fatal — being able to SEE the
       screen is the point, and a read-only folder should not cost that. */
    if let Some(dir) = dirs_next::picture_dir() {
        let shots = dir.join("Screenshots");
        let _ = std::fs::create_dir_all(&shots);
        let name = format!(
            "jarvis-{}.png",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        );
        let _ = std::fs::write(shots.join(name), &bytes);
    }

    Ok(STANDARD.encode(bytes))
}

/* WATCHING THE SCREEN, AS OPPOSED TO SCREENSHOTTING IT.
 *
 * While he has asked JARVIS to watch his screen, every message he sends
 * carries a fresh look at it. take_screenshot is the wrong tool for that:
 * it writes a PNG into Pictures\Screenshots each time, which is right for
 * "take a screenshot" and would fill the folder with one file per sentence
 * here. This is the same capture, kept in memory and never written to disk.
 *
 * 1280px wide rather than take_screenshot's 1600: it rides along with every
 * message while watching is on, ordinary interface text is still readable at
 * this width, each look costs about 1,200 tokens instead of 2,000, and even a
 * screen full of photograph stays well inside the 5MB an image may be. PNG,
 * because the image crate is built with PNG only (see Cargo.toml). */
#[tauri::command]
fn capture_screen_frame() -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Cursor;
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| format!("could not list monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| "no primary monitor found".to_string())?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("capture failed: {e}"))?;

    let (w, h) = (image.width(), image.height());
    let image = if w > 1280 {
        let nh = (h as f32 * (1280.0 / w as f32)) as u32;
        image::imageops::resize(&image, 1280, nh, image::imageops::FilterType::Triangle)
    } else {
        image
    };

    let mut buf = Cursor::new(Vec::new());
    image
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("could not encode the image: {e}"))?;
    Ok(STANDARD.encode(buf.into_inner()))
}

/* A WINDOW OF ITS OWN FOR A MODEL.
 *
 * The orb is a 180-pixel circle with no frame, pinned above everything: a
 * thing you glance at, not a thing you work in. A model you are judging needs
 * the opposite — room, a frame to drag by, an edge to pull. So it gets a real
 * window, with decorations, resizable, NOT always-on-top, which can sit beside
 * the work it is about instead of on top of it.
 *
 * It points at model.html rather than at the app's own page. index.html starts
 * a microphone, a scheduler and a hologram the moment it loads; opening a
 * second copy of all that to look at a mesh would run the whole assistant
 * twice.
 *
 * Asked for a second time, the existing window is reused: the url is replaced
 * and it is brought forward. Otherwise every model would leave another window
 * behind. */
#[tauri::command]
async fn open_model_window(app: tauri::AppHandle, url: String) -> Result<String, String> {
    // Only ever our own viewer, with the model as a parameter. A url straight
    // from a tool result must never become the page this window loads.
    if url.trim().is_empty() {
        return Err("no model url".into());
    }
    // Percent-encoded over the UTF-8 BYTES, not over chars: `c as u8` would
    // truncate anything outside ASCII and quietly corrupt the url.
    let mut encoded = String::with_capacity(url.len() * 3);
    for b in url.trim().as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*b as char)
            }
            _ => encoded.push_str(&format!("%{:02X}", b)),
        }
    }
    let page = format!("model.html?glb={}", encoded);

    if let Some(existing) = app.get_webview_window("model") {
        let _ = existing.eval(&format!("location.replace({:?})", page));
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok("reused".into());
    }

    WebviewWindowBuilder::new(&app, "model", WebviewUrl::App(page.into()))
        .title("JARVIS — 3D")
        .inner_size(760.0, 620.0)
        .min_inner_size(320.0, 280.0)
        .resizable(true)
        .decorations(true)
        .always_on_top(false)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok("opened".into())
}

/* ------------------------------------------------------------------
   THE WORKSPACE

   Three services, side by side, arranged to a layout rather than left
   wherever the window manager drops them.

   They are OUR windows, not browser tabs, and that is a deliberate
   trade. tauri_plugin_opener hands a link to whatever browser Windows
   has registered and then has no further say: three links become three
   tabs in one window, which cannot be tiled at all. A window we own can
   be placed to the pixel, reused instead of duplicated, and closed as a
   set. The cost is that each service needs signing into once, in this
   webview, because it keeps its own cookie jar — after that WebView2
   persists it like any browser profile.
------------------------------------------------------------------ */

/* The only place each service is allowed to load.

   This is the same rule as open_model_window's: a URL that arrived from
   a tool result must never become the page a window loads. Suffix
   matched on a label boundary, so admin.shopify.com passes and
   shopify.com.example.net does not. */
fn workspace_domain(service: &str) -> Option<&'static str> {
    match service {
        "shopify" => Some("shopify.com"),
        "instagram" => Some("instagram.com"),
        "tiktok" => Some("tiktok.com"),
        _ => None,
    }
}

fn host_within(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{}", domain))
}

/* The usable desktop — the screen minus the taskbar.

   Tauri's monitor gives the whole panel, so a layout built on it puts the
   bottom row underneath the taskbar, where the last row of a window is
   exactly the part you need to click. Windows reports the real figure and
   is asked for it here; everywhere else falls back to the monitor, which
   is wrong by the height of a taskbar and still better than nothing.

   Physical pixels, matching set_position and set_size below, so nothing
   has to be scaled twice. */
#[tauri::command]
fn work_area(app: tauri::AppHandle) -> Result<Vec<i32>, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::RECT;
        use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETWORKAREA};
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let got = unsafe {
            SystemParametersInfoW(
                SPI_GETWORKAREA,
                0,
                &mut rect as *mut RECT as *mut core::ffi::c_void,
                0,
            )
        };
        if got != 0 && rect.right > rect.left && rect.bottom > rect.top {
            return Ok(vec![
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
            ]);
        }
    }

    let window = app
        .get_webview_window("main")
        .ok_or("the main window is missing")?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no monitor is attached")?;
    let pos = monitor.position();
    let size = monitor.size();
    Ok(vec![pos.x, pos.y, size.width as i32, size.height as i32])
}

/* One service, at an exact rectangle.

   Reused rather than reopened when it is already there, and on reuse the
   page is left alone: he may be three clicks into an order, and throwing
   that away to reload the dashboard would be its own bug. Only the
   geometry is reapplied. */
#[tauri::command]
async fn open_service_window(
    app: tauri::AppHandle,
    service: String,
    url: String,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> Result<String, String> {
    let service = service.trim().to_lowercase();
    let domain = workspace_domain(&service)
        .ok_or_else(|| format!("\"{}\" is not one of the workspace services", service))?;

    let parsed = tauri::Url::parse(url.trim()).map_err(|_| format!("not a url: {}", url))?;
    if parsed.scheme() != "https" {
        return Err("refused: the workspace only loads https".into());
    }
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if !host_within(&host, domain) {
        return Err(format!(
            "refused: {} is not part of {}",
            if host.is_empty() { "that url" } else { &host },
            domain
        ));
    }

    let label = format!("ws-{}", service);
    let title = match service.as_str() {
        "shopify" => "Shopify \u{2014} JARVIS workspace",
        "instagram" => "Instagram \u{2014} JARVIS workspace",
        _ => "TikTok \u{2014} JARVIS workspace",
    };

    // A pane too small to use is not a pane. The caller does the layout;
    // this is the floor under it.
    let w = w.max(320);
    let h = h.max(260);

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.set_position(tauri::PhysicalPosition { x, y });
        let _ = existing.set_size(tauri::PhysicalSize {
            width: w as u32,
            height: h as u32,
        });
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok("reused".into());
    }

    /* The builder's position and size are LOGICAL; the rectangle here is
       physical, because that is what the work area is measured in. So the
       window is built and then placed, rather than placed by the builder
       and silently scaled on a high-DPI screen. */
    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .title(title)
        .min_inner_size(320.0, 260.0)
        .resizable(true)
        .decorations(true)
        .always_on_top(false)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.set_position(tauri::PhysicalPosition { x, y });
    let _ = win.set_size(tauri::PhysicalSize {
        width: w as u32,
        height: h as u32,
    });
    let _ = win.show();
    Ok("opened".into())
}

/* Which of the three are open right now. Asked before anything is opened,
   so "already open" can be reported as reuse rather than as a fresh
   window, and asked after, so the answer he is given is what actually
   happened rather than what was attempted. */
#[tauri::command]
fn workspace_open(app: tauri::AppHandle) -> Vec<String> {
    ["shopify", "instagram", "tiktok"]
        .iter()
        .filter(|s| app.get_webview_window(&format!("ws-{}", s)).is_some())
        .map(|s| s.to_string())
        .collect()
}

/* Put the workspace away again — the three panes, and only those. */
#[tauri::command]
fn close_workspace(app: tauri::AppHandle) -> Vec<String> {
    let mut closed = Vec::new();
    for s in ["shopify", "instagram", "tiktok"] {
        if let Some(win) = app.get_webview_window(&format!("ws-{}", s)) {
            if win.close().is_ok() {
                closed.push(s.to_string());
            }
        }
    }
    closed
}

/* ------------------------------------------------------------------
   THE CAMERA, AS A WINDOW OF ITS OWN

   It was a panel inside the orb, and the orb is a 180px square window
   while the panel is 200px wide. It was literally larger than the window
   containing it, and clampPane clamps to innerWidth, so there was
   nowhere to drag it to. That is not a styling problem and no amount of
   CSS was ever going to fix it.

   So it is a real window: dragged by its title bar, resized by its
   edges, put anywhere on the screen and left there. It owns the camera
   stream itself, because two webviews cannot share one, and hands the
   orb a frame a couple of times a second.
------------------------------------------------------------------ */
#[tauri::command]
async fn open_camera_window(app: tauri::AppHandle) -> Result<String, String> {
    if let Some(existing) = app.get_webview_window("camera") {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok("reused".into());
    }

    let win = WebviewWindowBuilder::new(&app, "camera", WebviewUrl::App("camera.html".into()))
        .title("JARVIS \u{2014} camera")
        .inner_size(360.0, 300.0)
        .min_inner_size(200.0, 170.0)
        .resizable(true)
        .decorations(true)
        /* Above the work, because a camera you have to go and find is a
           camera you stop using. He can drop it behind things himself. */
        .always_on_top(true)
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;

    /* Bottom right of the usable desktop, out of the way of everything.
       The page moves it again if he has placed it before; this is only
       where it goes the very first time. */
    if let Ok(area) = work_area(app.clone()) {
        if area.len() >= 4 {
            if let Ok(size) = win.outer_size() {
                let margin = 24;
                let x = area[0] + area[2] - size.width as i32 - margin;
                let y = area[1] + area[3] - size.height as i32 - margin;
                let _ = win.set_position(tauri::PhysicalPosition { x, y });
            }
        }
    }
    Ok("opened".into())
}

#[tauri::command]
fn close_camera_window(app: tauri::AppHandle) -> bool {
    match app.get_webview_window("camera") {
        Some(win) => win.close().is_ok(),
        None => false,
    }
}

#[tauri::command]
fn camera_window_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window("camera").is_some()
}

/* The push-to-talk key's name, or nothing if it could not be registered.
   The page asks at start-up; an older build without this command fails the
   call, and the page treats that the same as no key: it keeps listening
   hands-free rather than waiting on a key that does not exist. */
#[tauri::command]
fn push_to_talk_key() -> Option<String> {
    if PTT_REGISTERED.load(Ordering::SeqCst) {
        Some(PTT_LABEL.to_string())
    } else {
        None
    }
}


/* =====================================================================
   THE CODING AGENT'S WORKSPACE

   One folder, chosen once, at the OS's own per-user data location — never
   anywhere the model names. read_file, write_file, list_dir and a handful
   of git subcommands are the WHOLE of what this agent can do to a
   filesystem. There is no shell here and there is meant never to be one:
   the brief asks for "read code, write code, work with git", and all
   three are covered without opening a way to run an arbitrary command.
   The permission and approval decisions (filesystem.write, git.write,
   both approval-gated) are made in the worker's registry, in
   jarvis-worker.js — these commands trust that a call reaching them has
   already passed that gate, the same way close_camera_window trusts the
   page already decided the camera should close.
   ===================================================================== */
fn workspace_root() -> Result<std::path::PathBuf, String> {
    let base = dirs_next::data_dir().ok_or("could not find a per-user data directory")?;
    let root = base.join("jarvis-workspace");
    std::fs::create_dir_all(&root).map_err(|e| format!("could not create the workspace folder: {e}"))?;
    root.canonicalize().map_err(|e| format!("could not resolve the workspace folder: {e}"))
}

/* Every workspace path goes through this. A path arrives from a model's
   tool call, which makes it adversarial input: a leading slash, a `..`, or
   a symlink planted by an earlier write could otherwise walk it outside
   the one folder this feature exists to confine it to. Joining onto the
   root and then canonicalising is what actually catches a symlink escape
   — a plain string check on the unresolved path cannot, because the
   escape only happens once the filesystem follows the link.

   A path that does not exist yet (the common case for a write) cannot be
   canonicalised at all, so the check walks up to the nearest existing
   ancestor and confirms THAT stayed inside the root. Anything appended
   below an ancestor already inside the root cannot itself have escaped,
   since nothing further down a path that does not exist yet can be a
   symlink pointing elsewhere. */
fn resolve_in_workspace(root: &std::path::Path, rel: &str) -> Result<std::path::PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("no path given".into());
    }
    let candidate = root.join(rel.trim_start_matches(['/', '\\']));
    let mut check = candidate.clone();
    while !check.exists() {
        match check.parent() {
            Some(p) if p != check => check = p.to_path_buf(),
            _ => break,
        }
    }
    let resolved = check
        .canonicalize()
        .map_err(|e| format!("could not resolve \"{rel}\": {e}"))?;
    if !resolved.starts_with(root) {
        return Err(format!("\"{rel}\" is outside the workspace folder — refused"));
    }
    Ok(candidate)
}

#[tauri::command]
fn workspace_read_file(path: String) -> Result<String, String> {
    let root = workspace_root()?;
    let full = resolve_in_workspace(&root, &path)?;
    std::fs::read_to_string(&full).map_err(|e| format!("could not read \"{path}\": {e}"))
}

#[tauri::command]
fn workspace_write_file(path: String, content: String) -> Result<String, String> {
    let root = workspace_root()?;
    let full = resolve_in_workspace(&root, &path)?;
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create the folder for \"{path}\": {e}"))?;
    }
    std::fs::write(&full, content.as_bytes()).map_err(|e| format!("could not write \"{path}\": {e}"))?;
    Ok(format!("wrote {} bytes to {}", content.len(), path))
}

#[tauri::command]
fn workspace_list_dir(path: Option<String>) -> Result<String, String> {
    let root = workspace_root()?;
    let rel = path.clone().unwrap_or_default();
    let full = if rel.is_empty() { root.clone() } else { resolve_in_workspace(&root, &rel)? };
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&full).map_err(|e| format!("could not list \"{rel}\": {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        entries.push(serde_json::json!({ "name": name, "dir": is_dir }));
    }
    Ok(serde_json::json!({ "path": rel, "entries": entries }).to_string())
}

/* git, and only these actions — status/diff/log read, add/commit/init
   write. No shell: every argument becomes its own argv entry passed
   straight to Command, never assembled into a string a shell would
   reinterpret, so nothing in a commit message can inject a second
   command. `init` is allowed so the folder can become a repo the first
   time it is used; run again on a folder git already knows about, it is
   a harmless no-op. */
#[tauri::command]
fn workspace_git(action: String, args: Vec<String>) -> Result<String, String> {
    let root = workspace_root()?;
    const ALLOWED: [&str; 6] = ["status", "diff", "log", "add", "commit", "init"];
    if !ALLOWED.contains(&action.as_str()) {
        return Err(format!(
            "git action \"{action}\" is not permitted here — only {}",
            ALLOWED.join(", ")
        ));
    }
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&root).arg(&action);
    for a in &args {
        cmd.arg(a);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("could not run git: {e} — is it installed and on PATH?"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        let detail = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        return Err(format!("git {action} failed: {detail}"));
    }
    Ok(stdout)
}

/* =====================================================================
   SYSTEM MONITOR / SECURITY — read-only, and there is no path from either
   agent's permissions to anything else. sysinfo only ever reads counters
   the OS already tracks; nothing here can end a process, change a
   setting, or see network traffic.
   ===================================================================== */
#[tauri::command]
fn system_metrics() -> Result<String, String> {
    use sysinfo::{Disks, System};
    let mut sys = System::new_all();
    /* A single sample reads 0% on every platform sysinfo supports — CPU
       usage is defined between two points in time, not at one instant.
       The short sleep is the whole cost of a real number instead of a
       constant zero. */
    sys.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let cpu = sys.global_cpu_usage();
    let mem_used = sys.used_memory();
    let mem_total = sys.total_memory();
    let disks = Disks::new_with_refreshed_list();
    let disk_json: Vec<_> = disks
        .list()
        .iter()
        .map(|d| {
            serde_json::json!({
                "mount": d.mount_point().to_string_lossy(),
                "total_bytes": d.total_space(),
                "available_bytes": d.available_space()
            })
        })
        .collect();
    Ok(serde_json::json!({
        "cpu_percent": (cpu * 10.0).round() / 10.0,
        "memory_used_bytes": mem_used,
        "memory_total_bytes": mem_total,
        "memory_percent": if mem_total > 0 {
            ((mem_used as f64 / mem_total as f64) * 1000.0).round() / 10.0
        } else { 0.0 },
        "disks": disk_json
    })
    .to_string())
}

#[tauri::command]
fn list_processes(limit: Option<u32>) -> Result<String, String> {
    use sysinfo::{ProcessesToUpdate, System};
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut procs: Vec<_> = sys
        .processes()
        .values()
        .map(|p| {
            (
                p.name().to_string_lossy().into_owned(),
                p.pid().as_u32(),
                p.cpu_usage(),
                p.memory(),
            )
        })
        .collect();
    procs.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let n = (limit.unwrap_or(25).min(200)) as usize;
    let list: Vec<_> = procs
        .into_iter()
        .take(n)
        .map(|(name, pid, cpu, mem)| {
            serde_json::json!({
                "name": name, "pid": pid,
                "cpu_percent": (cpu * 10.0).round() / 10.0,
                "memory_bytes": mem
            })
        })
        .collect();
    Ok(serde_json::json!({ "processes": list }).to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            close_foreground_window,
            close_window_named,
            close_browser_tab,
            take_screenshot,
            capture_screen_frame,
            open_model_window,
            work_area,
            open_service_window,
            workspace_open,
            close_workspace,
            open_camera_window,
            close_camera_window,
            camera_window_open,
            push_to_talk_key,
            workspace_read_file,
            workspace_write_file,
            workspace_list_dir,
            workspace_git,
            system_metrics,
            list_processes
        ])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("the main window is missing from tauri.conf.json");

            park_on_right_edge(&window);
            let _ = window.show();
            let _ = window.set_focus();

            /* Registered through the native plugin, not a keydown listener in
               the page. A listener in the webview only fires while the window
               already has focus, which is useless here — the entire purpose is
               to summon it from whatever you were doing instead. */
            let shortcut = Shortcut::new(Some(HOTKEY_MODS), HOTKEY_CODE);
            let hush = Shortcut::new(Some(HUSH_MODS), HUSH_CODE);
            let ptt = Shortcut::new(None, PTT_CODE);
            let hotkey_window = window.clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, fired, event| {
                        /* Push to talk takes both edges, so it is handled
                           before the press-only filter below: true while the
                           key is down, false the moment it comes up. Like
                           the stop key, it never shows or focuses the window. */
                        if fired.matches(Modifiers::empty(), PTT_CODE) {
                            let held = event.state() == ShortcutState::Pressed;
                            let _ = hotkey_window.emit("jarvis://ptt", held);
                            return;
                        }
                        // Pressed only: without this it toggles twice per press.
                        if event.state() != ShortcutState::Pressed {
                            return;
                        }
                        if fired.matches(HOTKEY_MODS, HOTKEY_CODE) {
                            toggle(&hotkey_window);
                        } else if fired.matches(HUSH_MODS, HUSH_CODE) {
                            /* Deliberately does NOT show or focus the window.
                               The whole point is to shut him up without being
                               pulled out of whatever you are working in. */
                            let _ = hotkey_window.emit("jarvis://hush", ());
                        }
                    })
                    .build(),
            )?;

            if let Err(err) = app.global_shortcut().register(shortcut) {
                // Another application may already own this combination. Say so
                // rather than leaving a hotkey that silently does nothing.
                eprintln!(
                    "JARVIS: could not register {} — another app may already use it ({})",
                    HOTKEY_LABEL, err
                );
            }
            if let Err(err) = app.global_shortcut().register(hush) {
                eprintln!(
                    "JARVIS: could not register {} — another app may already use it ({})",
                    HUSH_LABEL, err
                );
            }
            match app.global_shortcut().register(ptt) {
                Ok(()) => PTT_REGISTERED.store(true, Ordering::SeqCst),
                Err(err) => eprintln!(
                    "JARVIS: could not register {} for push-to-talk — another app may already use it ({})",
                    PTT_LABEL, err
                ),
            }

            /* A tray icon, because the window has no title bar and is hidden
               half the time: without it there is no way to get the app back if
               the shortcut is taken, and no obvious way to quit. */
            let show_item = MenuItem::with_id(app, "show", "Show JARVIS", true, None::<&str>)?;
            let hush_item = MenuItem::with_id(app, "hush", "Stop talking", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hush_item, &hide_item, &quit_item])?;

            let tray_window = window.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(&format!(
                    "JARVIS — hold {} to talk, {} to summon, {} to stop talking",
                    PTT_LABEL, HOTKEY_LABEL, HUSH_LABEL
                ))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        let _ = tray_window.show();
                        let _ = tray_window.set_focus();
                    }
                    "hush" => {
                        let _ = tray_window.emit("jarvis://hush", ());
                    }
                    "hide" => {
                        let _ = tray_window.hide();
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            /* Closing the panel should put it away, not end the session — the
               conversation and the unlocked PIN live in the page, and killing
               the process throws both away. Quit is on the tray menu. */
            /* Only the orb refuses to close \u2014 its conversation and unlocked PIN
               live in the page, and killing the process throws both away. The
               model window is a viewer with nothing in it worth keeping, so
               its X must actually close it or it would pile up hidden windows
               nobody can reach. */
            /* Closing the camera window is not the same as it vanishing:
               the orb holds "the camera is on" and would go on believing
               it, and go on offering to look at something nobody is
               filming. Told directly, before the early return below. */
            if window.label() == "camera" {
                if let tauri::WindowEvent::Destroyed = event {
                    if let Some(main) = window.app_handle().get_webview_window("main") {
                        let _ = main.emit("jarvis://camera-closed", true);
                    }
                }
            }
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running JARVIS");
}
