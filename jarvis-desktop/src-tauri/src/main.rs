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

mod glide;

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

/* REFRESH — reloads the orb when he is stuck (refresh_orb_now). F5 is the
   key every Windows user already knows means "reload"; Ctrl+Shift keeps it
   from taking a browser's plain F5 or Ctrl+F5, and Ctrl+Shift+R, the other
   reflex, is a browser's own hard reload, so it is left alone. */
const REFRESH_MODS: Modifiers = Modifiers::CONTROL.union(Modifiers::SHIFT);
const REFRESH_CODE: Code = Code::F5;
const REFRESH_LABEL: &str = "Ctrl+Shift+F5";

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

/* Whether the orb is filling the screen (see orb_layer). Read when the 3D
   viewer or a workspace pane is created, so one opened while he is in the
   full-screen environment is born above it instead of behind it. */
static ORB_EXPANDED: AtomicBool = AtomicBool::new(false);

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

/* ------------------------------------------------------------------
   GESTURE ZOOM — the operating-system half.

   The camera window tracks his hands and decides HOW MUCH to zoom
   (gesture-zoom.js). This half answers two questions for it and never
   decides anything on its own:

   zoom_target — which window is he working in, and what is it: the
   program's file name, its window class, whether it is full screen,
   whether the pointer is over it. The foreground window, except when
   that is our own orb or camera (he clicked it): then the last window
   he WAS working in, remembered here each time it is asked.

   zoom_send — deliver a number of zoom notches to that window in the one
   form the page chose for it: Ctrl+wheel, the plain wheel, Alt+wheel or
   Ctrl+= / Ctrl+-. Only to the window asked about, only while it is in
   front (put back in front and CHECKED if our own camera window took
   focus — close_browser_tab's guard), and a wheel only where WindowFromPoint
   says that very window is under the pointer, because Windows sends the
   wheel to whatever is under the pointer, not to the foreground. Nothing
   here moves or resizes any window.
------------------------------------------------------------------ */
static ZOOM_LAST_EXTERNAL: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

/* Our own windows by native handle, labelled: the orb ("main") and the
   camera are never zoomed; the 3D viewer ("model") is zoomed directly by
   the page, not through the OS; the workspace panes ("ws-...") are
   webviews and take Ctrl+wheel like a browser. */
#[cfg(target_os = "windows")]
fn zoom_own_windows(app: &tauri::AppHandle) -> Vec<(String, isize)> {
    app.webview_windows()
        .into_iter()
        .filter_map(|(label, w)| w.hwnd().ok().map(|h| (label, h.0 as isize)))
        .collect()
}

#[cfg(target_os = "windows")]
fn zoom_is_control(label: &str) -> bool {
    label == "main" || label == "camera"
}

#[cfg(target_os = "windows")]
unsafe fn zoom_exe_of_pid(pid: u32) -> String {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 1024];
        let mut len: u32 = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
        CloseHandle(h);
        if ok == 0 {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or("").to_lowercase()
    }
}

/* A Store app's window belongs to ApplicationFrameHost.exe; the program
   itself is a child window in another process, and that is the name that
   says what it is. */
#[cfg(target_os = "windows")]
unsafe fn zoom_exe_of_window(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetWindowThreadProcessId};
    struct Find {
        frame: u32,
        found: u32,
    }
    unsafe extern "system" fn visit(child: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            let f = &mut *(lparam as *mut Find);
            let mut p: u32 = 0;
            GetWindowThreadProcessId(child, &mut p);
            if p != 0 && p != f.frame {
                f.found = p;
                return 0;
            }
            1
        }
    }
    unsafe {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let exe = zoom_exe_of_pid(pid);
        if exe != "applicationframehost.exe" {
            return exe;
        }
        let mut f = Find { frame: pid, found: 0 };
        EnumChildWindows(hwnd, Some(visit), &mut f as *mut Find as LPARAM);
        if f.found != 0 {
            zoom_exe_of_pid(f.found)
        } else {
            exe
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn zoom_class_of(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    unsafe {
        let mut buf = [0u16; 256];
        let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if n > 0 {
            String::from_utf16_lossy(&buf[..n as usize])
        } else {
            String::new()
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn zoom_title_of(hwnd: windows_sys::Win32::Foundation::HWND) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowTextW;
    unsafe {
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if n > 0 {
            String::from_utf16_lossy(&buf[..n as usize])
        } else {
            String::new()
        }
    }
}

/* Covering its whole monitor: full screen, or a borderless game. */
#[cfg(target_os = "windows")]
unsafe fn zoom_covers_monitor(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    unsafe {
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut r) == 0 {
            return false;
        }
        let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if mon.is_null() {
            return false;
        }
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut mi) == 0 {
            return false;
        }
        let m = mi.rcMonitor;
        r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom
    }
}

/* The top-level window actually under a point of the screen. */
#[cfg(target_os = "windows")]
unsafe fn zoom_root_at(pt: windows_sys::Win32::Foundation::POINT) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, WindowFromPoint, GA_ROOT};
    unsafe {
        let h = WindowFromPoint(pt);
        if h.is_null() {
            0
        } else {
            GetAncestor(h, GA_ROOT) as isize
        }
    }
}

/* Where a wheel notch will land on this window. The pointer, if it is
   already over the window — the content zooms around what he is looking
   at. Otherwise the middle of the window, or the nearest point to it that
   is not covered by something else (our own always-on-top camera, say). */
#[cfg(target_os = "windows")]
unsafe fn zoom_aim_at(hwnd: windows_sys::Win32::Foundation::HWND) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, GetCursorPos, SetCursorPos};
    unsafe {
        let target = hwnd as isize;
        let mut cur = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut cur) != 0 && zoom_root_at(cur) == target {
            return Ok(());
        }
        let mut rc: RECT = std::mem::zeroed();
        if GetClientRect(hwnd, &mut rc) == 0 {
            return Err("could not read the window's size".into());
        }
        let (w, h) = (rc.right - rc.left, rc.bottom - rc.top);
        if w < 8 || h < 8 {
            return Err("the window has no room to zoom".into());
        }
        let spots = [
            (0.5, 0.5), (0.5, 0.35), (0.35, 0.5), (0.65, 0.5), (0.5, 0.65), (0.3, 0.3), (0.7, 0.7),
        ];
        for (fx, fy) in spots {
            let mut p = POINT {
                x: rc.left + (w as f32 * fx) as i32,
                y: rc.top + (h as f32 * fy) as i32,
            };
            ClientToScreen(hwnd, &mut p);
            if zoom_root_at(p) == target {
                SetCursorPos(p.x, p.y);
                return Ok(());
            }
        }
        Err("the window is covered where it would be zoomed".into())
    }
}

/* Points of a window given as x,y fractions of its client area (2.15.0),
   on the screen, in order, keeping only those where that window really is
   (not covered by another — our camera box, say). */
#[cfg(target_os = "windows")]
unsafe fn aim_points(hwnd: windows_sys::Win32::Foundation::HWND, fractions: &[f64]) -> Vec<(i32, i32)> {
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClientRect;
    let mut out = Vec::new();
    unsafe {
        let mut rc: RECT = std::mem::zeroed();
        if GetClientRect(hwnd, &mut rc) == 0 {
            return out;
        }
        let (w, h) = ((rc.right - rc.left) as f64, (rc.bottom - rc.top) as f64);
        for pair in fractions.chunks_exact(2) {
            let (fx, fy) = (pair[0], pair[1]);
            if !fx.is_finite() || !fy.is_finite() {
                continue;
            }
            let mut p = POINT { x: (w * fx.clamp(0.0, 1.0)).round() as i32, y: (h * fy.clamp(0.0, 1.0)).round() as i32 };
            ClientToScreen(hwnd, &mut p);
            if zoom_root_at(p) == hwnd as isize {
                out.push((p.x, p.y));
            }
        }
    }
    out
}

/* Whether the pointer shows the plain arrow. Over the Agent Atlas that
   means bare map: its labels and agents show the hand, panel text the
   text cursor. Unknown (no cursor shown, a touch screen) counts as yes. */
#[cfg(target_os = "windows")]
unsafe fn cursor_is_arrow() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorInfo, LoadCursorW, CURSORINFO, CURSOR_SHOWING, IDC_ARROW,
    };
    unsafe {
        let mut ci: CURSORINFO = std::mem::zeroed();
        ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
        if GetCursorInfo(&mut ci) == 0 || ci.flags & CURSOR_SHOWING == 0 {
            return true;
        }
        ci.hCursor == LoadCursorW(std::ptr::null_mut(), IDC_ARROW)
    }
}

/* WHERE TO PRESS (2.15.0). The Atlas's labels turn with the map, so no
   fixed point of its window is always bare map: a press on a label never
   reaches the 3D view (and its release is a click on that agent). So each
   candidate is TRIED the way a person would: the pointer goes there, the
   program gets a moment to show its cursor, and the first place it shows
   the plain arrow is the one. If none does, the first visible one. */
#[cfg(target_os = "windows")]
unsafe fn aim_probe(hwnd: windows_sys::Win32::Foundation::HWND, fractions: &[f64]) -> Option<(i32, i32)> {
    unsafe {
        let pts = aim_points(hwnd, fractions);
        for &(x, y) in pts.iter().take(12) {
            let mut v = [drag_input(x as f64, y as f64, 0)];
            drag_inputs(&mut v);
            std::thread::sleep(std::time::Duration::from_millis(50));
            if cursor_is_arrow() {
                return Some((x, y));
            }
        }
        pts.first().copied()
    }
}

/* A wheel aimed at bare map: where the pointer already is, if that is this
   window and shows the arrow; else the first candidate that does; the
   usual aim without candidates. */
#[cfg(target_os = "windows")]
unsafe fn zoom_aim_points(hwnd: windows_sys::Win32::Foundation::HWND, fractions: &[f64]) -> Result<(), String> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};
    unsafe {
        let mut cur = POINT { x: 0, y: 0 };
        if GetCursorPos(&mut cur) != 0 && zoom_root_at(cur) == hwnd as isize && cursor_is_arrow() {
            return Ok(());
        }
        match aim_probe(hwnd, fractions) {
            Some((x, y)) => {
                SetCursorPos(x, y);
                Ok(())
            }
            None => zoom_aim_at(hwnd),
        }
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn zoom_target(app: tauri::AppHandle) -> serde_json::Value {
    use windows_sys::Win32::Foundation::{HWND, POINT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetForegroundWindow, IsIconic, IsWindow,
    };
    let own = zoom_own_windows(&app);
    let label_of = |h: isize| own.iter().find(|(_, x)| *x == h).map(|(l, _)| l.clone());
    unsafe {
        let fg = GetForegroundWindow() as isize;
        let fg_is_control = label_of(fg).map(|l| zoom_is_control(&l)).unwrap_or(false);
        let target = if fg != 0 && !fg_is_control {
            ZOOM_LAST_EXTERNAL.store(fg, Ordering::SeqCst);
            fg
        } else {
            ZOOM_LAST_EXTERNAL.load(Ordering::SeqCst)
        };
        if target == 0 || IsWindow(target as HWND) == 0 {
            return serde_json::json!({ "hwnd": 0, "error": "no window is in front" });
        }
        let h = target as HWND;
        let mut cur = POINT { x: 0, y: 0 };
        let cursor_inside = GetCursorPos(&mut cur) != 0 && zoom_root_at(cur) == target;
        serde_json::json!({
            "hwnd": target,
            "exe": zoom_exe_of_window(h),
            "class": zoom_class_of(h),
            "title": zoom_title_of(h),
            "own": label_of(target),
            "fullscreen": zoom_covers_monitor(h),
            "minimized": IsIconic(h) != 0,
            "foreground": fg == target,
            "cursor_inside": cursor_inside
        })
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn zoom_send(
    app: tauri::AppHandle,
    hwnd: isize,
    method: String,
    notches: i32,
    aim: Option<Vec<f64>>,
) -> Result<String, String> {
    use std::{thread, time::Duration};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP,
        MOUSEEVENTF_WHEEL, MOUSEINPUT, VIRTUAL_KEY, VK_CONTROL, VK_MENU, VK_OEM_MINUS, VK_OEM_PLUS,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsIconic, IsWindow, SetForegroundWindow,
    };

    if notches == 0 {
        return Ok("nothing to send".into());
    }
    let n = notches.clamp(-6, 6);
    let own = zoom_own_windows(&app);
    let label_of = |h: isize| own.iter().find(|(_, x)| *x == h).map(|(l, _)| l.clone());
    if let Some(l) = label_of(hwnd) {
        if zoom_is_control(&l) || l == "model" {
            return Err("that is JARVIS's own window".into());
        }
    }

    unsafe {
        let h = hwnd as HWND;
        if hwnd == 0 || IsWindow(h) == 0 {
            return Err("that window is gone".into());
        }
        if IsIconic(h) != 0 {
            return Err("the window is minimised".into());
        }
        let fg = GetForegroundWindow() as isize;
        if fg != hwnd {
            /* He clicked our camera window (or the orb): put the program he
               was working in back in front, and check that it really is,
               before a single notch goes anywhere. Anything else in front
               means he switched programs — send nothing; the page re-reads
               the foreground and carries on with that one. */
            let ours = label_of(fg).map(|l| zoom_is_control(&l)).unwrap_or(false);
            if !(ours || fg == 0) {
                return Err("foreground changed".into());
            }
            SetForegroundWindow(h);
            thread::sleep(Duration::from_millis(60));
            if GetForegroundWindow() as isize != hwnd {
                return Err("could not bring the window forward, so nothing was sent".into());
            }
        }

        let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        const NOTCH: i32 = 120; // WHEEL_DELTA: one click of a wheel
        let wheel = |delta: i32| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: delta as u32,
                    dwFlags: MOUSEEVENTF_WHEEL,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        /* An unassigned key, pressed while Alt is down: without it, letting
           go of Alt on its own opens the program's menu bar. */
        const MENU_MASK: VIRTUAL_KEY = 0xE8;

        let count = n.unsigned_abs() as usize;
        let mut inputs: Vec<INPUT> = Vec::with_capacity(count * 2 + 4);
        let modifier: Option<VIRTUAL_KEY>;
        match method.as_str() {
            "ctrl_wheel" | "wheel" | "alt_wheel" => {
                match aim.as_deref() {
                    Some(fr) if fr.len() >= 2 => zoom_aim_points(h, fr)?,
                    _ => zoom_aim_at(h)?,
                }
                modifier = match method.as_str() {
                    "ctrl_wheel" => Some(VK_CONTROL),
                    "alt_wheel" => Some(VK_MENU),
                    _ => None,
                };
                if let Some(m) = modifier {
                    inputs.push(key(m, false));
                }
                for _ in 0..count {
                    inputs.push(wheel(if n > 0 { NOTCH } else { -NOTCH }));
                }
                if modifier == Some(VK_MENU) {
                    inputs.push(key(MENU_MASK, false));
                    inputs.push(key(MENU_MASK, true));
                }
                if let Some(m) = modifier {
                    inputs.push(key(m, true));
                }
            }
            "ctrl_keys" => {
                modifier = Some(VK_CONTROL);
                let vk = if n > 0 { VK_OEM_PLUS } else { VK_OEM_MINUS };
                inputs.push(key(VK_CONTROL, false));
                for _ in 0..count {
                    inputs.push(key(vk, false));
                    inputs.push(key(vk, true));
                }
                inputs.push(key(VK_CONTROL, true));
            }
            other => return Err(format!("unknown zoom method \"{}\"", other)),
        }

        let sent = SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
        if (sent as usize) < inputs.len() {
            /* A modifier left down would turn his next click into Ctrl+click. */
            if let Some(m) = modifier {
                let mut up = [key(m, true)];
                SendInput(1, up.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
            }
            return Err("Windows blocked the input (an elevated program, or a secure screen)".into());
        }
    }
    Ok(format!("{} {}", method, n))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn zoom_target() -> serde_json::Value {
    serde_json::json!({ "hwnd": 0, "error": "gesture zoom drives Windows programs, and this is not Windows" })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn zoom_send(_hwnd: isize, _method: String, _notches: i32, _aim: Option<Vec<f64>>) -> Result<String, String> {
    Err("only available on Windows".into())
}

/* ------------------------------------------------------------------
   "BRING THE CAMERA TO THIS WINDOW" (page 2.10.1)

   He moves between programs and wants the camera, or any other window,
   to come with him: to the window he is working in now, as a small
   window in its corner, whatever size it was before.

   "Here" is the window he is working in: the foreground window, unless
   that is one of ours (he typed to the orb, or clicked the camera), in
   which case the topmost real program window below ours — EnumWindows
   walks top-level windows in Z order, so the first real one is the one he
   was last in. The window to bring is one of ours by label ("camera",
   "model", "main", a workspace pane), or a program found by its file name
   and title, the same way gesture zoom names programs.

   Nothing takes the keyboard away from him: a program is restored with
   SW_SHOWNOACTIVATE and raised with SWP_NOACTIVATE, above the window he
   is in and no further. An elevated program refuses a move from a normal
   one (UIPI) and that is reported, not hidden.
------------------------------------------------------------------ */
#[cfg(target_os = "windows")]
struct BringCandidate {
    hwnd: isize,
    exe: String,
    title: String,
    iconic: bool,
}

/* A window worth calling a program: visible, not a tool window, not owned
   by another (a dialog, a tooltip), not cloaked (a Store app parked on
   another virtual desktop or suspended), not the shell, and not a sliver. */
#[cfg(target_os = "windows")]
unsafe fn bring_is_app_window(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowLongW, GetWindowRect, IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
        WS_EX_TOOLWINDOW,
    };
    unsafe {
        if IsWindowVisible(hwnd) == 0 {
            return false;
        }
        if (GetWindowLongW(hwnd, GWL_EXSTYLE) as u32) & WS_EX_TOOLWINDOW != 0 {
            return false;
        }
        if !GetWindow(hwnd, GW_OWNER).is_null() {
            return false;
        }
        let mut cloaked: u32 = 0;
        if DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut u32 as *mut core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        ) == 0
            && cloaked != 0
        {
            return false;
        }
        let class = zoom_class_of(hwnd);
        if matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
                | "Windows.UI.Core.CoreWindow" | "NotifyIconOverflowWindow"
        ) {
            return false;
        }
        if zoom_title_of(hwnd).trim().is_empty() {
            return false;
        }
        if IsIconic(hwnd) != 0 {
            return true;
        }
        let mut r: RECT = std::mem::zeroed();
        GetWindowRect(hwnd, &mut r) != 0 && r.right - r.left >= 120 && r.bottom - r.top >= 80
    }
}

/* Every program window, topmost first, with its file name and title. */
#[cfg(target_os = "windows")]
fn bring_app_windows(own: &[(String, isize)]) -> Vec<BringCandidate> {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, IsIconic};
    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        unsafe {
            let list = &mut *(lparam as *mut Vec<isize>);
            list.push(hwnd as isize);
        }
        1
    }
    let mut all: Vec<isize> = Vec::new();
    unsafe {
        EnumWindows(Some(visit), &mut all as *mut Vec<isize> as LPARAM);
    }
    all.into_iter()
        .filter(|h| !own.iter().any(|(_, x)| x == h))
        .filter(|h| unsafe { bring_is_app_window(*h as HWND) })
        .map(|h| unsafe {
            let exe = zoom_exe_of_window(h as HWND);
            BringCandidate {
                hwnd: h,
                exe: exe.trim_end_matches(".exe").to_string(),
                title: zoom_title_of(h as HWND),
                iconic: IsIconic(h as HWND) != 0,
            }
        })
        .collect()
}

/* How well a window answers to what he said: the file name exactly beats
   a title that mentions it, which beats a file name that only contains it.
   Needles arrive lower-case from the page. */
#[cfg(target_os = "windows")]
fn bring_score(c: &BringCandidate, exe: &[String], title: &[String]) -> i32 {
    let t = c.title.to_lowercase();
    let mut best = 0;
    for n in exe.iter().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
        let n = n.trim_end_matches(".exe").to_string();
        if c.exe == n {
            best = best.max(4);
        } else if c.exe.contains(&n) {
            best = best.max(2);
        }
    }
    for n in title.iter().map(|s| s.trim().to_lowercase()).filter(|s| s.len() >= 2) {
        if t.contains(&n) {
            best = best.max(3);
        }
    }
    best
}

/* The usable part of the monitor a window (or, with none, the pointer) is
   on: [left, top, right, bottom], physical pixels. */
#[cfg(target_os = "windows")]
unsafe fn bring_work_area_of(hwnd: isize) -> Option<[i32; 4]> {
    use windows_sys::Win32::Foundation::{HWND, POINT};
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mon = if hwnd != 0 {
            MonitorFromWindow(hwnd as HWND, MONITOR_DEFAULTTONEAREST)
        } else {
            let mut p = POINT { x: 0, y: 0 };
            GetCursorPos(&mut p);
            MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST)
        };
        if mon.is_null() {
            return None;
        }
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut mi) == 0 {
            return None;
        }
        let w = mi.rcWork;
        Some([w.left, w.top, w.right, w.bottom])
    }
}

/* The size a brought window arrives at, from the size of the screen it
   arrives on — small, whatever it was: the camera a picture-in-picture,
   the 3D viewer a square, anything else a little landscape window. */
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn bring_size(kind: &str, work_w: i32, work_h: i32) -> (i32, i32) {
    let clamp = |v: f32, lo: i32, hi: i32| (v.round() as i32).max(lo).min(hi);
    let (w, h) = match kind {
        "camera" => {
            let w = clamp(work_w as f32 * 0.20, 280, 480);
            (w, (w as f32 * 0.8).round() as i32)
        }
        "model" => {
            let w = clamp(work_w as f32 * 0.22, 300, 560);
            (w, w)
        }
        _ => {
            let w = clamp(work_w as f32 * 0.30, 440, 760);
            (w, (w as f32 * 0.66).round() as i32)
        }
    };
    (w.min(work_w - 16).max(1), h.min((work_h as f32 * 0.7) as i32).max(1))
}

/* Where it lands: the bottom-right corner of the window he is in (as much
   of it as is on the screen), 24 px in — or the next corner along when that
   one is where the orb sits, so it never lands on top of JARVIS himself. */
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn bring_place(here: [i32; 4], work: [i32; 4], size: (i32, i32), avoid: Option<[i32; 4]>) -> (i32, i32) {
    let (w, h) = size;
    let l = here[0].max(work[0]);
    let t = here[1].max(work[1]);
    let r = here[2].min(work[2]);
    let b = here[3].min(work[3]);
    let (l, t, r, b) = if r - l < w / 2 || b - t < h / 2 { (work[0], work[1], work[2], work[3]) } else { (l, t, r, b) };
    let m = 24;
    let corners = [(r - w - m, b - h - m), (r - w - m, t + m), (l + m, b - h - m), (l + m, t + m)];
    let fit = |(x, y): (i32, i32)| {
        (x.max(work[0] + 8).min(work[2] - w - 8).max(work[0]), y.max(work[1] + 8).min(work[3] - h - 8).max(work[1]))
    };
    let clear = |(x, y): (i32, i32)| match avoid {
        Some(a) => x + w <= a[0] || x >= a[2] || y + h <= a[1] || y >= a[3],
        None => true,
    };
    for c in corners.iter() {
        let p = fit(*c);
        if clear(p) {
            return p;
        }
    }
    fit(corners[0])
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn bring_window_here(
    app: tauri::AppHandle,
    own: Option<String>,
    exe: Vec<String>,
    title: Vec<String>,
) -> Result<serde_json::Value, String> {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, IsIconic, IsZoomed, SetWindowPos, ShowWindow,
        HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SW_SHOWNOACTIVATE,
    };
    let own_windows = zoom_own_windows(&app);
    let is_ours = |h: isize| own_windows.iter().any(|(_, x)| *x == h);
    let apps = bring_app_windows(&own_windows);
    let rect_of = |h: isize| unsafe {
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(h as HWND, &mut r) != 0 { Some([r.left, r.top, r.right, r.bottom]) } else { None }
    };

    /* Ours, when it is ours. A workspace pane that is not open is looked
       for among the programs instead (Shopify in his browser). */
    let own_label = own.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let own_target = own_label.as_ref().and_then(|l| app.get_webview_window(l));
    if let Some(l) = own_label.as_ref() {
        if own_target.is_none() && !l.starts_with("ws-") {
            return Err("not_open".into());
        }
    }

    /* The window he is in. */
    let fg = unsafe { GetForegroundWindow() } as isize;
    let fg_ok = fg != 0 && !is_ours(fg) && apps.iter().any(|c| c.hwnd == fg && !c.iconic);
    /* Otherwise the topmost program on screen — a minimised one is not
       where he is working. */
    let first_open = apps.iter().find(|c| !c.iconic).map(|c| c.hwnd).unwrap_or(0);
    let pick_target = |exclude: isize| -> Option<&BringCandidate> {
        let mut best: Option<(&BringCandidate, i32)> = None;
        for c in apps.iter().filter(|c| c.hwnd != exclude) {
            let s = bring_score(c, &exe, &title);
            if s > 0 && best.map(|(_, b)| s > b).unwrap_or(true) {
                best = Some((c, s));
            }
        }
        best.map(|(c, _)| c)
    };

    let (here, target_hwnd, target_name): (isize, isize, String) = if let Some(w) = own_target.as_ref() {
        let h = w.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        let here = if fg_ok { fg } else { first_open };
        (here, h, own_label.clone().unwrap_or_default())
    } else {
        let here = if fg_ok { fg } else { first_open };
        match pick_target(here) {
            Some(c) => {
                /* When the only match is not the window he is in but the
                   one after it in Z order was taken as "here", fine; when
                   the only match IS the window he is in, say so. */
                (here, c.hwnd, if c.title.is_empty() { c.exe.clone() } else { c.title.clone() })
            }
            None => {
                if here != 0 && apps.iter().any(|c| c.hwnd == here && bring_score(c, &exe, &title) > 0) {
                    return Ok(serde_json::json!({ "ok": true, "already_here": true }));
                }
                let mut open: Vec<String> = Vec::new();
                for c in apps.iter() {
                    if !c.exe.is_empty() && !open.contains(&c.exe) && open.len() < 12 {
                        open.push(c.exe.clone());
                    }
                }
                return Ok(serde_json::json!({ "ok": false, "error": "not_found", "open": open }));
            }
        }
    };
    if target_hwnd == 0 {
        return Err("that window has no native handle".into());
    }

    let here_rect = if here != 0 { rect_of(here) } else { None };
    let work = unsafe { bring_work_area_of(if here != 0 { here } else { 0 }) }
        .ok_or("could not read the screen's size")?;
    let here_rect = here_rect.unwrap_or(work);
    let kind = match own_label.as_deref() {
        Some("camera") => "camera",
        Some("model") => "model",
        _ => "app",
    };
    let avoid = if own_label.as_deref() == Some("main") {
        None
    } else {
        app.get_webview_window("main").and_then(|m| m.hwnd().ok()).and_then(|h| rect_of(h.0 as isize))
    };

    /* The orb keeps its own size: it is small already, and it lays itself
       out for that size. Only its place changes. */
    if own_label.as_deref() == Some("main") {
        let win = own_target.as_ref().ok_or("the orb is missing")?;
        let sz = win.outer_size().map_err(|e| e.to_string())?;
        let (x, y) = bring_place(here_rect, work, (sz.width as i32, sz.height as i32), None);
        let _ = win.unminimize();
        win.set_position(tauri::PhysicalPosition { x, y }).map_err(|e| e.to_string())?;
        let _ = win.show();
        return Ok(serde_json::json!({ "ok": true, "moved": "main", "x": x, "y": y }));
    }

    let (w, h) = bring_size(kind, work[2] - work[0], work[3] - work[1]);
    let (x, y) = bring_place(here_rect, work, (w, h), avoid);

    if let Some(win) = own_target.as_ref() {
        /* Out of full screen or maximised first, or the new size is
           ignored; then the size (inner, so the frame is added on top of
           it) and the place. It keeps its own always-on-top setting. */
        let _ = win.set_fullscreen(false);
        let _ = win.unmaximize();
        let _ = win.unminimize();
        let frame = match (win.outer_size(), win.inner_size()) {
            (Ok(o), Ok(i)) => (o.width as i32 - i.width as i32, o.height as i32 - i.height as i32),
            _ => (0, 0),
        };
        let (iw, ih) = ((w - frame.0).max(160), (h - frame.1).max(120));
        win.set_size(tauri::PhysicalSize { width: iw as u32, height: ih as u32 }).map_err(|e| e.to_string())?;
        win.set_position(tauri::PhysicalPosition { x, y }).map_err(|e| e.to_string())?;
        let _ = win.show();
        return Ok(serde_json::json!({
            "ok": true, "moved": target_name, "x": x, "y": y, "w": w, "h": h,
            "here": if here != 0 { unsafe { zoom_title_of(here as HWND) } } else { String::new() }
        }));
    }

    unsafe {
        let t = target_hwnd as HWND;
        /* Out of maximised or minimised without being activated: a
           maximised window ignores a new size, and SW_RESTORE would take
           the keyboard from the window he is typing in. */
        if IsIconic(t) != 0 || IsZoomed(t) != 0 {
            ShowWindow(t, SW_SHOWNOACTIVATE);
        }
        /* Topmost and straight back: that leaves it at the top of the
           ordinary windows — above the one he is in, below the orb. */
        let placed = SetWindowPos(t, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        SetWindowPos(t, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        if placed == 0 {
            return Ok(serde_json::json!({
                "ok": false, "error": "refused", "name": target_name,
                "why": "Windows would not let it be moved — it is probably running as administrator"
            }));
        }
    }
    Ok(serde_json::json!({
        "ok": true, "moved": target_name, "x": x, "y": y, "w": w, "h": h,
        "here": if here != 0 { unsafe { zoom_title_of(here as HWND) } } else { String::new() }
    }))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn bring_window_here(
    _own: Option<String>,
    _exe: Vec<String>,
    _title: Vec<String>,
) -> Result<serde_json::Value, String> {
    Err("moving other programs' windows is only available on Windows".into())
}


/* Screen capture. The point is not to save a file — it is to let him SEE
   what you are looking at, so the image goes back as base64 and straight
   into the conversation as an attachment. He already handles images; this
   just gives him eyes on your screen when you ask for them.

   Captures the primary monitor only. Multi-monitor selection would need a
   way to say which one, and there is no obvious vocabulary for that by
   voice — "the left one" means nothing to a display index. */
/* JARVIS DOES NOT SEE HIMSELF.

   The capture below is the composed desktop, so with the orb full screen it
   was a picture of JARVIS's own interface: "look at my screen" and "make a
   3D model of what is on my screen" got the HUD instead of his work. For
   the moment of a capture the orb is excluded from it
   (WDA_EXCLUDEFROMCAPTURE, Windows 10 2004 and later) and put back straight
   after. Nothing changes on screen, and his own screenshots and screen
   shares are untouched. On an older Windows the call fails and the capture
   is simply what it always was. */
#[cfg(target_os = "windows")]
struct OrbOutOfCapture(isize);

#[cfg(target_os = "windows")]
impl OrbOutOfCapture {
    fn new(app: &tauri::AppHandle) -> Self {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IsWindowVisible, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
        };
        let h = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize)
            .unwrap_or(0);
        unsafe {
            if h != 0
                && IsWindowVisible(h as HWND) != 0
                && SetWindowDisplayAffinity(h as HWND, WDA_EXCLUDEFROMCAPTURE) != 0
            {
                // One composition pass for DWM to apply it (~16 ms a frame).
                std::thread::sleep(std::time::Duration::from_millis(70));
                return OrbOutOfCapture(h);
            }
        }
        OrbOutOfCapture(0)
    }
}

#[cfg(target_os = "windows")]
impl Drop for OrbOutOfCapture {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_NONE};
        if self.0 != 0 {
            unsafe {
                SetWindowDisplayAffinity(self.0 as HWND, WDA_NONE);
            }
        }
    }
}

#[tauri::command]
fn take_screenshot(app: tauri::AppHandle) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Cursor;
    use dirs_next;
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| format!("could not list monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| "no primary monitor found".to_string())?;

    #[cfg(target_os = "windows")]
    let hidden = OrbOutOfCapture::new(&app);
    #[cfg(not(target_os = "windows"))]
    let _ = &app;
    let image = monitor
        .capture_image()
        .map_err(|e| format!("capture failed: {e}"))?;
    #[cfg(target_os = "windows")]
    drop(hidden);

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
fn capture_screen_frame(app: tauri::AppHandle) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::io::Cursor;
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| format!("could not list monitors: {e}"))?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary())
        .ok_or_else(|| "no primary monitor found".to_string())?;

    #[cfg(target_os = "windows")]
    let hidden = OrbOutOfCapture::new(&app);
    #[cfg(not(target_os = "windows"))]
    let _ = &app;
    let image = monitor
        .capture_image()
        .map_err(|e| format!("capture failed: {e}"))?;
    #[cfg(target_os = "windows")]
    drop(hidden);

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
 * A real window of its own, like the workspace panes, NOT always-on-top, so it
 * can sit beside the work it is about instead of on top of it. Since 2.9.3 it
 * has no frame and no background at all — he asked for the model to stand on
 * the desktop by itself. It stays in the taskbar, because with no title bar
 * the taskbar and the viewer's own right-click → Close are the ways to close
 * it; Shift-drag in the viewer moves it.
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
async fn open_model_window(app: tauri::AppHandle, url: String, name: Option<String>) -> Result<String, String> {
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
    let mut page = format!("model.html?glb={}", encoded);
    /* The model's name, for the file Save writes. Encoded the same way. */
    if let Some(n) = name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        page.push_str("&name=");
        for b in n.chars().take(80).collect::<String>().as_bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => page.push(*b as char),
                _ => page.push_str(&format!("%{:02X}", b)),
            }
        }
    }

    if let Some(existing) = app.get_webview_window("model") {
        let _ = existing.eval(&format!("location.replace({:?})", page));
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok("reused".into());
    }

    let builder = WebviewWindowBuilder::new(&app, "model", WebviewUrl::App(page.into()))
        .title("JARVIS — 3D")
        .inner_size(620.0, 620.0)
        .min_inner_size(240.0, 240.0)
        .center()
        .resizable(true)
        .decorations(false)
        .shadow(false)
        /* Above the orb while the orb fills the screen: that window is
           opaque edge to edge, and a model opened behind it was a model
           nobody ever saw. Ordinary otherwise. */
        .always_on_top(ORB_EXPANDED.load(Ordering::SeqCst))
        .skip_taskbar(false);
    // A see-through webview needs the private API on macOS; everywhere else
    // it is an ordinary window attribute.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    let win = builder.build().map_err(|e| e.to_string())?;
    /* Centred on the screen the orb is on, not always on the primary one:
       with the orb full screen on a second monitor, the model opened on
       the other, out of sight. */
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(Some(mon)), Ok(size)) = (main.current_monitor(), win.outer_size()) {
            let (mp, ms) = (mon.position(), mon.size());
            let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
            let y = mp.y + (ms.height as i32 - size.height as i32) / 2;
            let _ = win.set_position(tauri::PhysicalPosition { x, y });
        }
    }
    let _ = win.set_focus();
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
        raise_own_window(&existing, false);
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
        .always_on_top(ORB_EXPANDED.load(Ordering::SeqCst))
        .skip_taskbar(false)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.set_position(tauri::PhysicalPosition { x, y });
    let _ = win.set_size(tauri::PhysicalSize {
        width: w as u32,
        height: h as u32,
    });
    let _ = win.show();
    raise_own_window(&win, false);
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

/* REFRESH (2.11.0) — a way back when he is broken.

   The orb page can wedge: a capture that never closed, a request that never
   came back, a state flag left set. Restarting the whole app was the only
   cure. This reloads just the orb's page — the conversation is saved
   before every turn and the PIN is kept for the session, so nothing is
   lost — from Rust, so it works even when the page's own script is stuck
   and cannot run its menu. Full screen and the window order are put back
   first: a reloaded page starts as the small orb and must not find its
   window still filling the screen. Reached from the hotkey (REFRESH_*),
   the tray, and the orb's right-click menu. */
fn refresh_orb_now(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_fullscreen(false);
        ORB_EXPANDED.store(false, Ordering::SeqCst);
        let _ = main.set_always_on_top(true);
        for (label, w) in app.webview_windows() {
            if label == "model" || label.starts_with("ws-") {
                let _ = w.set_always_on_top(false);
            }
        }
        let _ = main.show();
        if main.reload().is_err() {
            let _ = main.eval("location.reload()");
        }
    }
}

#[tauri::command]
fn refresh_orb(app: tauri::AppHandle) {
    refresh_orb_now(&app);
}

/* SAVING A MODEL — into his JARVIS folder.

   He already has a folder called JARVIS on this computer; the 3D viewer's
   right-click → Save puts the .glb there. It is looked for where people
   keep such a folder (the desktop, Documents, the home folder, OneDrive's
   copies of those, Downloads, Pictures, the root of the usual drives),
   under its English or Hebrew name — Windows paths are case-insensitive,
   so "Jarvis" is found as "JARVIS". Only if there is none anywhere is one
   made, on the desktop, and the answer says where it went. The bytes must
   be a real binary glTF: this writes models, not whatever it is handed. */
fn jarvis_folder() -> Option<std::path::PathBuf> {
    let names = ["JARVIS", "Jarvis", "jarvis", "ג'רוויס", "ג׳רוויס", "גרוויס"];
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Some(d) = dirs_next::desktop_dir() {
        roots.push(d);
    }
    if let Some(d) = dirs_next::document_dir() {
        roots.push(d);
    }
    if let Some(h) = dirs_next::home_dir() {
        roots.push(h.join("OneDrive").join("Desktop"));
        roots.push(h.join("OneDrive").join("Documents"));
        roots.push(h.join("OneDrive"));
        roots.push(h);
    }
    if let Some(d) = dirs_next::download_dir() {
        roots.push(d);
    }
    if let Some(d) = dirs_next::picture_dir() {
        roots.push(d);
    }
    #[cfg(target_os = "windows")]
    for drive in ["C:\\", "D:\\", "E:\\"] {
        roots.push(std::path::PathBuf::from(drive));
    }
    for r in &roots {
        for n in names {
            let p = r.join(n);
            if p.is_dir() {
                return Some(p);
            }
        }
    }
    let base = dirs_next::desktop_dir().or_else(dirs_next::document_dir)?;
    let p = base.join("JARVIS");
    std::fs::create_dir_all(&p).ok()?;
    Some(p)
}

fn model_file_stem(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("-");
    if s.chars().count() > 60 {
        s = s.chars().take(60).collect();
    }
    if s.is_empty() {
        return "model".to_string();
    }
    /* Names Windows will not create a file under, whatever the extension. */
    let upper = s.to_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str())
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.as_bytes()[3].is_ascii_digit());
    if reserved {
        format!("model-{}", s)
    } else {
        s
    }
}

#[tauri::command]
fn save_model_file(b64: String, name: String) -> Result<serde_json::Value, String> {
    let dir = jarvis_folder().ok_or("could not find or make a JARVIS folder")?;
    let path = write_glb(&dir, &b64, &name)?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(serde_json::json!({ "path": path.display().to_string(), "folder": dir.display().to_string(), "bytes": bytes }))
}

/* THE TRACKING RECORDING (2.20.0). The camera window records half a minute of
   what the hand tracker saw — the 21 points of each hand, how long each frame
   took, how late the camera's pictures were, what the pointer did — and hands
   it here as JSON text. It goes in JARVIS\Tracking, under a name that is never
   one already there, so he can send it and the tracking can be studied on his
   own hands and camera instead of guessed at. No picture is in it. */
#[tauri::command]
fn save_trace_file(name: String, text: String) -> Result<serde_json::Value, String> {
    if text.len() > 40 * 1024 * 1024 {
        return Err("the recording is too big to save".into());
    }
    let dir = jarvis_folder().ok_or("could not find or make a JARVIS folder")?.join("Tracking");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make {}: {}", dir.display(), e))?;
    let mut stem: String = name
        .trim_end_matches(".json")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    if stem.is_empty() {
        stem = "tracking".into();
    }
    let mut path = dir.join(format!("{}.json", stem));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{}-{}.json", stem, n));
        n += 1;
    }
    std::fs::write(&path, text.as_bytes()).map_err(|e| format!("could not write {}: {}", path.display(), e))?;
    Ok(serde_json::json!({ "path": path.display().to_string(), "folder": dir.display().to_string(), "bytes": text.len() }))
}

/* A MODEL BUILT IN CODE, HANDED TO THE 3D VIEWER.

   build_3d_model makes its mesh in the orb's page; the viewer is another
   window. A data: URL in the viewer's address stops at about a megabyte
   (Chromium's 2 MB limit, after base64 and percent-encoding), and a blob:
   URL depends on two windows sharing one in-memory store. So the page
   leaves the .glb here, as base64, and the viewer (model.html?glb=stash:KEY)
   asks for it. The last few are kept, so "show it in a window" again still
   finds the latest; older ones are dropped. */
static MODEL_STASH: std::sync::Mutex<Vec<(String, String)>> = std::sync::Mutex::new(Vec::new());
static MODEL_STASH_N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[tauri::command]
fn stash_model(b64: String) -> Result<String, String> {
    if b64.is_empty() || b64.len() > 64 * 1024 * 1024 {
        return Err("no model, or one too large to hold".into());
    }
    let key = format!("m{}", MODEL_STASH_N.fetch_add(1, Ordering::SeqCst) + 1);
    let mut s = MODEL_STASH.lock().map_err(|_| "the model store is unavailable".to_string())?;
    s.push((key.clone(), b64));
    let n = s.len();
    if n > 3 {
        s.drain(0..n - 3);
    }
    Ok(key)
}

#[tauri::command]
fn stashed_model(key: String) -> Result<String, String> {
    let s = MODEL_STASH.lock().map_err(|_| "the model store is unavailable".to_string())?;
    s.iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| v.clone())
        .ok_or_else(|| "that model is no longer held — ask JARVIS to build it again".into())
}

/* HIS OWN APP, "3D WORKSPACE".

   He built a program of his own called 3D WORKSPACE and wants JARVIS to open
   it ("open 3d workspace"), or to open it with the model JARVIS just made
   ("open a new project at 3d workspace with this model"). Nothing here knows
   how he installed it, so it is FOUND by name where Windows keeps programs
   and the shortcuts to them: a path he gave before (the page remembers it),
   the Start menu (his and everyone's), the desktop (and OneDrive's), his
   per-user Programs folder, Program Files. A name counts when, squeezed to
   letters and digits, it holds "3d" and "workspace" — "3D WORKSPACE.lnk",
   "3D-Workspace.exe", "3D Model Workspace" — and never an uninstaller.

   With a model, the .glb is written first into JARVIS\3D Workspace (the same
   glTF check as Save, never overwriting), beside a small handoff file naming
   it, and the program is started with the model's full path as its one
   argument — what Windows does for "Open with". Started through
   ShellExecuteW, so a shortcut, a program, a .url or a script all open the
   way a double-click would, with no command line to quote. */
fn write_glb(dir: &std::path::Path, b64: &str, name: &str) -> Result<std::path::PathBuf, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("that is not a model file ({e})"))?;
    if bytes.len() < 12 || &bytes[0..4] != b"glTF" {
        return Err("that is not a .glb model".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("could not make {}: {e}", dir.display()))?;
    let stem = model_file_stem(name);
    let mut path = dir.join(format!("{}.glb", stem));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{} ({}).glb", stem, n));
        n += 1;
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path)
}

fn ws3d_squeeze(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/* His own programs JARVIS opens by name. 3D Workspace (2.13.0) and, since
   2.15.0, JARVIS Agent Atlas — the same search for both, each with its own
   idea of what its name looks like. */
#[derive(Clone, Copy, PartialEq)]
enum NamedApp {
    Workspace3d,
    AgentAtlas,
}

impl NamedApp {
    fn from_key(key: &str) -> Option<NamedApp> {
        match key {
            "3d_workspace" | "workspace3d" => Some(NamedApp::Workspace3d),
            "agent_atlas" | "atlas" => Some(NamedApp::AgentAtlas),
            _ => None,
        }
    }
    /* Squeezed to letters and digits: the exact name, and a looser match. */
    fn names(self, s: &str) -> (bool, bool) {
        match self {
            NamedApp::Workspace3d => (
                s == "3dworkspace" || s == "workspace3d",
                s.contains("3d") && (s.contains("workspace") || s.contains("workspce")),
            ),
            NamedApp::AgentAtlas => (
                s == "jarvisagentatlas" || s == "agentatlas",
                s.contains("atlas") && (s.contains("agent") || s.contains("jarvis")),
            ),
        }
    }
}

/* How well a file or folder name names the program: 0 is not at all. */
fn app_score(app: NamedApp, file_name: &str) -> i32 {
    let lower = file_name.to_lowercase();
    let (stem, ext) = match lower.rfind('.') {
        Some(i) if i > 0 => (&lower[..i], &lower[i + 1..]),
        _ => (lower.as_str(), ""),
    };
    let s = ws3d_squeeze(stem);
    if s.contains("uninstall") || s.contains("unins") || s.contains("setup") || s.contains("installer") {
        return 0;
    }
    let (named, loose) = app.names(&s);
    if !named && !loose {
        return 0;
    }
    let kind = match ext {
        "lnk" => 30,
        "exe" => 28,
        "appref-ms" => 26,
        "url" => 24,
        "bat" | "cmd" => 20,
        "" => 10,
        _ => return 0,
    };
    kind + if named { 50 } else { 20 }
}

fn ws3d_places() -> Vec<(std::path::PathBuf, usize)> {
    let mut v: Vec<(std::path::PathBuf, usize)> = Vec::new();
    let env = |k: &str| std::env::var_os(k).map(std::path::PathBuf::from);
    if let Some(a) = env("APPDATA") {
        v.push((a.join("Microsoft").join("Windows").join("Start Menu").join("Programs"), 3));
    }
    if let Some(p) = env("ProgramData") {
        v.push((p.join("Microsoft").join("Windows").join("Start Menu").join("Programs"), 3));
    }
    if let Some(d) = dirs_next::desktop_dir() {
        v.push((d, 2));
    }
    if let Some(h) = dirs_next::home_dir() {
        v.push((h.join("OneDrive").join("Desktop"), 2));
    }
    if let Some(p) = env("PUBLIC") {
        v.push((p.join("Desktop"), 2));
    }
    if let Some(l) = env("LOCALAPPDATA") {
        v.push((l.join("Programs"), 2));
        v.push((l.clone(), 1));
    }
    for k in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
        if let Some(p) = env(k) {
            v.push((p, 2));
        }
    }
    if let Some(d) = dirs_next::document_dir() {
        v.push((d, 2));
    }
    v
}

/* The best match under one place, looking `depth` folders down. A matching
   FOLDER (an install directory) counts through the program inside it: an
   .exe named like the folder, or the only .exe there is. */
fn app_search(app: NamedApp, dir: &std::path::Path, depth: usize, best: &mut Option<(i32, std::path::PathBuf)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let score = app_score(app, &name);
        if is_dir {
            if score > 0 {
                if let Some(exe) = app_exe_in(app, &path) {
                    let s = score + 15;
                    if best.as_ref().map_or(true, |(b, _)| s > *b) {
                        *best = Some((s, exe));
                    }
                }
            }
            if depth > 1 {
                app_search(app, &path, depth - 1, best);
            }
        } else if score > 0 && best.as_ref().map_or(true, |(b, _)| score > *b) {
            *best = Some((score, path));
        }
    }
}

fn app_exe_in(app: NamedApp, dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let exes: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().map_or(false, |e| e.eq_ignore_ascii_case("exe")))
        .filter(|p| {
            let n = ws3d_squeeze(&p.file_name().unwrap_or_default().to_string_lossy());
            !n.contains("unins") && !n.contains("setup") && !n.contains("update") && !n.contains("crash")
        })
        .collect();
    exes.iter()
        .find(|p| app_score(app, &p.file_name().unwrap_or_default().to_string_lossy()) > 0)
        .cloned()
        .or_else(|| if exes.len() == 1 { exes.into_iter().next() } else { None })
}

fn find_app(app: NamedApp, given: Option<&str>) -> Result<std::path::PathBuf, Vec<String>> {
    if let Some(g) = given.map(str::trim).filter(|g| !g.is_empty()) {
        let p = std::path::PathBuf::from(g.trim_matches('"'));
        if p.is_file() {
            return Ok(p);
        }
        if p.is_dir() {
            if let Some(exe) = app_exe_in(app, &p) {
                return Ok(exe);
            }
        }
    }
    let places = ws3d_places();
    let mut best: Option<(i32, std::path::PathBuf)> = None;
    for (dir, depth) in &places {
        app_search(app, dir, *depth, &mut best);
    }
    match best {
        Some((_, p)) => Ok(p),
        None => Err(places.iter().map(|(d, _)| d.display().to_string()).collect()),
    }
}

fn find_3d_workspace(given: Option<&str>) -> Result<std::path::PathBuf, Vec<String>> {
    find_app(NamedApp::Workspace3d, given)
}

#[cfg(target_os = "windows")]
fn shell_open(target: &std::path::Path, arg: Option<&std::path::Path>) -> Result<(), String> {
    use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        s.encode_wide().chain(std::iter::once(0)).collect()
    }
    let verb = wide(std::ffi::OsStr::new("open"));
    let file = wide(target.as_os_str());
    /* One argument, quoted as a whole: a path with spaces arrives as one. */
    let params = arg.map(|a| wide(std::ffi::OsStr::new(&format!("\"{}\"", a.display()))));
    let cwd = target.parent().map(|d| wide(d.as_os_str()));
    let code = unsafe {
        /* The shell wants COM on the calling thread; an already-initialised
           thread answers S_FALSE or RPC_E_CHANGED_MODE, both harmless here. */
        CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            params.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()),
            cwd.as_ref().map_or(std::ptr::null(), |c| c.as_ptr()),
            SW_SHOWNORMAL,
        )
    } as isize;
    if code > 32 {
        Ok(())
    } else {
        Err(format!("Windows would not start {} (code {code})", target.display()))
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_open(target: &std::path::Path, arg: Option<&std::path::Path>) -> Result<(), String> {
    let mut cmd = std::process::Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" });
    cmd.arg(target);
    if let Some(a) = arg {
        if cfg!(target_os = "macos") {
            cmd.arg("--args");
        }
        cmd.arg(a);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("could not start {}: {e}", target.display()))
}

#[tauri::command]
async fn launch_3d_workspace(
    path: Option<String>,
    b64: Option<String>,
    name: Option<String>,
) -> Result<serde_json::Value, String> {
    let model = match b64.as_deref().filter(|b| !b.trim().is_empty()) {
        Some(b) => {
            let dir = jarvis_folder().ok_or("could not find or make a JARVIS folder")?.join("3D Workspace");
            let p = write_glb(&dir, b, name.as_deref().unwrap_or("model"))?;
            let handoff = serde_json::json!({
                "model": p.display().to_string(),
                "name": name.clone().unwrap_or_default(),
                "from": "JARVIS",
            });
            let _ = std::fs::write(dir.join("latest-model.json"), handoff.to_string());
            Some(p)
        }
        None => None,
    };
    let model_path = model.as_ref().map(|p| p.display().to_string());
    let app = match find_3d_workspace(path.as_deref()) {
        Ok(a) => a,
        Err(searched) => {
            return Ok(serde_json::json!({
                "launched": false,
                "reason": "not_found",
                "searched": searched,
                "model_path": model_path,
            }))
        }
    };
    shell_open(&app, model.as_deref())?;
    Ok(serde_json::json!({
        "launched": true,
        "app_path": app.display().to_string(),
        "model_path": model_path,
    }))
}

/* "LET ME SEE YOUR AGENT SYSTEM" (2.15.0) — his JARVIS Agent Atlas, the
   3D map of the agents, built as its own Tauri app. Found the same way as
   3D Workspace; and since it is a map he keeps coming back to, an Atlas
   that is already open is brought forward rather than opened twice. */
#[cfg(target_os = "windows")]
unsafe fn foreground_unlock() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    };
    /* Windows lets the process that sent the last input choose the
       foreground window. An unassigned key, down and up, does nothing
       else (the same one the Alt-wheel zoom uses to keep menus shut). */
    let key = |up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: 0xE8,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let mut k = [key(false), key(true)];
    unsafe {
        SendInput(2, k.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
    }
}

/* MUSIC KEYS (2.23.0). "Stop the music" and "next song" for the YouTube
   playlist he plays from: the keyboard's own media keys, which Windows hands
   to whatever is playing (Chrome and Edge pass them to YouTube through the
   Media Session). No window has to be found or focused. */
#[cfg(target_os = "windows")]
#[tauri::command]
fn media_key(key: String) -> Result<String, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    };
    let vk: u16 = match key.as_str() {
        "play_pause" => 0xB3, // VK_MEDIA_PLAY_PAUSE
        "next" => 0xB0,       // VK_MEDIA_NEXT_TRACK
        "previous" => 0xB1,   // VK_MEDIA_PREV_TRACK
        "stop" => 0xB2,       // VK_MEDIA_STOP
        _ => return Err(format!("unknown media key {key}")),
    };
    let make = |up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let mut k = [make(false), make(true)];
    let sent = unsafe { SendInput(2, k.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32) };
    if sent == 2 {
        Ok(key)
    } else {
        Err("Windows refused the key (another program may be blocking input)".into())
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn media_key(key: String) -> Result<String, String> {
    Err(format!("media keys are only sent on Windows ({key})"))
}

/* ------------------------------------------------------------------
   MUSIC IN A WINDOW OF ITS OWN (2.24.0)

   "Let's put some music" opened the playlist in Chrome, on its page, not
   playing. Now it is a small window at the top middle of the screen, no
   frame, playing from the first song: the YouTube watch page itself (an
   embed refuses many music videos), with the page around the player
   hidden and the picture filling it. Since 2.25.0 an ELLIPSE, twice as wide
   as it is tall (the square took too much of the screen): the window's own
   region is the ellipse, so its corners are not there at all (not drawn,
   not clickable), and the page draws a thin cyan ring just inside the edge,
   which also smooths the region's stepped outline. YouTube's own controls
   would be cut by the curve, so they are hidden: he controls it by voice.

   Its own WebView2 profile (data_directory), because autoplay with sound
   needs --autoplay-policy=no-user-gesture-required, and WebView2 refuses to
   create a second webview with different browser arguments in a profile
   that is already open. A playlist page (when the worker could not name
   the first video) is turned into its first video by the page script. It
   is not signed in to YouTube (Google refuses sign-in inside a webview), so
   the playlist must be public or unlisted. Pause / next / previous / close
   are music_control; the page script answers window.__jarvisMusic.
------------------------------------------------------------------ */
const MUSIC_W: f64 = 360.0; // logical px: an ellipse twice as wide as it is tall
const MUSIC_H: f64 = 180.0;
const MUSIC_TOP: f64 = 14.0; // logical px from the top of the screen
const MUSIC_MIN_W: f64 = 160.0; // the smallest he can make it (logical px)
const MUSIC_MIN_H: f64 = 80.0;

/* WHERE HE PUT IT (2.28.0). The music window is his to move and stretch
   (drag it, scroll over it, the handle on its rim, or "make the music
   bigger"); the last place and size are kept in memory and, a moment after
   the last change, in a small file next to the app's data, so the next
   "put some music" opens it where he left it. Physical pixels, as the
   window reports them: x, y, width, height; a width of 0 means unknown. */
static MUSIC_GEOM: std::sync::Mutex<[i32; 4]> = std::sync::Mutex::new([0, 0, 0, 0]);
static MUSIC_SAVE_PENDING: AtomicBool = AtomicBool::new(false);

fn music_geom_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("music-window.txt"))
}

fn music_geom_save(app: &tauri::AppHandle) {
    let g = *MUSIC_GEOM.lock().unwrap_or_else(|e| e.into_inner());
    if g[2] <= 0 || g[3] <= 0 {
        return;
    }
    if let Some(file) = music_geom_file(app) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(file, format!("{} {} {} {}", g[0], g[1], g[2], g[3]));
    }
}

/* Saved only if it still makes sense: a sensible size, and its middle on a
   screen that is still there (a second monitor may be gone). */
fn music_geom_load(app: &tauri::AppHandle) -> Option<[i32; 4]> {
    let text = std::fs::read_to_string(music_geom_file(app)?).ok()?;
    let v: Vec<i32> = text.split_whitespace().filter_map(|t| t.parse().ok()).collect();
    if v.len() != 4 {
        return None;
    }
    let g = [v[0], v[1], v[2], v[3]];
    if g[2] < 100 || g[3] < 50 || g[2] > 8000 || g[3] > 4000 {
        return None;
    }
    let (cx, cy) = (g[0] + g[2] / 2, g[1] + g[3] / 2);
    let on_screen = app
        .available_monitors()
        .map(|ms| {
            ms.iter().any(|m| {
                let (p, s) = (m.position(), m.size());
                cx >= p.x && cx < p.x + s.width as i32 && cy >= p.y && cy < p.y + s.height as i32
            })
        })
        .unwrap_or(false);
    if on_screen {
        Some(g)
    } else {
        None
    }
}

/* Writes ~1 s after the LAST change, not on every pixel of a drag. */
fn music_geom_changed(app: &tauri::AppHandle) {
    if MUSIC_SAVE_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        MUSIC_SAVE_PENDING.store(false, Ordering::SeqCst);
        music_geom_save(&app);
    });
}

const MUSIC_INIT: &str = r#"(function () {
  if (window.__jarvisMusicReady) return;
  window.__jarvisMusicReady = true;
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
  var CSS = [
    'html,body,ytd-app{background:#000!important;overflow:hidden!important}',
    '#masthead-container,ytd-masthead,#secondary,#below,#comments,#related,ytd-watch-metadata,#chat,#guide,tp-yt-app-drawer,ytd-mini-guide-renderer,#panels,.ytp-pause-overlay,.ytp-ce-element,.ytp-endscreen-content,.ytp-paid-content-overlay{display:none!important}',
    '#movie_player{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;z-index:2147483000!important;background:#000!important}',
    '#movie_player .html5-video-container,#movie_player video.html5-main-video{position:absolute!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important}',
    '#movie_player video.html5-main-video{object-fit:cover!important}',
    '.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-watermark,.ytp-cards-button,.ytp-cards-teaser,.ytp-iv-player-content,.ytp-ce-element{display:none!important}',
    '#jarvis-music-ring{position:fixed;left:0;top:0;width:100vw;height:100vh;border-radius:50%;pointer-events:none;z-index:2147483647;box-shadow:inset 0 0 0 2px rgba(0,229,255,0.9),inset 0 0 16px rgba(0,229,255,0.35)}',
    '#jarvis-music-grip{position:fixed;left:81%;top:81%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(0,12,24,0.72);box-shadow:0 0 0 1.5px rgba(0,229,255,0.9);color:#00e5ff;font:12px/22px sans-serif;text-align:center;cursor:nwse-resize;z-index:2147483647;opacity:0.45;transition:opacity .2s;user-select:none;-webkit-user-select:none}',
    '#jarvis-music-grip:hover{opacity:1}'
  ].join('\n');
  function addStyle() {
    if (document.getElementById('jarvis-music-css')) return;
    var root = document.head || document.documentElement;
    if (!root) return;
    var s = document.createElement('style');
    s.id = 'jarvis-music-css';
    s.textContent = CSS;
    root.appendChild(s);
  }
  function addRing() {
    if (!document.body || document.getElementById('jarvis-music-ring')) return;
    var r = document.createElement('div');
    r.id = 'jarvis-music-ring';
    document.body.appendChild(r);
  }
  /* Resize by hand: a small handle on the lower right of the rim, which hands
     the press to the window frame's own sizing (the page cannot resize a
     window itself). */
  function addGrip() {
    if (!document.body || document.getElementById('jarvis-music-grip')) return;
    var g = document.createElement('div');
    g.id = 'jarvis-music-grip';
    g.title = 'Drag to resize';
    g.textContent = '\u25E2';
    g.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      inv('plugin:window|start_resize_dragging', { label: LABEL, value: 'SouthEast' }).catch(function () {});
    }, true);
    document.body.appendChild(g);
  }
  /* The skip button sits in the corner the ellipse cuts off. */
  function skipAd() {
    var b = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern');
    if (b && b.offsetParent !== null) { try { b.click(); } catch (e) {} }
  }
  /* HIS HANDS ON THE WINDOW (2.28.0). Drag it anywhere to move it, turn the
     wheel over it to make it bigger or smaller, or take the handle on the
     rim to stretch it. The window is YouTube's page, so the page cannot move
     or size it by itself: it asks the window plugin, which the music
     capability (capabilities/music.json) allows for this one window and
     these addresses only. A press that has not moved is still a click on
     the player. */
  var LABEL = 'music';
  function inv(cmd, args) {
    try {
      var T = window.__TAURI_INTERNALS__;
      if (T && typeof T.invoke === 'function') return Promise.resolve(T.invoke(cmd, args || {}));
    } catch (e) {}
    return Promise.reject(new Error('no bridge'));
  }
  var pend = null, swallow = 0;
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || !e.isTrusted) return;
    if (e.target && e.target.id === 'jarvis-music-grip') return;
    pend = { x: e.clientX, y: e.clientY };
  }, true);
  document.addEventListener('mousemove', function (e) {
    if (!pend) return;
    if ((e.buttons & 1) === 0) { pend = null; return; }
    if (Math.abs(e.clientX - pend.x) + Math.abs(e.clientY - pend.y) < 6) return;
    pend = null;
    swallow = Date.now() + 600;
    inv('plugin:window|start_dragging', { label: LABEL }).catch(function () {});
  }, true);
  document.addEventListener('mouseup', function () { pend = null; }, true);
  ['click', 'dblclick'].forEach(function (n) {
    document.addEventListener(n, function (e) {
      /* A double click would send YouTube's player full screen inside a
         window that is a few hundred pixels wide. */
      if (n === 'dblclick' || Date.now() < swallow) { e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
  });
  var wheelAcc = 0, wheelBusy = false, wheelTimer = 0;
  document.addEventListener('wheel', function (e) {
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 40 : 1);
    if (!wheelTimer) wheelTimer = setTimeout(applyWheel, 60);
  }, { capture: true, passive: false });
  function applyWheel() {
    wheelTimer = 0;
    if (wheelBusy) { wheelTimer = setTimeout(applyWheel, 60); return; }
    var f = Math.exp(-wheelAcc * 0.0012);
    wheelAcc = 0;
    if (!(f > 0) || Math.abs(f - 1) < 0.004) return;
    wheelBusy = true;
    Promise.all([inv('plugin:window|outer_size', { label: LABEL }), inv('plugin:window|outer_position', { label: LABEL })]).then(function (r) {
      var s = r[0], p = r[1], d = window.devicePixelRatio || 1;
      var minW = 160 * d, maxW = Math.max(minW, (screen.availWidth || 1920) * d * 0.95);
      /* Bigger never shrinks a window that is already past the limit, and
         smaller never grows one that is already under it. */
      var w = f > 1 ? Math.max(s.width, Math.min(maxW, s.width * f)) : Math.min(s.width, Math.max(minW, s.width * f));
      var h = Math.max(1, s.height * (w / s.width));
      return Promise.all([
        inv('plugin:window|set_size', { label: LABEL, value: { Physical: { width: Math.round(w), height: Math.round(h) } } }),
        inv('plugin:window|set_position', { label: LABEL, value: { Physical: { x: Math.round(p.x + (s.width - w) / 2), y: Math.round(p.y + (s.height - h) / 2) } } })
      ]);
    }).catch(function () {}).then(function () { wheelBusy = false; });
  }
  var started = Date.now(), held = false, touched = false;
  function player() { return document.getElementById('movie_player'); }
  function video() { return document.querySelector('#movie_player video') || document.querySelector('video'); }
  document.addEventListener('pointerdown', function (e) { if (e.isTrusted) touched = true; }, true);
  window.addEventListener('yt-navigate-finish', function () { started = Date.now(); });
  function tick() {
    addStyle();
    addRing();
    addGrip();
    skipAd();
    if (location.pathname === '/playlist') {
      var a = document.querySelector('ytd-playlist-video-renderer a#video-title[href*="/watch"], ytd-playlist-video-renderer a[href*="/watch?v="], a[href*="/watch?v="][href*="list="]');
      if (a && a.href) { location.replace(a.href); return; }
    }
    var v = video();
    if (v && v.paused && !held && !touched && Date.now() - started < 30000) {
      var p = player();
      try { if (p && typeof p.playVideo === 'function') p.playVideo(); else v.play(); } catch (e) {}
    }
  }
  setInterval(tick, 700);
  document.addEventListener('DOMContentLoaded', addStyle);
  window.__jarvisMusic = function (a) {
    var p = player(), v = video(), b;
    try {
      if (a === 'pause') { held = true; if (p && p.pauseVideo) p.pauseVideo(); else if (v) v.pause(); }
      else if (a === 'resume') { held = false; if (p && p.playVideo) p.playVideo(); else if (v) v.play(); }
      else if (a === 'toggle') { window.__jarvisMusic(v && !v.paused ? 'pause' : 'resume'); }
      else if (a === 'next') { held = false; if (p && p.nextVideo) p.nextVideo(); else if ((b = document.querySelector('.ytp-next-button'))) b.click(); }
      else if (a === 'previous') { held = false; if (p && p.previousVideo) p.previousVideo(); else if ((b = document.querySelector('.ytp-prev-button'))) b.click(); }
      else if (a === 'volume_up' || a === 'volume_down') {
        var vol = (p && p.getVolume) ? p.getVolume() : (v ? v.volume * 100 : 50);
        vol = Math.max(0, Math.min(100, vol + (a === 'volume_up' ? 15 : -15)));
        if (p && p.setVolume) { p.setVolume(vol); if (vol > 0 && p.isMuted && p.isMuted() && p.unMute) p.unMute(); }
        else if (v) { v.volume = vol / 100; v.muted = false; }
      }
      else if (a === 'mute') { if (p && p.mute) p.mute(); else if (v) v.muted = true; }
      else if (a === 'unmute') { if (p && p.unMute) p.unMute(); else if (v) v.muted = false; }
      else if (a === 'forward' || a === 'back' || a === 'restart') {
        var now = (p && p.getCurrentTime) ? p.getCurrentTime() : (v ? v.currentTime : 0);
        var to = a === 'restart' ? 0 : Math.max(0, now + (a === 'forward' ? 15 : -15));
        if (p && p.seekTo) p.seekTo(to, true); else if (v) v.currentTime = to;
      }
    } catch (e) {}
  };
})();"#;

fn music_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url.trim()).map_err(|_| format!("not a url: {}", url))?;
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let youtube = host == "www.youtube.com" || host == "youtube.com" || host == "m.youtube.com";
    if parsed.scheme() != "https" || !youtube || !(parsed.path() == "/watch" || parsed.path() == "/playlist") {
        return Err("refused: the music window only opens a YouTube watch or playlist address".into());
    }
    Ok(parsed)
}

/* The window IS the ellipse (2.25.0): its region, in its own physical
   pixels. Windows owns the region once it is set (never deleted here). */
#[cfg(target_os = "windows")]
fn ellipse_window(win: &WebviewWindow, w: i32, h: i32) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Gdi::{CreateEllipticRgn, SetWindowRgn};
    let Ok(hw) = win.hwnd() else { return };
    let hwnd = hw.0 as isize as HWND;
    unsafe {
        let rgn = CreateEllipticRgn(0, 0, w + 1, h + 1);
        if !rgn.is_null() {
            SetWindowRgn(hwnd, rgn, 1);
        }
    }
}
#[cfg(not(target_os = "windows"))]
fn ellipse_window(_win: &WebviewWindow, _w: i32, _h: i32) {}

#[tauri::command]
async fn music_window(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let parsed = music_url(&url)?;
    if let Some(existing) = app.get_webview_window("music") {
        existing.navigate(parsed).map_err(|e| e.to_string())?;
        let _ = existing.unminimize();
        let _ = existing.show();
        raise_own_window(&existing, false);
        return Ok("reused".into());
    }
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("music-webview");
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, "music", WebviewUrl::External(parsed))
        .title("JARVIS \u{2014} music")
        .decorations(false)
        .resizable(true)
        .min_inner_size(MUSIC_MIN_W, MUSIC_MIN_H)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(false)
        .focused(false)
        .visible(false)
        .data_directory(data_dir)
        .initialization_script(MUSIC_INIT);
    #[cfg(target_os = "windows")]
    {
        builder = builder.additional_browser_args(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
        );
    }
    let win = builder.build().map_err(|e| e.to_string())?;
    /* The ellipse follows the size, whoever changes it: him dragging the
       handle, the wheel, "make it bigger". */
    {
        let (w2, a2) = (win.clone(), app.clone());
        win.on_window_event(move |ev| match ev {
            tauri::WindowEvent::Resized(size) => {
                if size.width > 0 && size.height > 0 {
                    ellipse_window(&w2, size.width as i32, size.height as i32);
                    let mut g = MUSIC_GEOM.lock().unwrap_or_else(|e| e.into_inner());
                    g[2] = size.width as i32;
                    g[3] = size.height as i32;
                    drop(g);
                    music_geom_changed(&a2);
                }
            }
            tauri::WindowEvent::Moved(pos) => {
                // A minimised window reports a position far off the screen.
                if pos.x > -30000 && pos.y > -30000 {
                    let mut g = MUSIC_GEOM.lock().unwrap_or_else(|e| e.into_inner());
                    g[0] = pos.x;
                    g[1] = pos.y;
                    drop(g);
                    music_geom_changed(&a2);
                }
            }
            tauri::WindowEvent::Destroyed => music_geom_save(&a2),
            _ => {}
        });
    }
    /* Where he left it, if that is still on a screen; otherwise the top
       middle of the main screen. Placed in physical pixels after it exists
       (the builder's numbers are logical and get scaled twice on a
       high-DPI screen). */
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten());
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let (mut w, mut h) = ((MUSIC_W * scale).round() as i32, (MUSIC_H * scale).round() as i32);
    let mut place: Option<(i32, i32)> = monitor.as_ref().map(|m| {
        (
            m.position().x + (m.size().width as i32 - w) / 2,
            m.position().y + (MUSIC_TOP * scale).round() as i32,
        )
    });
    if let Some(g) = music_geom_load(&app) {
        place = Some((g[0], g[1]));
        w = g[2];
        h = g[3];
    }
    let _ = win.set_size(tauri::PhysicalSize {
        width: w as u32,
        height: h as u32,
    });
    if let Some((x, y)) = place {
        let _ = win.set_position(tauri::PhysicalPosition { x, y });
    }
    {
        let (x, y) = place.unwrap_or((0, 0));
        *MUSIC_GEOM.lock().unwrap_or_else(|e| e.into_inner()) = [x, y, w, h];
    }
    ellipse_window(&win, w, h);
    let _ = win.show();
    raise_own_window(&win, false);
    Ok("opened".into())
}

/* pause | resume | toggle | next | previous | volume_up | volume_down | mute |
   unmute | forward | back | restart | close | show. "not_open"
   when he has closed it himself. */
#[tauri::command]
fn music_control(app: tauri::AppHandle, action: String) -> Result<String, String> {
    let win = app.get_webview_window("music").ok_or_else(|| "not_open".to_string())?;
    match action.as_str() {
        "close" => {
            music_geom_save(&app);
            win.close().map_err(|e| e.to_string())?;
            Ok("closed".into())
        }
        "show" => {
            let _ = win.unminimize();
            let _ = win.show();
            raise_own_window(&win, false);
            Ok("shown".into())
        }
        "pause" | "resume" | "toggle" | "next" | "previous" | "volume_up" | "volume_down" | "mute"
        | "unmute" | "forward" | "back" | "restart" => {
            win.eval(&format!("window.__jarvisMusic && window.__jarvisMusic('{}')", action))
                .map_err(|e| e.to_string())?;
            Ok(action)
        }
        _ => Err(format!("unknown music action {action}")),
    }
}

/* ------------------------------------------------------------------
   HIS WINDOWS, BIGGER, SMALLER, SOMEWHERE ELSE (2.28.0)

   "Make the music bigger", "put the 3D model in the corner": the same
   thing his hands do on the window itself (drag, wheel, the handles),
   asked for by voice. One command for the two windows he is allowed to
   rearrange, the music window and the 3D viewer. A step is a quarter
   bigger or a fifth smaller about the window's centre, never past 95% of
   the usable screen or under the smallest size, and the window is kept
   whole on the screen it is on (the taskbar is not part of it). The music
   window's ellipse follows by itself (its Resized handler).

   action: bigger | smaller | reset | place. horizontal: left | center |
   right; vertical: top | middle | bottom. The answer carries `note`:
   "at_max" / "at_min" when it could go no further.
------------------------------------------------------------------ */
#[tauri::command]
fn adjust_window(
    app: tauri::AppHandle,
    window: String,
    action: String,
    horizontal: Option<String>,
    vertical: Option<String>,
    steps: Option<u32>,
) -> Result<serde_json::Value, String> {
    let (label, min_w, min_h, def_w, def_h) = match window.as_str() {
        "music" => ("music", MUSIC_MIN_W, MUSIC_MIN_H, MUSIC_W, MUSIC_H),
        "model" => ("model", 240.0, 240.0, 620.0, 620.0),
        _ => return Err(format!("unknown window {window}")),
    };
    let win = app
        .get_webview_window(label)
        .ok_or_else(|| "not_open".to_string())?;
    if win.is_fullscreen().unwrap_or(false) {
        return Err("full_screen".into());
    }
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let mon = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "no_monitor".to_string())?;
    let scale = mon.scale_factor();
    let (mp, ms) = (*mon.position(), *mon.size());
    // The usable part of the screen, taskbar excluded: left, top, right, bottom.
    #[allow(unused_mut)]
    let mut area = [mp.x, mp.y, mp.x + ms.width as i32, mp.y + ms.height as i32];
    #[cfg(target_os = "windows")]
    {
        if let Ok(h) = win.hwnd() {
            if let Some(a) = unsafe { bring_work_area_of(h.0 as isize) } {
                area = a;
            }
        }
    }
    let (area_w, area_h) = ((area[2] - area[0]) as f64, (area[3] - area[1]) as f64);
    let (cw, ch) = (size.width as f64, size.height as f64);
    let (mut nw, mut nh) = (cw, ch);
    let (mut x, mut y) = (pos.x, pos.y);
    let mut note = "ok";
    match action.as_str() {
        "bigger" | "smaller" => {
            let steps = steps.unwrap_or(1).clamp(1, 6) as i32;
            let want: f64 = if action == "bigger" { 1.25f64.powi(steps) } else { 0.8f64.powi(steps) };
            let mut f = want.min(area_w * 0.95 / cw).min(area_h * 0.95 / ch);
            f = f.max(min_w * scale / cw).max(min_h * scale / ch);
            if want > 1.0 {
                f = f.max(1.0);
                if f < 1.02 {
                    note = "at_max";
                }
            } else {
                f = f.min(1.0);
                if f > 0.98 {
                    note = "at_min";
                }
            }
            nw = (cw * f).round();
            nh = (ch * f).round();
            x = pos.x + ((cw - nw) / 2.0).round() as i32;
            y = pos.y + ((ch - nh) / 2.0).round() as i32;
        }
        "reset" => {
            nw = (def_w * scale).round();
            nh = (def_h * scale).round();
            x = area[0] + ((area_w - nw) / 2.0).round() as i32;
            y = if label == "music" {
                mp.y + (MUSIC_TOP * scale).round() as i32
            } else {
                area[1] + ((area_h - nh) / 2.0).round() as i32
            };
        }
        "place" | "move" => {
            if horizontal.is_none() && vertical.is_none() {
                return Err("no_place".into());
            }
        }
        _ => return Err(format!("unknown action {action}")),
    }
    let margin = (14.0 * scale).round() as i32;
    let (iw, ih) = (nw as i32, nh as i32);
    match horizontal.as_deref() {
        Some("left") => x = area[0] + margin,
        Some("right") => x = area[2] - iw - margin,
        Some("center") | Some("middle") => x = area[0] + (area[2] - area[0] - iw) / 2,
        _ => {}
    }
    match vertical.as_deref() {
        Some("top") => y = area[1] + margin,
        Some("bottom") => y = area[3] - ih - margin,
        Some("middle") | Some("center") => y = area[1] + (area[3] - area[1] - ih) / 2,
        _ => {}
    }
    // Never off the screen.
    x = x.max(area[0]).min((area[2] - iw).max(area[0]));
    y = y.max(area[1]).min((area[3] - ih).max(area[1]));
    if (nw - cw).abs() > 0.5 || (nh - ch).abs() > 0.5 {
        win.set_size(tauri::PhysicalSize {
            width: nw as u32,
            height: nh as u32,
        })
        .map_err(|e| e.to_string())?;
    }
    win.set_position(tauri::PhysicalPosition { x, y })
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "ok": true, "window": window, "action": action, "note": note,
        "width": iw, "height": ih, "x": x, "y": y
    }))
}

/* ------------------------------------------------------------------
   TYPING FOR HIM (2.28.0)

   "Write this in Chrome" without a site-specific tool: the text is typed
   as keystrokes into the window he names, or into the one he is in, the
   way his own hands would (Unicode key events, so Hebrew and emoji land
   as written whatever the keyboard layout). Chrome is found in the list
   of program windows and brought to the front; a field is chosen only
   when he asks for one: the address bar (Ctrl+L) or a fresh tab (Ctrl+T)
   in a browser, else whatever already has the cursor.

   What keeps it safe:
     - it types ONLY into a window that is verified to be the foreground
       window, before the first key and again before every batch; if he
       clicks elsewhere half way, it stops and says how far it got;
     - never into a shell, a terminal, a script host, the registry
       editor, Task Manager or a security prompt (TYPE_REFUSED_EXE): text
       typed into those runs as a command;
     - never into one of our own windows;
     - 4000 characters at most; a new line is Shift+Enter (a line break,
       not "send"); Enter is pressed only when `submit` is asked for.
   Answers are { ok, ... }; the failures a person can act on are {ok:false,
   code} rather than errors: no_window, refused_app, not_browser, not_front,
   focus_lost (typed = how many characters landed), blocked, no_text,
   too_long.
------------------------------------------------------------------ */
#[cfg(target_os = "windows")]
const TYPE_REFUSED_EXE: &[&str] = &[
    "cmd", "powershell", "pwsh", "powershell_ise", "windowsterminal", "wt", "conhost",
    "openconsole", "wsl", "wslhost", "bash", "mshta", "wscript", "cscript", "regedit", "mmc",
    "taskmgr", "consent", "credentialuibroker", "logonui", "lockapp", "msiexec", "runas",
];

#[cfg(target_os = "windows")]
const TYPE_BROWSERS: &[&str] = &["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"];

#[cfg(target_os = "windows")]
fn type_text_blocking(
    own: Vec<(String, isize)>,
    text: String,
    target: Option<String>,
    field: Option<String>,
    submit: bool,
) -> Result<serde_json::Value, String> {
    use std::{thread::sleep, time::Duration};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE,
        VIRTUAL_KEY, VK_CONTROL, VK_RETURN, VK_SHIFT, VK_TAB,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    let fail = |code: &str, extra: serde_json::Value| -> Result<serde_json::Value, String> {
        let mut v = serde_json::json!({ "ok": false, "code": code });
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            for (k, val) in e {
                o.insert(k.clone(), val.clone());
            }
        }
        Ok(v)
    };

    let text: String = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .chars()
        .filter(|c| *c == '\n' || *c == '\t' || !c.is_control())
        .collect();
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.is_empty() {
        return fail("no_text", serde_json::json!({}));
    }
    if units.len() > 4000 {
        return fail("too_long", serde_json::json!({ "limit": 4000 }));
    }

    // Which window.
    let want = target
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "focused".to_string());
    let windows = bring_app_windows(&own);
    let fg_now = unsafe { GetForegroundWindow() } as isize;
    let pick: Option<&BringCandidate> = match want.as_str() {
        "focused" | "foreground" | "current" | "this" => windows
            .iter()
            .find(|c| c.hwnd == fg_now)
            .or_else(|| windows.first()),
        "chrome" | "google chrome" => windows.iter().find(|c| c.exe == "chrome"),
        "browser" | "the browser" => windows
            .iter()
            .find(|c| TYPE_BROWSERS.contains(&c.exe.as_str())),
        other => {
            let needle = vec![other.to_string()];
            let mut best: Option<(i32, &BringCandidate)> = None;
            for c in windows.iter() {
                let s = bring_score(c, &needle, &needle);
                if s > 0 && best.map(|(b, _)| s > b).unwrap_or(true) {
                    best = Some((s, c));
                }
            }
            best.map(|(_, c)| c)
        }
    };
    let Some(c) = pick else {
        return fail("no_window", serde_json::json!({ "wanted": want }));
    };
    if TYPE_REFUSED_EXE.contains(&c.exe.as_str()) {
        return fail("refused_app", serde_json::json!({ "exe": c.exe, "title": c.title }));
    }
    let field = field
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    let is_browser = TYPE_BROWSERS.contains(&c.exe.as_str());
    let (address_bar, new_tab) = (
        matches!(field.as_str(), "address_bar" | "address" | "url" | "search"),
        field == "new_tab",
    );
    if (address_bar || new_tab) && !is_browser {
        return fail("not_browser", serde_json::json!({ "exe": c.exe, "title": c.title }));
    }

    // In front, and checked.
    let hwnd = c.hwnd as HWND;
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        if GetForegroundWindow() as isize != c.hwnd {
            foreground_unlock();
            SetForegroundWindow(hwnd);
        }
    }
    let mut front = false;
    for _ in 0..25 {
        if unsafe { GetForegroundWindow() } as isize == c.hwnd {
            front = true;
            break;
        }
        sleep(Duration::from_millis(40));
    }
    if !front {
        return fail("not_front", serde_json::json!({ "exe": c.exe, "title": c.title }));
    }
    sleep(Duration::from_millis(120));

    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let unit = |u: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: 0,
                wScan: u,
                dwFlags: KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    };
    let still_front = || unsafe { GetForegroundWindow() } as isize == c.hwnd;
    let send = |inputs: &mut Vec<INPUT>| -> bool {
        if inputs.is_empty() {
            return true;
        }
        let n = unsafe { SendInput(inputs.len() as u32, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32) };
        let all = n as usize == inputs.len();
        inputs.clear();
        all
    };

    // The field, if he asked for one.
    if address_bar || new_tab {
        let letter: VIRTUAL_KEY = if new_tab { 0x54 } else { 0x4C }; // T, L
        let mut keys = vec![key(VK_CONTROL, false), key(letter, false), key(letter, true), key(VK_CONTROL, true)];
        if !send(&mut keys) {
            return fail("blocked", serde_json::json!({ "exe": c.exe }));
        }
        sleep(Duration::from_millis(if new_tab { 380 } else { 180 }));
        if !still_front() {
            return fail("focus_lost", serde_json::json!({ "typed": 0, "exe": c.exe }));
        }
    }

    // The text, in small batches, checking the window each time.
    let mut typed = 0usize;
    let mut batch: Vec<INPUT> = Vec::with_capacity(200);
    let mut in_batch = 0usize;
    for &u in units.iter() {
        match u {
            0x0A => {
                batch.extend([key(VK_SHIFT, false), key(VK_RETURN, false), key(VK_RETURN, true), key(VK_SHIFT, true)]);
            }
            0x09 => {
                batch.extend([key(VK_TAB, false), key(VK_TAB, true)]);
            }
            _ => {
                batch.extend([unit(u, false), unit(u, true)]);
            }
        }
        in_batch += 1;
        if in_batch >= 40 {
            if !still_front() {
                return fail("focus_lost", serde_json::json!({ "typed": typed, "exe": c.exe }));
            }
            if !send(&mut batch) {
                return fail("blocked", serde_json::json!({ "typed": typed, "exe": c.exe }));
            }
            typed += in_batch;
            in_batch = 0;
            sleep(Duration::from_millis(8));
        }
    }
    if in_batch > 0 {
        if !still_front() {
            return fail("focus_lost", serde_json::json!({ "typed": typed, "exe": c.exe }));
        }
        if !send(&mut batch) {
            return fail("blocked", serde_json::json!({ "typed": typed, "exe": c.exe }));
        }
        typed += in_batch;
    }
    let mut submitted = false;
    if submit {
        sleep(Duration::from_millis(60));
        if still_front() {
            let mut keys = vec![key(VK_RETURN, false), key(VK_RETURN, true)];
            submitted = send(&mut keys);
        }
    }
    let shown: String = c.title.chars().take(80).collect();
    Ok(serde_json::json!({
        "ok": true, "typed": typed, "exe": c.exe, "title": shown,
        "submitted": submitted, "field": if address_bar { "address_bar" } else if new_tab { "new_tab" } else { "focused" }
    }))
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn type_text(
    app: tauri::AppHandle,
    text: String,
    target: Option<String>,
    field: Option<String>,
    submit: Option<bool>,
) -> Result<serde_json::Value, String> {
    let own = zoom_own_windows(&app);
    tauri::async_runtime::spawn_blocking(move || {
        type_text_blocking(own, text, target, field, submit.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn type_text(
    _text: String,
    _target: Option<String>,
    _field: Option<String>,
    _submit: Option<bool>,
) -> Result<serde_json::Value, String> {
    Err("typing for him is only available on Windows".into())
}

/* ON THE SCREEN, NOT IN THE TASKBAR (2.24.0). A window this app creates
   while another program is in front is shown BEHIND that program: Windows
   will not let a background process take the foreground, so "let's start
   working" left the three panes as taskbar buttons under whatever he was
   using. Raised the way Windows allows it: restored if minimised, put
   topmost and straight back (that lifts it above every ordinary window
   without activating it), and, when asked, given the focus after an
   unassigned key makes this the process with the last input. While the
   orb is expanded our panes stay topmost (orb_layer). */
#[cfg(target_os = "windows")]
fn raise_own_window(win: &WebviewWindow, activate: bool) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetForegroundWindow, SetWindowPos, ShowWindow, HWND_NOTOPMOST, HWND_TOPMOST,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE,
    };
    let Ok(h) = win.hwnd() else { return };
    let hwnd = h.0 as isize as HWND;
    let keep_on_top = win.label() == "music" || ORB_EXPANDED.load(Ordering::SeqCst);
    unsafe {
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE;
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
        if !keep_on_top {
            SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
        }
        if activate {
            foreground_unlock();
            SetForegroundWindow(hwnd);
        }
    }
}
#[cfg(not(target_os = "windows"))]
fn raise_own_window(win: &WebviewWindow, activate: bool) {
    let _ = win.unminimize();
    let _ = win.show();
    if activate {
        let _ = win.set_focus();
    }
}

/* After the three panes are placed: all of them in front, Shopify (the
   main one) with the focus. */
#[tauri::command]
fn front_workspace(app: tauri::AppHandle) -> Vec<String> {
    let mut raised = Vec::new();
    for s in ["tiktok", "instagram", "shopify"] {
        if let Some(win) = app.get_webview_window(&format!("ws-{}", s)) {
            raise_own_window(&win, s == "shopify");
            raised.push(s.to_string());
        }
    }
    raised
}

#[cfg(target_os = "windows")]
fn focus_running(app: &tauri::AppHandle, named: NamedApp) -> Option<(isize, bool)> {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    let own = zoom_own_windows(app);
    let found = bring_app_windows(&own).into_iter().find(|c| {
        let (a, b) = named.names(&ws3d_squeeze(&c.title));
        let (x, y) = named.names(&ws3d_squeeze(&c.exe));
        a || b || x || y
    })?;
    unsafe {
        let h = found.hwnd as HWND;
        if found.iconic {
            ShowWindow(h, SW_RESTORE);
        }
        foreground_unlock();
        SetForegroundWindow(h);
        std::thread::sleep(std::time::Duration::from_millis(80));
        Some((found.hwnd, GetForegroundWindow() as isize == found.hwnd))
    }
}

#[tauri::command]
async fn launch_app(
    app: tauri::AppHandle,
    program: String,
    path: Option<String>,
) -> Result<serde_json::Value, String> {
    let named = NamedApp::from_key(&program).ok_or_else(|| format!("no program called \"{}\"", program))?;
    #[cfg(target_os = "windows")]
    if named == NamedApp::AgentAtlas {
        if let Some((hwnd, front)) = focus_running(&app, named) {
            return Ok(serde_json::json!({ "launched": true, "already_open": true, "hwnd": hwnd, "foreground": front }));
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = &app;
    let exe = match find_app(named, path.as_deref()) {
        Ok(p) => p,
        Err(searched) => {
            return Ok(serde_json::json!({ "launched": false, "reason": "not_found", "searched": searched }))
        }
    };
    shell_open(&exe, None)?;
    Ok(serde_json::json!({ "launched": true, "already_open": false, "app_path": exe.display().to_string() }))
}

/* ------------------------------------------------------------------
   TURNING ANOTHER PROGRAM'S 3D VIEW WITH ONE HAND (2.15.0)

   Precise control turns JARVIS's own 3D viewer by an event. The Agent
   Atlas is another program, so it is turned the way he would turn it with
   the mouse: a left-button drag (its OrbitControls: across, one window
   height of drag is a full turn; up and down tilt). The page sends the
   turn in degrees; this turns degrees into that drag.

     start  only to the window asked about, only while it is in front;
            the pointer is remembered, then pressed at the first of the
            page's aim points where the program shows the plain arrow —
            bare map, never a label or an agent (aim_probe);
     move   the drag continues by dx/360 of the window's height across and
            -dy/360 up (up is negative on the screen). At the edge of the
            window it lets go, finds bare map again (the labels have turned
            with the map) and takes hold there, so the turn never runs out
            of room. If another program comes in front,
            the button is let go at once and nothing more is sent;
     end    let go, and the pointer goes back where it was. A drag that
            barely moved is nudged 8 px out and back first: the Atlas reads
            a press-and-release that never moved as a click.

   A watchdog lets go of the button if two seconds pass with no word from
   the page (the camera closed mid-turn, say): a button left down would
   turn his next mouse move into a drag.
------------------------------------------------------------------ */
#[cfg(target_os = "windows")]
struct DragState {
    hwnd: isize,
    start: (f64, f64),
    cur: (f64, f64),
    down_at: (f64, f64),
    travelled: f64,
    saved: (i32, i32),
    rect: (f64, f64, f64, f64),
    height: f64,
    last: std::time::Instant,
    gen: u64,
    aim: Vec<f64>,
}

#[cfg(target_os = "windows")]
static DRAG: std::sync::Mutex<Option<DragState>> = std::sync::Mutex::new(None);
#[cfg(target_os = "windows")]
static DRAG_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/* One mouse event at a point of the screen, in SendInput's 0..65535 over
   the whole virtual desktop. */
#[cfg(target_os = "windows")]
unsafe fn drag_input(x: f64, y: f64, button: u32) -> windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_MOVE, MOUSEEVENTF_VIRTUALDESK, MOUSEINPUT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };
    unsafe {
        let vx = GetSystemMetrics(SM_XVIRTUALSCREEN) as f64;
        let vy = GetSystemMetrics(SM_YVIRTUALSCREEN) as f64;
        let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN).max(2) as f64;
        let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN).max(2) as f64;
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: ((x - vx) * 65535.0 / (vw - 1.0)).round() as i32,
                    dy: ((y - vy) * 65535.0 / (vh - 1.0)).round() as i32,
                    mouseData: 0,
                    dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | button,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn drag_inputs(v: &mut [windows_sys::Win32::UI::Input::KeyboardAndMouse::INPUT]) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT};
    unsafe { SendInput(v.len() as u32, v.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32) as usize == v.len() }
}

/* Let go where the pointer is, and put the pointer back where he had it. */
#[cfg(target_os = "windows")]
unsafe fn drag_release(st: &DragState) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::MOUSEEVENTF_LEFTUP;
    use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;
    unsafe {
        let mut v = [drag_input(st.cur.0, st.cur.1, MOUSEEVENTF_LEFTUP)];
        drag_inputs(&mut v);
        SetCursorPos(st.saved.0, st.saved.1);
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn drag_send(
    app: tauri::AppHandle,
    hwnd: isize,
    phase: String,
    dx: f64,
    dy: f64,
    aim: Option<Vec<f64>>,
) -> Result<serde_json::Value, String> {
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetCursorPos, GetForegroundWindow, IsIconic, IsWindow, SetForegroundWindow,
    };
    let mut guard = DRAG.lock().map_err(|_| "the turn is unavailable".to_string())?;
    match phase.as_str() {
        "start" => unsafe {
            if let Some(old) = guard.take() {
                drag_release(&old);
            }
            let own = zoom_own_windows(&app);
            let label_of = |h: isize| own.iter().find(|(_, x)| *x == h).map(|(l, _)| l.clone());
            if label_of(hwnd).is_some() {
                return Err("that is JARVIS's own window".into());
            }
            let h = hwnd as HWND;
            if hwnd == 0 || IsWindow(h) == 0 {
                return Err("that window is gone".into());
            }
            if IsIconic(h) != 0 {
                return Err("the window is minimised".into());
            }
            let fg = GetForegroundWindow() as isize;
            if fg != hwnd {
                let ours = label_of(fg).map(|l| zoom_is_control(&l)).unwrap_or(false);
                if !(ours || fg == 0) {
                    return Err("foreground changed".into());
                }
                SetForegroundWindow(h);
                std::thread::sleep(Duration::from_millis(60));
                if GetForegroundWindow() as isize != hwnd {
                    return Err("could not bring the window forward, so nothing was sent".into());
                }
            }
            let mut rc: RECT = std::mem::zeroed();
            if GetClientRect(h, &mut rc) == 0 {
                return Err("could not read the window's size".into());
            }
            let mut tl = POINT { x: 0, y: 0 };
            ClientToScreen(h, &mut tl);
            let (w, ht) = ((rc.right - rc.left) as f64, (rc.bottom - rc.top) as f64);
            if w < 80.0 || ht < 80.0 {
                return Err("the window has no room to turn in".into());
            }
            let rect = (tl.x as f64, tl.y as f64, tl.x as f64 + w, tl.y as f64 + ht);
            /* The page's measured places for this program, else the Atlas's. */
            let fractions = aim.filter(|a| a.len() >= 2).unwrap_or_else(|| vec![0.64, 0.77, 0.60, 0.79, 0.66, 0.93, 0.5, 0.9, 0.5, 0.5]);
            let mut saved = POINT { x: 0, y: 0 };
            GetCursorPos(&mut saved);
            let start = aim_probe(h, &fractions)
                .map(|(x, y)| (x as f64, y as f64))
                .ok_or("the window is covered where it would be turned")?;
            let mut v = [drag_input(start.0, start.1, 0), drag_input(start.0, start.1, MOUSEEVENTF_LEFTDOWN)];
            if !drag_inputs(&mut v) {
                return Err("Windows blocked the input (an elevated program, or a secure screen)".into());
            }
            let gen = DRAG_GEN.fetch_add(1, Ordering::SeqCst) + 1;
            *guard = Some(DragState {
                hwnd,
                start,
                cur: start,
                down_at: start,
                travelled: 0.0,
                saved: (saved.x, saved.y),
                rect,
                height: ht,
                last: Instant::now(),
                gen,
                aim: fractions,
            });
            drop(guard);
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_millis(250));
                let Ok(mut g) = DRAG.lock() else { return };
                match g.as_ref() {
                    Some(st) if st.gen == gen => {
                        if st.last.elapsed() > Duration::from_millis(2000) {
                            if let Some(st) = g.take() {
                                drag_release(&st);
                            }
                            return;
                        }
                    }
                    _ => return,
                }
            });
            Ok(serde_json::json!({ "phase": "start", "x": start.0, "y": start.1, "height": ht }))
        },
        "move" => unsafe {
            let st = match guard.as_mut() {
                Some(st) if st.hwnd == hwnd => st,
                _ => return Err("no turn in progress".into()),
            };
            if GetForegroundWindow() as isize != hwnd {
                if let Some(st) = guard.take() {
                    drag_release(&st);
                }
                return Err("foreground changed, so the turn was let go".into());
            }
            st.last = Instant::now();
            if dx == 0.0 && dy == 0.0 {
                return Ok(serde_json::json!({ "phase": "move", "held": true }));
            }
            let lim = st.height / 2.0;
            let px = (dx / 360.0 * st.height).clamp(-lim, lim);
            let py = (-dy / 360.0 * st.height).clamp(-lim, lim);
            let (l, t, r, b) = st.rect;
            let inset = 6.0;
            let inside = |p: (f64, f64)| p.0 > l + inset && p.0 < r - inset && p.1 > t + inset && p.1 < b - inset;
            let clampin = |p: (f64, f64)| ((p.0).clamp(l + inset, r - inset), (p.1).clamp(t + inset, b - inset));
            let mut v = Vec::with_capacity(4);
            let mut next = (st.cur.0 + px, st.cur.1 + py);
            let mut regrabbed = false;
            if !inside(next) {
                /* Let go, find bare map again (the map has turned since
                   the first press, and its labels with it), take hold. */
                let mut up = [drag_input(st.cur.0, st.cur.1, MOUSEEVENTF_LEFTUP)];
                drag_inputs(&mut up);
                if let Some((x, y)) = aim_probe(hwnd as windows_sys::Win32::Foundation::HWND, &st.aim) {
                    st.start = (x as f64, y as f64);
                }
                v.push(drag_input(st.start.0, st.start.1, 0));
                v.push(drag_input(st.start.0, st.start.1, MOUSEEVENTF_LEFTDOWN));
                st.down_at = st.start;
                st.travelled = 0.0;
                next = clampin((st.start.0 + px, st.start.1 + py));
                regrabbed = true;
            }
            v.push(drag_input(next.0, next.1, 0));
            if !drag_inputs(&mut v) {
                if let Some(st) = guard.take() {
                    drag_release(&st);
                }
                return Err("Windows blocked the input".into());
            }
            st.cur = next;
            st.travelled = st.travelled.max(((next.0 - st.down_at.0).powi(2) + (next.1 - st.down_at.1).powi(2)).sqrt());
            Ok(serde_json::json!({ "phase": "move", "px": px, "py": py, "regrabbed": regrabbed }))
        },
        "end" => unsafe {
            let Some(st) = guard.take() else { return Ok(serde_json::json!({ "phase": "end", "held": false })) };
            if st.travelled < 7.0 {
                let mut v = [drag_input(st.cur.0 + 8.0, st.cur.1, 0), drag_input(st.cur.0, st.cur.1, 0)];
                drag_inputs(&mut v);
            }
            drag_release(&st);
            Ok(serde_json::json!({ "phase": "end", "held": true }))
        },
        other => Err(format!("unknown turn phase \"{}\"", other)),
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn drag_send(_hwnd: isize, _phase: String, _dx: f64, _dy: f64, _aim: Option<Vec<f64>>) -> Result<serde_json::Value, String> {
    Err("only available on Windows".into())
}

/* ------------------------------------------------------------------
   ONE HAND SCROLLS, ONE FINGER POINTS (2.16.0)

   The scroll goes only to the window asked about, only while it is in front —
   put back in front and checked if our own camera window or the orb took
   focus, refused if he switched to another program (input_target, the
   same rule as zoom_send).

   scroll_send: the page follows his pinched hand, so the page decides the
   signs (gesture-zoom.js); here v is the vertical wheel (+ = up, toward
   the top of the page) and h the horizontal one (+ = right), in wheel
   units (120 a notch), any amount — browsers and Office scroll by the
   fraction, older programs add them up to a notch. Windows sends a wheel
   to the window under the pointer, so the pointer is put over this one
   first if it is not (zoom_aim_at).

   pointer_send (2.17.0: everywhere, not one window): see below.
------------------------------------------------------------------ */
#[cfg(target_os = "windows")]
unsafe fn input_target(app: &tauri::AppHandle, hwnd: isize) -> Result<windows_sys::Win32::Foundation::HWND, String> {
    use std::{thread, time::Duration};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsIconic, IsWindow, SetForegroundWindow};
    let own = zoom_own_windows(app);
    let label_of = |h: isize| own.iter().find(|(_, x)| *x == h).map(|(l, _)| l.clone());
    if let Some(l) = label_of(hwnd) {
        if zoom_is_control(&l) || l == "model" {
            return Err("that is JARVIS's own window".into());
        }
    }
    unsafe {
        let h = hwnd as HWND;
        if hwnd == 0 || IsWindow(h) == 0 {
            return Err("that window is gone".into());
        }
        if IsIconic(h) != 0 {
            return Err("the window is minimised".into());
        }
        let fg = GetForegroundWindow() as isize;
        if fg != hwnd {
            let ours = label_of(fg).map(|l| zoom_is_control(&l)).unwrap_or(false);
            if !(ours || fg == 0) {
                return Err("foreground changed".into());
            }
            SetForegroundWindow(h);
            thread::sleep(Duration::from_millis(60));
            if GetForegroundWindow() as isize != hwnd {
                return Err("could not bring the window forward, so nothing was sent".into());
            }
        }
        Ok(h)
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn scroll_send(app: tauri::AppHandle, hwnd: isize, h: i32, v: i32) -> Result<String, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    };
    let (h, v) = (h.clamp(-1200, 1200), v.clamp(-1200, 1200));
    if h == 0 && v == 0 {
        return Ok("nothing to send".into());
    }
    unsafe {
        let w = input_target(&app, hwnd)?;
        zoom_aim_at(w)?;
        let wheel = |delta: i32, flags| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: delta as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 },
            },
        };
        let mut inputs: Vec<INPUT> = Vec::with_capacity(2);
        if v != 0 {
            inputs.push(wheel(v, MOUSEEVENTF_WHEEL));
        }
        if h != 0 {
            inputs.push(wheel(h, MOUSEEVENTF_HWHEEL));
        }
        let sent = SendInput(inputs.len() as u32, inputs.as_mut_ptr(), std::mem::size_of::<INPUT>() as i32);
        if (sent as usize) < inputs.len() {
            return Err("Windows blocked the input (an elevated program, or a secure screen)".into());
        }
    }
    Ok(format!("scroll {} {}", h, v))
}

/* THE FINGER IS THE MOUSE, EVERYWHERE (2.17.0). The pointer goes where
   his finger points on the MONITOR the pointer was on when he started
   pointing — x, y are fractions of that whole monitor, taskbar included —
   and stays on that monitor until he stops (a window coming to the front
   does not move the map under his finger). "click" is the left button
   down and up where the pointer is, like a real mouse: it goes to
   whatever is there.

   A CONTINUOUS LINE (2.19.0). The camera gives a position about thirty
   times a second, each a little late, and the calls that carry them here
   do not arrive evenly; sent straight to Windows they were thirty small
   jumps a second, and a hand the tracker lost for a few frames froze the
   cursor and then threw it. "move" now only sets where the hand is and how
   fast it is going (vx, vy, fractions of the monitor a second) and how late
   the camera's picture was (late, ms, when the browser can say); a thread
   moves the real cursor along glide.rs's line every few milliseconds —
   coasting between samples, leading a little, bridging a dropout, never
   jumping. It runs only between "start" and "end" (and is asleep, costing
   nothing, the rest of the time). Windows' timer is asked for 1 ms steps
   while it runs, or a 15 ms sleep would be 60 Hz at best. */
#[cfg(target_os = "windows")]
struct PointerState {
    monitor: Option<(f64, f64, f64, f64)>,
    glide: Option<glide::Glide>,
    sent: (i64, i64),
    failed: Option<String>,
    period: bool,
}

#[cfg(target_os = "windows")]
static POINTER: std::sync::Mutex<PointerState> =
    std::sync::Mutex::new(PointerState { monitor: None, glide: None, sent: (i64::MIN, i64::MIN), failed: None, period: false });
#[cfg(target_os = "windows")]
static POINTER_THREAD: std::sync::Once = std::sync::Once::new();

#[cfg(target_os = "windows")]
fn pointer_clock_ms() -> f64 {
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    START.get_or_init(std::time::Instant::now).elapsed().as_secs_f64() * 1000.0
}

#[cfg(target_os = "windows")]
unsafe fn monitor_under_pointer() -> (f64, f64, f64, f64) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTOPRIMARY};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let mut cur = POINT { x: 0, y: 0 };
        GetCursorPos(&mut cur);
        let mon = MonitorFromPoint(cur, MONITOR_DEFAULTTOPRIMARY);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if !mon.is_null() && GetMonitorInfoW(mon, &mut mi) != 0 {
            let r = mi.rcMonitor;
            return (r.left as f64, r.top as f64, (r.right - r.left) as f64, (r.bottom - r.top) as f64);
        }
        (0.0, 0.0, GetSystemMetrics(SM_CXSCREEN) as f64, GetSystemMetrics(SM_CYSCREEN) as f64)
    }
}

#[cfg(target_os = "windows")]
unsafe fn cursor_position() -> (f64, f64) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    unsafe {
        let mut cur = POINT { x: 0, y: 0 };
        GetCursorPos(&mut cur);
        (cur.x as f64, cur.y as f64)
    }
}

/* The pointer is let go: no more moving, the timer back to normal. */
#[cfg(target_os = "windows")]
fn pointer_release(st: &mut PointerState) {
    st.glide = None;
    st.monitor = None;
    st.sent = (i64::MIN, i64::MIN);
    if st.period {
        st.period = false;
        unsafe {
            windows_sys::Win32::Media::timeEndPeriod(1);
        }
    }
}

/* The cursor's new place, every few milliseconds, while it is being moved. */
#[cfg(target_os = "windows")]
fn pointer_glide_loop() {
    loop {
        let mut wait = 25u64;
        if let Ok(mut st) = POINTER.lock() {
            let now = pointer_clock_ms();
            if let Some(p) = st.glide.as_mut().map(|g| g.step(now)) {
                wait = 4;
                let to = (p.0.round() as i64, p.1.round() as i64);
                if to != st.sent {
                    let ok = unsafe { drag_inputs(&mut [drag_input(to.0 as f64, to.1 as f64, 0)]) };
                    if ok {
                        st.sent = to;
                    } else {
                        st.failed = Some("Windows blocked the input (an elevated program, or a secure screen)".into());
                        pointer_release(&mut st);
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(wait));
    }
}

/* The pointer starts on this monitor, from where the cursor is. */
#[cfg(target_os = "windows")]
fn pointer_begin(st: &mut PointerState, m: (f64, f64, f64, f64), from: (f64, f64)) {
    st.monitor = Some(m);
    st.glide = Some(glide::Glide::new(from.0, from.1, pointer_clock_ms(), m.2 / 1920.0));
    st.sent = (i64::MIN, i64::MIN);
    if !st.period {
        st.period = true;
        unsafe {
            windows_sys::Win32::Media::timeBeginPeriod(1);
        }
    }
    POINTER_THREAD.call_once(|| {
        let _ = std::thread::Builder::new().name("jarvis-pointer".into()).spawn(pointer_glide_loop);
    });
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn pointer_send(
    phase: String,
    x: Option<f64>,
    y: Option<f64>,
    vx: Option<f64>,
    vy: Option<f64>,
    late: Option<f64>,
) -> Result<serde_json::Value, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP};
    let mut st = POINTER.lock().map_err(|_| "the pointer is unavailable".to_string())?;
    if let Some(e) = st.failed.take() {
        return Err(e);
    }
    unsafe {
        match phase.as_str() {
            "start" => {
                let m = monitor_under_pointer();
                pointer_begin(&mut st, m, cursor_position());
                Ok(serde_json::json!({ "phase": "start", "monitor": [m.0, m.1, m.2, m.3] }))
            }
            "end" => {
                pointer_release(&mut st);
                Ok(serde_json::json!({ "phase": "end" }))
            }
            "move" | "click" => {
                let (x, y) = match (x, y) {
                    (Some(x), Some(y)) if x.is_finite() && y.is_finite() => (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0)),
                    _ => return Err("no place to point at".into()),
                };
                let (l, t, w, h) = match st.monitor {
                    Some(m) => m,
                    None => {
                        let m = monitor_under_pointer();
                        let from = (l_of(m, x), t_of(m, y));
                        pointer_begin(&mut st, m, from);
                        m
                    }
                };
                let (px, py) = (l + x * (w - 1.0), t + y * (h - 1.0));
                let now = pointer_clock_ms();
                if phase == "move" {
                    let (vx, vy) = (vx.filter(|v| v.is_finite()).unwrap_or(0.0), vy.filter(|v| v.is_finite()).unwrap_or(0.0));
                    if let Some(g) = st.glide.as_mut() {
                        g.set(px, py, vx * (w - 1.0), vy * (h - 1.0), now, late);
                    }
                    Ok(serde_json::json!({ "phase": "move", "x": px, "y": py }))
                } else {
                    /* The click goes exactly where he pointed, at rest. */
                    if let Some(g) = st.glide.as_mut() {
                        g.snap(px, py, now);
                    }
                    st.sent = (px.round() as i64, py.round() as i64);
                    let ok = drag_inputs(&mut [
                        drag_input(px.round(), py.round(), 0),
                        drag_input(px.round(), py.round(), MOUSEEVENTF_LEFTDOWN),
                        drag_input(px.round(), py.round(), MOUSEEVENTF_LEFTUP),
                    ]);
                    if !ok {
                        return Err("Windows blocked the input (an elevated program, or a secure screen)".into());
                    }
                    Ok(serde_json::json!({ "phase": "click", "x": px, "y": py }))
                }
            }
            other => Err(format!("unknown pointer phase \"{}\"", other)),
        }
    }
}

#[cfg(target_os = "windows")]
fn l_of(m: (f64, f64, f64, f64), x: f64) -> f64 {
    m.0 + x * (m.2 - 1.0)
}

#[cfg(target_os = "windows")]
fn t_of(m: (f64, f64, f64, f64), y: f64) -> f64 {
    m.1 + y * (m.3 - 1.0)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn scroll_send(_hwnd: isize, _h: i32, _v: i32) -> Result<String, String> {
    Err("only available on Windows".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn pointer_send(
    _phase: String,
    _x: Option<f64>,
    _y: Option<f64>,
    _vx: Option<f64>,
    _vy: Option<f64>,
    _late: Option<f64>,
) -> Result<serde_json::Value, String> {
    Err("only available on Windows".into())
}

/* WHO IS ON TOP WHILE THE ORB FILLS THE SCREEN.

   The orb is always-on-top, which is right for a 180 px circle floating over
   his work. Full screen, the same flag put an opaque, monitor-sized window
   above everything: the 3D viewer (an ordinary window) opened behind it and
   was never seen, and the camera window (also always-on-top) went under it
   the moment the orb was clicked or spoken to — which is what "the camera
   and the 3D models do not work in full screen" was. Nothing was broken
   except the order.

   So, full screen: the orb is an ordinary window, and JARVIS's own windows
   (the camera, the 3D viewer, the workspace panes) float above it. Small
   again: the orb goes back on top and the others back to normal. The page
   calls this around setFullscreen; the flag it leaves is what a viewer or
   pane created later is born with. */
#[tauri::command]
fn orb_layer(app: tauri::AppHandle, expanded: bool) -> Result<serde_json::Value, String> {
    ORB_EXPANDED.store(expanded, Ordering::SeqCst);
    let mut raised: Vec<String> = Vec::new();
    for (label, w) in app.webview_windows() {
        if label == "main" {
            w.set_always_on_top(!expanded).map_err(|e| e.to_string())?;
        } else if label == "camera" {
            /* Always on top in both states. What puts it above the full-
               screen orb is the orb leaving the always-on-top band, not
               anything done here (tao only reorders when the flag changes). */
            raised.push(label);
        } else if label == "model" || label.starts_with("ws-") {
            let _ = w.set_always_on_top(expanded);
            if expanded {
                raised.push(label);
            }
        }
    }
    Ok(serde_json::json!({ "expanded": expanded, "above": raised }))
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
            list_processes,
            zoom_target,
            zoom_send,
            bring_window_here,
            orb_layer,
            stash_model,
            stashed_model,
            refresh_orb,
            save_model_file,
            save_trace_file,
            launch_3d_workspace,
            launch_app,
            drag_send,
            scroll_send,
            pointer_send,
            media_key,
            music_window,
            music_control,
            front_workspace,
            adjust_window,
            type_text
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
            let refresh = Shortcut::new(Some(REFRESH_MODS), REFRESH_CODE);
            let hotkey_window = window.clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |hk_app, fired, event| {
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
                        } else if fired.matches(REFRESH_MODS, REFRESH_CODE) {
                            refresh_orb_now(hk_app);
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
            if let Err(err) = app.global_shortcut().register(refresh) {
                eprintln!(
                    "JARVIS: could not register {} — another app may already use it ({})",
                    REFRESH_LABEL, err
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
            let refresh_item = MenuItem::with_id(app, "refresh", "Refresh JARVIS", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hush_item, &refresh_item, &hide_item, &quit_item])?;

            let tray_window = window.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(&format!(
                    "JARVIS — hold {} to talk, {} to summon, {} to stop talking, {} to refresh",
                    PTT_LABEL, HOTKEY_LABEL, HUSH_LABEL, REFRESH_LABEL
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
                    "refresh" => refresh_orb_now(app),
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
