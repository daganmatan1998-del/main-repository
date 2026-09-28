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
fn zoom_send(app: tauri::AppHandle, hwnd: isize, method: String, notches: i32) -> Result<String, String> {
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
                zoom_aim_at(h)?;
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
fn zoom_send(_hwnd: isize, _method: String, _notches: i32) -> Result<String, String> {
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

    let builder = WebviewWindowBuilder::new(&app, "model", WebviewUrl::App(page.into()))
        .title("JARVIS — 3D")
        .inner_size(620.0, 620.0)
        .min_inner_size(240.0, 240.0)
        .center()
        .resizable(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(false)
        .skip_taskbar(false);
    // A see-through webview needs the private API on macOS; everywhere else
    // it is an ordinary window attribute.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);
    builder.build().map_err(|e| e.to_string())?;
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
            list_processes,
            zoom_target,
            zoom_send,
            bring_window_here
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
