//! ringback: JARVIS's phone line. A small MCP (JSON-RPC over stdio) client for the
//! ringback voice server, which runs in Docker, plus the helpers around it. Std and
//! serde_json only - no Tauri - so it compiles and is tested on its own.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// The only ringback tools JARVIS may ever invoke. Anything else the model asks for
/// (alert_me, a made-up name, a path) is refused before it reaches the server.
pub const ALLOWED_TOOLS: [&str; 7] = [
    "call_start",
    "converse",
    "speak",
    "listen",
    "call_status",
    "get_conversation",
    "call_end",
];

/// What ringback cannot start without (a Linphone SIP account).
pub const REQUIRED_ENV: [&str; 3] = ["VOICE_SIP_ID", "VOICE_SIP_USER", "VOICE_SIP_PASS"];

/// Docker Desktop on Windows/macOS sits behind a NAT: without STUN the phone's audio
/// never arrives (one-way call), so it is on by default.
const DEFAULT_STUN: &str = "stun.l.google.com:19302";

pub fn tool_allowed(name: &str) -> bool {
    ALLOWED_TOOLS.contains(&name)
}

/// `KEY=value` and `export KEY="value"` lines, as written by Notepad on Windows:
/// CRLF endings, a UTF-8 BOM, quotes, `#` comments.
pub fn parse_env_file(text: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for line in text.trim_start_matches('\u{feff}').lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let (k, v) = (k.trim(), v.trim());
        if k.is_empty() {
            continue;
        }
        let v = match (v.chars().next(), v.chars().last()) {
            (Some(a), Some(b)) if v.len() >= 2 && (a == '"' || a == '\'') && a == b => {
                &v[1..v.len() - 1]
            }
            _ => v,
        };
        out.insert(k.to_string(), v.to_string());
    }
    out
}

fn is_placeholder(v: &str) -> bool {
    let l = v.trim().to_lowercase();
    l.is_empty() || l.contains("change_me") || l.contains("yourname") || l == "your-password"
}

/// Required variables that are absent, empty or still the example's placeholder,
/// in `REQUIRED_ENV` order.
pub fn missing_env(vars: &BTreeMap<String, String>) -> Vec<&'static str> {
    REQUIRED_ENV
        .iter()
        .copied()
        .filter(|k| vars.get(*k).map_or(true, |v| is_placeholder(v)))
        .collect()
}

/// Arguments for `docker`, ringback speaking MCP on stdio (`-i`). Credentials come
/// from the env file at run time, never on the command line.
pub fn docker_args(image: &str, env_file: &Path, vars: &BTreeMap<String, String>) -> Vec<String> {
    let mut a: Vec<String> = vec!["run".into(), "-i".into(), "--rm".into()];
    if !vars.contains_key("VOICE_STUN") {
        a.push("-e".into());
        a.push(format!("VOICE_STUN={DEFAULT_STUN}"));
    }
    a.push("--env-file".into());
    a.push(env_file.to_string_lossy().into_owned());
    a.push(image.to_string());
    a
}

/// How ringback is started. Docker is the default; a `ringback.launch` file switches
/// to the copy that already works inside WSL, with its own Python environment.
#[derive(Debug, Clone, PartialEq)]
pub enum Launcher {
    Docker,
    Wsl(WslLaunch),
}

/// Everything needed to start `run_voice_mcp.py` inside a WSL distribution. Credentials
/// are not here and never travel through us: `run_voice_mcp.py` reads its own `voice.env`
/// inside WSL.
#[derive(Debug, Clone, PartialEq)]
pub struct WslLaunch {
    pub distro: String,
    pub cwd: String,
    pub python: String,
    pub script: String,
}

const LAUNCH_KEYS: [&str; 4] = ["distro", "cwd", "python", "script"];

fn launch_field(
    obj: &serde_json::Map<String, Value>,
    key: &str,
    default: Option<&str>,
) -> Result<String, String> {
    match obj.get(key) {
        Some(Value::String(v)) => Ok(v.clone()),
        Some(_) => Err(format!("ringback.launch: \"{key}\" must be text")),
        None => default.map(String::from).ok_or_else(|| match key {
            "python" => "ringback.launch: \"python\" is missing - give the full path of the python inside the ringback virtualenv, e.g. /home/you/ringback/.venv/bin/python".to_string(),
            "cwd" => "ringback.launch: \"cwd\" is missing - the folder of ringback inside WSL, e.g. /home/you/ringback".to_string(),
            "distro" => "ringback.launch: \"distro\" is missing - the WSL distribution name exactly as `wsl -l -v` prints it".to_string(),
            _ => format!("ringback.launch: \"{key}\" is missing"),
        }),
    }
}

fn plain_chars(s: &str, extra: &[char]) -> bool {
    s.chars().all(|c| {
        c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' || extra.contains(&c)
    })
}

fn valid_linux_path(s: &str) -> bool {
    s.starts_with('/')
        && s.len() <= 260
        && plain_chars(s, &['/', '+', '@'])
        && !s.split('/').any(|seg| seg == "..")
}

/// No file means Docker. A file that is there but wrong is an error to show him, never a
/// quiet fall back to Docker: he asked for WSL, and starting something else would hide
/// the mistake. Only the four known keys are accepted, so the file cannot carry a command.
pub fn choose_launcher(launch_text: Option<&str>) -> Result<Launcher, String> {
    let Some(text) = launch_text else {
        return Ok(Launcher::Docker);
    };
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "ringback.launch is not valid JSON".to_string())?;
    let obj = v
        .as_object()
        .ok_or("ringback.launch must be a JSON object")?;
    if let Some(k) = obj.keys().find(|k| !LAUNCH_KEYS.contains(&k.as_str())) {
        return Err(format!(
            "ringback.launch: unknown key \"{k}\" (allowed: distro, cwd, python, script)"
        ));
    }
    let distro = launch_field(obj, "distro", None)?;
    let cwd = launch_field(obj, "cwd", None)?;
    let python = launch_field(obj, "python", None)?;
    let script = launch_field(obj, "script", Some("run_voice_mcp.py"))?;
    if distro.is_empty()
        || !distro.starts_with(|c: char| c.is_ascii_alphanumeric())
        || !plain_chars(&distro, &[])
    {
        return Err("ringback.launch: \"distro\" must be the distribution name exactly as `wsl -l -v` prints it (letters, digits, . _ -)".to_string());
    }
    if !valid_linux_path(&cwd) {
        return Err("ringback.launch: \"cwd\" must be an absolute Linux path without spaces, e.g. /home/you/ringback".to_string());
    }
    if !valid_linux_path(&python) {
        return Err("ringback.launch: \"python\" must be the absolute path of the virtualenv's python (no bare `python3`, no spaces)".to_string());
    }
    if !script.ends_with(".py")
        || script.len() < 4
        || script.contains("..")
        || !plain_chars(&script, &[])
    {
        return Err(
            "ringback.launch: \"script\" must be a plain file name ending in .py".to_string(),
        );
    }
    Ok(Launcher::Wsl(WslLaunch {
        distro,
        cwd,
        python,
        script,
    }))
}

/// Arguments for `wsl.exe`. `--exec` runs the program directly, with no shell in between,
/// so nothing in the paths can be interpreted as a command.
pub fn wsl_args(l: &WslLaunch) -> Vec<String> {
    [
        "--distribution",
        &l.distro,
        "--cd",
        &l.cwd,
        "--exec",
        &l.python,
        &l.script,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// One running ringback server. Requests are one JSON object per line; a reader
/// thread forwards stdout lines so every wait can time out.
pub struct McpClient {
    child: Child,
    stdin: Option<ChildStdin>,
    rx: Receiver<String>,
    next_id: u64,
    dead: bool,
    /// The last lines ringback wrote to stderr (Python tracebacks end up here).
    stderr_tail: std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<String>>>,
}

const STDERR_KEEP: usize = 60;
const TAIL_LINES: usize = 25;
const TAIL_LINE_CHARS: usize = 300;
const TAIL_MAX_CHARS: usize = 4000;

/// A line that might carry a credential is never shown.
fn line_may_hold_a_secret(line: &str) -> bool {
    let l = line.to_lowercase();
    [
        "pass",
        "secret",
        "token",
        "authorization",
        "apikey",
        "api_key",
        "api-key",
        "credential",
    ]
    .iter()
    .any(|w| l.contains(w))
}

/// `message`, followed by what ringback itself said before it failed.
fn with_log(message: &str, tail: &str) -> String {
    if tail.is_empty() {
        message.to_string()
    } else {
        format!("{message}\n--- ringback log (last lines) ---\n{tail}")
    }
}

impl McpClient {
    pub fn start(mut cmd: Command) -> Result<McpClient, String> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start ringback: {e}"))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("ringback has no stdout")?;
        let stderr_tail =
            std::sync::Arc::new(std::sync::Mutex::new(std::collections::VecDeque::new()));
        if let Some(err) = child.stderr.take() {
            let tail = stderr_tail.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines() {
                    let Ok(line) = line else { break };
                    if let Ok(mut q) = tail.lock() {
                        q.push_back(line);
                        while q.len() > STDERR_KEEP {
                            q.pop_front();
                        }
                    }
                }
            });
        }
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(l) => {
                        if tx.send(l).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });
        let mut c = McpClient {
            child,
            stdin,
            rx,
            next_id: 1,
            dead: false,
            stderr_tail,
        };
        let started = c
            .request(
                "initialize",
                json!({"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "jarvis", "version": "1"}}),
                Duration::from_secs(120),
            )
            .and_then(|_| {
                c.write_line(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))
            });
        match started {
            Ok(()) => Ok(c),
            Err(m) => Err(with_log(&m, &c.log_tail())),
        }
    }

    fn write_line(&mut self, v: &Value) -> Result<(), String> {
        let line = format!("{v}\n");
        let ok = match self.stdin.as_mut() {
            Some(w) => w.write_all(line.as_bytes()).and_then(|_| w.flush()).is_ok(),
            None => false,
        };
        if !ok {
            self.dead = true;
            return Err("ringback ended".into());
        }
        Ok(())
    }

    fn request(&mut self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write_line(&json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))?;
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.rx.recv_timeout(left) {
                Ok(line) => {
                    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    if msg.get("id").and_then(Value::as_u64) != Some(id) {
                        continue;
                    }
                    if let Some(err) = msg.get("error") {
                        let m = err
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("ringback error");
                        return Err(m.to_string());
                    }
                    return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "ringback timed out after {:.1}s",
                        timeout.as_secs_f32()
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.dead = true;
                    return Err("ringback ended".into());
                }
            }
        }
    }

    /// Calls one MCP tool and returns its text; a tool-level failure is an `Err` with its text.
    pub fn call_tool(
        &mut self,
        name: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<String, String> {
        let result = self.request(
            "tools/call",
            json!({"name": name, "arguments": args}),
            timeout,
        )?;
        let text = result
            .get("content")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|i| i.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        if result.get("isError").and_then(Value::as_bool) == Some(true) {
            Err(text)
        } else {
            Ok(text)
        }
    }

    /// The last lines of ringback's own output, safe to show: secret-looking lines hidden,
    /// long lines cut, the whole bounded. Waits a moment so a failing process has finished
    /// writing before it is read.
    pub fn log_tail(&self) -> String {
        std::thread::sleep(Duration::from_millis(80));
        let lines: Vec<String> = match self.stderr_tail.lock() {
            Ok(q) => q
                .iter()
                .rev()
                .take(TAIL_LINES)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect(),
            Err(_) => Vec::new(),
        };
        let shown: Vec<String> = lines
            .iter()
            .map(|l| l.trim_end())
            .filter(|l| !l.is_empty())
            .map(|l| {
                if line_may_hold_a_secret(l) {
                    "[line hidden: may hold a secret]".to_string()
                } else {
                    l.chars().take(TAIL_LINE_CHARS).collect()
                }
            })
            .collect();
        let joined = shown.join("\n");
        let n = joined.chars().count();
        if n > TAIL_MAX_CHARS {
            joined.chars().skip(n - TAIL_MAX_CHARS).collect()
        } else {
            joined
        }
    }

    pub fn is_alive(&mut self) -> bool {
        !self.dead && matches!(self.child.try_wait(), Ok(None))
    }

    pub fn stop(&mut self) {
        self.dead = true;
        self.stdin = None;
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for McpClient {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Why a call could not go ahead. `tell_the_user` is a plain sentence JARVIS may say.
#[derive(Debug, Clone, PartialEq)]
pub struct CallError {
    pub message: String,
    pub tell_the_user: Option<String>,
}

impl CallError {
    fn new(message: &str) -> CallError {
        CallError {
            message: message.to_string(),
            tell_the_user: None,
        }
    }
}

/// One plain sentence naming the first thing standing between him and a call;
/// empty when everything is in place.
pub fn status_why(docker: bool, env_found: bool, missing: &[&str], env_path: &str) -> String {
    if !docker {
        "Docker is not installed or not on the PATH. Install Docker Desktop and start it."
            .to_string()
    } else if !env_found {
        format!("The ringback settings file does not exist yet: {env_path}")
    } else if !missing.is_empty() {
        format!(
            "These are still missing in ringback.env: {}.",
            missing.join(", ")
        )
    } else {
        String::new()
    }
}

/// Whether a call can be attempted, and the plain sentence for what is in the way.
pub struct Readiness {
    pub mode: &'static str,
    pub ready: bool,
    pub why: String,
}

/// WSL needs only `wsl.exe` here (its own credentials and Python live inside WSL, which
/// we neither read nor check); Docker needs Docker and the env file; a broken launch
/// file is never ready and says what is wrong with it.
pub fn readiness(
    launcher: &Result<Launcher, String>,
    docker: bool,
    wsl_present: bool,
    env_found: bool,
    missing: &[&str],
    env_path: &str,
) -> Readiness {
    match launcher {
        Err(e) => Readiness {
            mode: "invalid",
            ready: false,
            why: e.clone(),
        },
        Ok(Launcher::Wsl(_)) => Readiness {
            mode: "wsl",
            ready: wsl_present,
            why: if wsl_present {
                String::new()
            } else {
                "wsl.exe was not found on this PC.".to_string()
            },
        },
        Ok(Launcher::Docker) => Readiness {
            mode: "docker",
            ready: docker && env_found && missing.is_empty(),
            why: status_why(docker, env_found, missing, env_path),
        },
    }
}

const DEFAULT_MAX_TURNS: u32 = 30;
const DEFAULT_MAX_EMPTY: u32 = 3;

/// What ringback answers when nobody said anything on the caller's turn.
fn is_silence(text: &str) -> bool {
    let t = text.trim();
    t.is_empty() || t.starts_with("[SILENCE]")
}

/// Replies that mean there is no call (any more): he hung up, nobody picked up, or the
/// call was never up.
fn is_over_marker(text: &str) -> bool {
    text.contains("[CALL ENDED]")
        || text.contains("[NO ANSWER]")
        || text.contains("[NO ACTIVE CALL]")
        || text.contains("then the call ENDED")
}

/// The phone line: at most one ringback process, started on first use, dropped when
/// the call ends, when anything goes wrong, or when the call outlives its limits.
pub struct Phone {
    client: Option<McpClient>,
    call_started: Option<Instant>,
    max_call: Duration,
    max_turns: u32,
    max_empty: u32,
    turns: u32,
    empty_streak: u32,
}

impl Phone {
    pub fn new(max_call: Duration) -> Phone {
        Phone::with_limits(max_call, DEFAULT_MAX_TURNS, DEFAULT_MAX_EMPTY)
    }

    pub fn with_limits(max_call: Duration, max_turns: u32, max_empty: u32) -> Phone {
        Phone {
            client: None,
            call_started: None,
            max_call,
            max_turns,
            max_empty,
            turns: 0,
            empty_streak: 0,
        }
    }

    pub fn running(&mut self) -> bool {
        let alive = match self.client.as_mut() {
            Some(c) => c.is_alive(),
            None => return false,
        };
        if !alive {
            self.drop_client();
        }
        alive
    }

    /// A call is actually up: started, answered, and not over.
    pub fn call_up(&self) -> bool {
        self.call_started.is_some() && self.client.is_some()
    }

    pub fn stop(&mut self) {
        self.drop_client();
    }

    fn drop_client(&mut self) {
        if let Some(mut c) = self.client.take() {
            c.stop();
        }
        self.call_started = None;
        self.turns = 0;
        self.empty_streak = 0;
    }

    /// Hang up properly (a call_end the phone hears) before dropping the process.
    fn end_politely(&mut self) {
        if let Some(c) = self.client.as_mut() {
            if c.is_alive() {
                let _ = c.call_tool("call_end", json!({}), Duration::from_secs(8));
            }
        }
        self.drop_client();
    }

    /// Runs one ringback tool. `make_cmd` builds the process, and is only called
    /// when a new call starts and no live process exists.
    pub fn call(
        &mut self,
        tool: &str,
        args: Value,
        timeout: Duration,
        make_cmd: impl FnOnce() -> Command,
    ) -> Result<String, CallError> {
        if !tool_allowed(tool) {
            return Err(CallError::new("that ringback tool is not allowed"));
        }
        if let Some(t0) = self.call_started {
            if t0.elapsed() > self.max_call {
                self.end_politely();
                return Err(CallError {
                    message: "call time limit reached".to_string(),
                    tell_the_user: Some(format!(
                        "The call reached its {} minute limit and was ended.",
                        self.max_call.as_secs() / 60
                    )),
                });
            }
        }
        if tool == "call_start" && self.call_started.is_some() && self.running() {
            return Err(CallError {
                message: "a call is already up".to_string(),
                tell_the_user: Some("A call is already in progress.".to_string()),
            });
        }
        if !self.running() {
            // Only a new call may start the container; hanging up or talking with no
            // call up would boot Docker just to be told there is nothing to do.
            if tool != "call_start" {
                return Err(CallError::new("no call is up"));
            }
            self.client = Some(McpClient::start(make_cmd()).map_err(|m| CallError {
                message: m,
                tell_the_user: Some(
                    "ringback could not be started. Check that Docker is running, or that WSL and the paths in ringback.launch are right."
                        .to_string(),
                ),
            })?);
        }
        if matches!(tool, "converse" | "listen" | "speak") && self.turns >= self.max_turns {
            self.end_politely();
            return Err(CallError {
                message: "turn limit reached".to_string(),
                tell_the_user: Some(format!(
                    "The call reached its {} turn limit and was ended.",
                    self.max_turns
                )),
            });
        }
        let result = match self.client.as_mut() {
            Some(c) => c.call_tool(tool, args, timeout),
            None => Err("ringback is not running".to_string()),
        };
        match result {
            Err(m) => {
                let tail = self
                    .client
                    .as_ref()
                    .map(|c| c.log_tail())
                    .unwrap_or_default();
                self.drop_client();
                Err(CallError {
                    message: with_log(&m, &tail),
                    tell_the_user: Some(
                        "ringback reported an error. The details are in the red box on screen (and copied)."
                            .to_string(),
                    ),
                })
            }
            Ok(text) => self.after_reply(tool, text),
        }
    }

    fn after_reply(&mut self, tool: &str, text: String) -> Result<String, CallError> {
        if tool == "call_end" || is_over_marker(&text) {
            self.drop_client();
            return Ok(text);
        }
        if tool == "call_start" {
            self.call_started = Some(Instant::now());
            self.turns = 0;
            self.empty_streak = 0;
        }
        // Only a caller's turn can be silent; an empty reply from speak, call_status or
        // get_conversation says nothing about him.
        if matches!(tool, "call_start" | "converse" | "listen") {
            self.turns += 1;
            self.empty_streak = if is_silence(&text) {
                self.empty_streak + 1
            } else {
                0
            };
            if self.empty_streak >= self.max_empty {
                let n = self.max_empty;
                self.end_politely();
                return Err(CallError {
                    message: format!("{n} silent turns in a row; the call was ended"),
                    tell_the_user: Some(format!(
                        "He said nothing {n} times in a row, so I ended the call."
                    )),
                });
            }
        }
        Ok(text)
    }
}

/// What the page gets back: the tool's outcome, and whether a call is up afterwards
/// (the page leaves call mode on `false`, whatever else happened).
pub struct Reply {
    pub result: Result<String, CallError>,
    pub call_up: bool,
}

/// The one shared phone line. A second request while one is running is refused at once
/// ("busy"), never queued behind a 90 second wait.
pub struct PhoneLine {
    inner: std::sync::Mutex<Phone>,
    up: std::sync::atomic::AtomicBool,
}

impl PhoneLine {
    pub fn new(max_call: Duration) -> PhoneLine {
        PhoneLine {
            inner: std::sync::Mutex::new(Phone::new(max_call)),
            up: std::sync::atomic::AtomicBool::new(false),
        }
    }

    pub fn call(
        &self,
        tool: &str,
        args: Value,
        timeout: Duration,
        make_cmd: impl FnOnce() -> Command,
    ) -> Reply {
        use std::sync::atomic::Ordering;
        use std::sync::TryLockError;
        let mut phone = match self.inner.try_lock() {
            Ok(g) => g,
            Err(TryLockError::Poisoned(p)) => p.into_inner(),
            Err(TryLockError::WouldBlock) => {
                return Reply {
                    result: Err(CallError {
                        message: "ringback is busy with another action".to_string(),
                        tell_the_user: Some("Another phone action is still running.".to_string()),
                    }),
                    call_up: self.up.load(Ordering::SeqCst),
                }
            }
        };
        let result = phone.call(tool, args, timeout, make_cmd);
        let up = phone.call_up();
        self.up.store(up, Ordering::SeqCst);
        Reply {
            result,
            call_up: up,
        }
    }

    pub fn call_up(&self) -> bool {
        self.up.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// True while a process is running (or a call is mid-action).
    pub fn running(&self) -> bool {
        match self.inner.try_lock() {
            Ok(mut p) => p.running(),
            Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner().running(),
            Err(std::sync::TryLockError::WouldBlock) => true,
        }
    }

    pub fn stop(&self) {
        let mut p = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        p.stop();
        self.up.store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::Path;
    use std::process::Command;
    use std::time::Duration;

    fn fake(args: &[&str]) -> Command {
        let mut c = Command::new("python3");
        c.arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests-support/fake_mcp.py"
        ));
        c.args(args);
        c
    }

    #[test]
    fn parse_env_handles_windows_files() {
        let text = "\u{feff}# c\r\nexport VOICE_SIP_ID=\"sip:a@sip.linphone.org\"\r\nVOICE_SIP_USER=a\r\nVOICE_SIP_PASS='p w'\r\n";
        let v = parse_env_file(text);
        assert_eq!(
            v.get("VOICE_SIP_ID").map(String::as_str),
            Some("sip:a@sip.linphone.org")
        );
        assert_eq!(v.get("VOICE_SIP_USER").map(String::as_str), Some("a"));
        assert_eq!(v.get("VOICE_SIP_PASS").map(String::as_str), Some("p w"));
        assert_eq!(v.len(), 3);
    }

    #[test]
    fn placeholders_count_as_missing() {
        let v = parse_env_file("VOICE_SIP_ID=sip:a@x\nVOICE_SIP_PASS=CHANGE_ME\n");
        assert_eq!(missing_env(&v), vec!["VOICE_SIP_USER", "VOICE_SIP_PASS"]);
    }

    #[test]
    fn docker_args_adds_stun_only_when_absent() {
        let none: BTreeMap<String, String> = BTreeMap::new();
        let a = docker_args("img:1", Path::new("C:\\x\\ringback.env"), &none);
        assert_eq!(&a[..3], &["run", "-i", "--rm"]);
        assert!(a
            .windows(2)
            .any(|w| w[0] == "-e" && w[1] == "VOICE_STUN=stun.l.google.com:19302"));
        assert!(a
            .windows(2)
            .any(|w| w[0] == "--env-file" && w[1] == "C:\\x\\ringback.env"));
        assert_eq!(a.last().map(String::as_str), Some("img:1"));
        let mut with = BTreeMap::new();
        with.insert("VOICE_STUN".to_string(), "stun.example:3478".to_string());
        let b = docker_args("img:1", Path::new("e"), &with);
        assert!(!b.iter().any(|s| s.starts_with("VOICE_STUN=")));
    }

    #[test]
    fn tool_whitelist() {
        for ok in [
            "call_start",
            "converse",
            "speak",
            "listen",
            "call_status",
            "get_conversation",
            "call_end",
        ] {
            assert!(tool_allowed(ok), "{ok}");
        }
        for bad in [
            "",
            "call_start; rm",
            "alert_me",
            "alert_test",
            "shell",
            "run",
            "Converse",
            " converse",
            "../call_start",
        ] {
            assert!(!tool_allowed(bad), "{bad:?}");
        }
        assert_eq!(ALLOWED_TOOLS.len(), 7);
    }

    #[test]
    fn client_round_trip_with_fake_server() {
        let mut c = McpClient::start(fake(&[])).expect("start");
        let r = c.call_tool(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            Duration::from_secs(5),
        );
        assert_eq!(r, Ok("hello hi".to_string()));
        let e = c.call_tool("fail", serde_json::json!({}), Duration::from_secs(5));
        assert_eq!(e, Err("boom".to_string()));
        c.stop();
    }

    #[test]
    fn client_reports_death_and_timeout() {
        // The fake exits right after answering initialize. Whether our "initialized"
        // notification still gets written first is a race, so both outcomes are right:
        // start reports the death itself, or the next call does.
        match McpClient::start(fake(&["--exit-after-init"])) {
            Err(m) => assert!(m.contains("ended"), "{m}"),
            Ok(mut dead) => {
                let r = dead.call_tool("call_start", serde_json::json!({}), Duration::from_secs(5));
                assert!(
                    r.as_ref().err().map_or(false, |m| m.contains("ended")),
                    "{r:?}"
                );
                assert!(!dead.is_alive());
            }
        }
        let mut hung = McpClient::start(fake(&["--hang"])).expect("start");
        let t = hung.call_tool(
            "call_start",
            serde_json::json!({}),
            Duration::from_millis(300),
        );
        assert!(
            t.as_ref().err().map_or(false, |m| m.contains("timed out")),
            "{t:?}"
        );
        hung.stop();
    }

    #[test]
    fn phone_refuses_unlisted_tool_without_starting_anything() {
        let mut p = Phone::new(Duration::from_secs(1200));
        let r = p.call(
            "speak",
            serde_json::json!({}),
            Duration::from_secs(5),
            || panic!("must not start"),
        );
        assert!(r.is_err());
        assert!(!p.running());
    }

    #[test]
    fn phone_starts_lazily_and_ends_on_call_end() {
        let mut p = Phone::new(Duration::from_secs(1200));
        assert!(!p.running());
        let r = p.call(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            Duration::from_secs(5),
            || fake(&[]),
        );
        assert_eq!(r.ok(), Some("hello hi".to_string()));
        assert!(p.running());
        let _ = p.call(
            "call_end",
            serde_json::json!({}),
            Duration::from_secs(5),
            || panic!("already running"),
        );
        assert!(!p.running());
    }

    #[test]
    fn phone_cap_ends_a_long_call() {
        let mut p = Phone::new(Duration::from_millis(50));
        p.call(
            "call_start",
            serde_json::json!({"opening_line": "x"}),
            Duration::from_secs(5),
            || fake(&[]),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(120));
        let e = p
            .call(
                "converse",
                serde_json::json!({"text": "y"}),
                Duration::from_secs(5),
                || panic!("no restart"),
            )
            .unwrap_err();
        assert!(
            e.tell_the_user.as_deref().unwrap_or("").contains("limit"),
            "{e:?}"
        );
        assert!(!p.running());
    }

    #[test]
    fn phone_drops_the_client_after_an_error() {
        let mut p = Phone::new(Duration::from_secs(1200));
        let e = p
            .call(
                "call_start",
                serde_json::json!({}),
                Duration::from_secs(5),
                || fake(&["--exit-after-init"]),
            )
            .unwrap_err();
        assert!(e.message.contains("ended"), "{e:?}");
        assert!(!p.running());
    }

    #[test]
    fn status_why_names_the_first_thing_missing() {
        assert!(status_why(false, true, &[], "e").contains("Docker"));
        assert!(status_why(true, false, &[], "C:\\x\\ringback.env").contains("ringback.env"));
        assert!(status_why(true, true, &["VOICE_SIP_PASS"], "e").contains("VOICE_SIP_PASS"));
        assert_eq!(status_why(true, true, &[], "e"), "");
    }

    #[test]
    fn phone_does_not_start_docker_just_to_hang_up() {
        let mut p = Phone::new(Duration::from_secs(1200));
        for tool in ["call_end", "converse", "call_status", "get_conversation"] {
            let e = p
                .call(tool, serde_json::json!({}), Duration::from_secs(5), || {
                    panic!("must not start for {tool}")
                })
                .unwrap_err();
            assert!(e.message.contains("no call"), "{tool}: {e:?}");
        }
        assert!(!p.running());
    }

    fn log_path(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("fake_mcp_{}_{}.log", std::process::id(), name));
        let _ = std::fs::remove_file(&p);
        p
    }
    fn logged(p: &std::path::Path) -> Vec<String> {
        std::fs::read_to_string(p)
            .unwrap_or_default()
            .lines()
            .map(String::from)
            .collect()
    }
    fn fake_with(replies: &str, log: &std::path::Path) -> Command {
        fake(&["--replies", replies, "--log", log.to_str().unwrap()])
    }
    const SIL: &str = "[SILENCE] \u{2014} user said nothing; you may prompt again.";
    const SAID: &str = "User replied: \"yes\"";
    fn t(s: u64) -> Duration {
        Duration::from_secs(s)
    }
    fn j() -> serde_json::Value {
        serde_json::json!({})
    }

    // ---- launcher selection -------------------------------------------------
    #[test]
    fn launcher_is_docker_when_no_launch_file() {
        assert_eq!(choose_launcher(None), Ok(Launcher::Docker));
    }

    #[test]
    fn launcher_is_wsl_from_a_valid_file_and_args_use_exec_not_a_shell() {
        let text = "\u{feff}{\"distro\":\"Debian-12\",\"cwd\":\"/home/u/ringback\",\"python\":\"/home/u/ringback/.venv/bin/python\"}";
        let l = match choose_launcher(Some(text)) {
            Ok(Launcher::Wsl(l)) => l,
            other => panic!("{other:?}"),
        };
        assert_eq!(l.script, "run_voice_mcp.py");
        assert_eq!(
            wsl_args(&l),
            vec![
                "--distribution",
                "Debian-12",
                "--cd",
                "/home/u/ringback",
                "--exec",
                "/home/u/ringback/.venv/bin/python",
                "run_voice_mcp.py"
            ]
        );
    }

    #[test]
    fn a_present_but_invalid_launch_file_is_an_error_not_a_silent_docker_fallback() {
        let with = |k: &str, v: &str| {
            let mut m = serde_json::json!({"distro":"D","cwd":"/c","python":"/p"});
            m[k] = serde_json::json!(v);
            m.to_string()
        };
        assert!(choose_launcher(Some("")).is_err());
        assert!(choose_launcher(Some("not json")).is_err());
        assert!(choose_launcher(Some("[]")).is_err());
        assert!(choose_launcher(Some(r#"{"distro":"D","cwd":"/c"}"#))
            .unwrap_err()
            .contains("python"));
        assert!(choose_launcher(Some(r#"{"distro":"D","python":"/p"}"#))
            .unwrap_err()
            .contains("cwd"));
        assert!(choose_launcher(Some(r#"{"cwd":"/c","python":"/p"}"#))
            .unwrap_err()
            .contains("distro"));
        assert!(choose_launcher(Some(&with("distro", "Ubuntu; calc"))).is_err());
        assert!(choose_launcher(Some(&with("distro", "<name from wsl -l -v>"))).is_err());
        assert!(choose_launcher(Some(&with("cwd", "relative/path"))).is_err());
        assert!(choose_launcher(Some(&with("cwd", "/a b"))).is_err());
        assert!(
            choose_launcher(Some(&with("python", "python3"))).is_err(),
            "bare python = system python is refused"
        );
        assert!(choose_launcher(Some(&with("python", "/p; rm -rf /"))).is_err());
        assert!(choose_launcher(Some(&with("python", "/p/../q"))).is_err());
        assert!(choose_launcher(Some(&with("script", "../x.py"))).is_err());
        assert!(choose_launcher(Some(&with("script", "run.sh"))).is_err());
        assert!(choose_launcher(Some(
            r#"{"distro":"D","cwd":"/c","python":"/p","command":"calc.exe"}"#
        ))
        .unwrap_err()
        .contains("command"));
    }

    // ---- duplicate call_start, silence, turn cap ------------------------------
    #[test]
    fn a_second_call_start_while_a_call_is_up_is_refused_and_never_reaches_ringback() {
        let log = log_path("dup");
        let mut p = Phone::new(t(1200));
        p.call(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            t(5),
            || fake_with(SAID, &log),
        )
        .unwrap();
        let e = p
            .call(
                "call_start",
                serde_json::json!({"opening_line": "again"}),
                t(5),
                || panic!("no new process"),
            )
            .unwrap_err();
        assert!(e.message.contains("already"), "{e:?}");
        assert!(
            p.call_up() && p.running(),
            "the first call must survive the refusal"
        );
        assert_eq!(logged(&log), vec!["call_start"]);
    }

    #[test]
    fn three_silent_caller_turns_in_a_row_end_the_call_politely() {
        let log = log_path("sil3");
        let mut p = Phone::new(t(1200));
        let r = format!("{SIL}|{SIL}|{SIL}");
        assert!(p
            .call(
                "call_start",
                serde_json::json!({"opening_line": "hi"}),
                t(5),
                || fake_with(&r, &log)
            )
            .is_ok());
        assert!(p
            .call(
                "converse",
                serde_json::json!({"text": "hello?"}),
                t(5),
                || panic!()
            )
            .is_ok());
        let e = p
            .call(
                "converse",
                serde_json::json!({"text": "anyone?"}),
                t(5),
                || panic!(),
            )
            .unwrap_err();
        assert!(e.message.contains("silent"), "{e:?}");
        assert!(e.tell_the_user.is_some());
        assert!(!p.running() && !p.call_up());
        assert_eq!(
            logged(&log),
            vec!["call_start", "converse", "converse", "call_end"]
        );
    }

    #[test]
    fn a_real_reply_resets_the_silence_count() {
        let log = log_path("reset");
        let mut p = Phone::new(t(1200));
        let r = format!("{SIL}|{SIL}|{SAID}|{SIL}|{SIL}|{SAID}");
        p.call(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            t(5),
            || fake_with(&r, &log),
        )
        .unwrap();
        for _ in 0..5 {
            p.call(
                "converse",
                serde_json::json!({"text": "x"}),
                t(5),
                || panic!(),
            )
            .unwrap();
        }
        assert!(p.call_up(), "S S R S S R never reaches three in a row");
    }

    #[test]
    fn empty_replies_from_ordinary_tools_do_not_count_as_silence() {
        let log = log_path("ordinary");
        let mut p = Phone::new(t(1200));
        // call_start answers with a real reply; then six empty replies from non-caller tools
        p.call(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            t(5),
            || fake_with(&format!("{SAID}||||||"), &log),
        )
        .unwrap();
        for tool in [
            "speak",
            "speak",
            "call_status",
            "get_conversation",
            "speak",
            "call_status",
        ] {
            let r = p.call(tool, serde_json::json!({"text": "x"}), t(5), || panic!());
            assert_eq!(r, Ok(String::new()), "{tool}");
        }
        assert!(p.call_up());
    }

    #[test]
    fn the_turn_cap_ends_the_call_politely() {
        let log = log_path("cap");
        let mut p = Phone::with_limits(t(1200), 3, 3);
        p.call(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            t(5),
            || fake_with(SAID, &log),
        )
        .unwrap();
        p.call(
            "converse",
            serde_json::json!({"text": "1"}),
            t(5),
            || panic!(),
        )
        .unwrap();
        p.call(
            "converse",
            serde_json::json!({"text": "2"}),
            t(5),
            || panic!(),
        )
        .unwrap();
        let e = p
            .call(
                "converse",
                serde_json::json!({"text": "3"}),
                t(5),
                || panic!(),
            )
            .unwrap_err();
        assert!(
            e.tell_the_user.as_deref().unwrap_or("").contains("turn"),
            "{e:?}"
        );
        assert!(!p.running());
        assert_eq!(logged(&log).last().map(String::as_str), Some("call_end"));
    }

    #[test]
    fn call_over_markers_clear_the_call_and_allow_a_new_one() {
        for (marker, tool) in [
            ("[CALL ENDED]", "converse"),
            ("[NO ACTIVE CALL] \u{2014} call call_start first", "listen"),
            ("User replied: \"bye\" then the call ENDED.", "converse"),
        ] {
            let log = log_path("over");
            let mut p = Phone::new(t(1200));
            p.call(
                "call_start",
                serde_json::json!({"opening_line": "hi"}),
                t(5),
                || fake_with(&format!("{SAID}|{marker}"), &log),
            )
            .unwrap();
            assert!(p.call_up());
            let r = p.call(tool, serde_json::json!({"text": "x"}), t(5), || panic!());
            assert!(r.is_ok(), "{marker}");
            assert!(!p.call_up() && !p.running(), "{marker}");
        }
        let log = log_path("noanswer");
        let mut p = Phone::new(t(1200));
        let r = p.call(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            t(5),
            || fake_with("[NO ANSWER] \u{2014} the user did not pick up.", &log),
        );
        assert!(r.unwrap().contains("NO ANSWER"));
        assert!(!p.call_up(), "nobody picked up: there is no call");
        p.call(
            "call_start",
            serde_json::json!({"opening_line": "retry"}),
            t(5),
            || fake_with(SAID, &log),
        )
        .unwrap();
        assert!(p.call_up(), "a new call may start after an unanswered one");
    }

    // ---- overlapping execution --------------------------------------------------
    #[test]
    fn a_second_tool_call_while_one_is_running_is_refused_not_queued() {
        let line = std::sync::Arc::new(PhoneLine::new(t(1200)));
        let a = line.clone();
        let h = std::thread::spawn(move || {
            a.call("call_start", j(), Duration::from_millis(1200), || {
                fake(&["--hang"])
            })
        });
        std::thread::sleep(Duration::from_millis(500));
        let started = std::time::Instant::now();
        let r = line.call("converse", j(), t(5), || panic!("must not start"));
        assert!(
            started.elapsed() < Duration::from_millis(300),
            "refused at once, not after waiting"
        );
        let e = r.result.unwrap_err();
        assert!(e.message.contains("busy"), "{e:?}");
        let first = h.join().unwrap();
        assert!(first.result.is_err(), "the hung call times out on its own");
    }

    #[test]
    fn phone_line_reports_whether_a_call_is_up() {
        let log = log_path("line");
        let line = PhoneLine::new(t(1200));
        assert!(!line.call_up());
        let r = line.call(
            "call_start",
            serde_json::json!({"opening_line": "hi"}),
            t(5),
            || fake_with(SAID, &log),
        );
        assert!(r.result.is_ok() && r.call_up && line.call_up());
        let r = line.call("call_end", j(), t(5), || panic!());
        assert!(r.result.is_ok() && !r.call_up && !line.call_up());
    }

    // ---- readiness per launcher -------------------------------------------------
    #[test]
    fn readiness_depends_on_the_chosen_launcher() {
        let wsl = Ok(Launcher::Wsl(WslLaunch {
            distro: "D".into(),
            cwd: "/c".into(),
            python: "/p".into(),
            script: "run_voice_mcp.py".into(),
        }));
        // WSL: needs wsl.exe, and neither Docker nor the Docker env file
        let r = readiness(&wsl, false, true, false, &["VOICE_SIP_ID"], "e");
        assert!(
            r.ready && r.mode == "wsl" && r.why.is_empty(),
            "{:?}",
            r.why
        );
        let r = readiness(&wsl, true, false, true, &[], "e");
        assert!(!r.ready && r.why.contains("wsl.exe"), "{:?}", r.why);
        // Docker (no launch file): the old rules
        let dk: Result<Launcher, String> = Ok(Launcher::Docker);
        let r = readiness(&dk, false, true, true, &[], "e");
        assert!(!r.ready && r.mode == "docker" && r.why.contains("Docker"));
        let r = readiness(&dk, true, false, true, &[], "e");
        assert!(r.ready && r.mode == "docker");
        // a launch file that is wrong: never ready, and the reason is its own
        let bad: Result<Launcher, String> =
            Err("ringback.launch: \"python\" is missing".to_string());
        let r = readiness(&bad, true, true, true, &[], "e");
        assert!(!r.ready && r.mode == "invalid" && r.why.contains("python"));
    }

    // ---- ringback's own error output travels with the error --------------------
    #[test]
    fn a_tool_error_carries_the_tail_of_ringbacks_stderr_so_the_cause_is_visible() {
        let mut p = Phone::new(t(1200));
        let e = p
            .call("call_start", serde_json::json!({"opening_line": "hi"}), t(5), || {
                fake(&["--stderr", "Traceback (most recent call last):|  File \"voice_agent.py\", line 9, in place_call|pjsua2.Error: (no message)", "--error-on", "call_start"])
            })
            .unwrap_err();
        assert!(
            e.message.contains("Error executing tool call_start"),
            "{e:?}"
        );
        assert!(
            e.message.contains("place_call") && e.message.contains("pjsua2.Error"),
            "{e:?}"
        );
        let tell = e.tell_the_user.unwrap_or_default();
        assert!(
            tell.len() < 200 && !tell.contains("Traceback"),
            "the spoken sentence stays short: {tell:?}"
        );
        assert!(!p.running());
    }

    #[test]
    fn lines_that_may_hold_a_secret_are_hidden_from_that_tail() {
        let mut p = Phone::new(t(1200));
        let e = p
            .call("call_start", serde_json::json!({}), t(5), || {
                fake(&["--stderr", "starting|VOICE_SIP_PASS=hunter2|Authorization: Digest abc|token=xyz|apikey: k|done", "--error-on", "call_start"])
            })
            .unwrap_err();
        for secret in ["hunter2", "Digest abc", "xyz", "apikey: k"] {
            assert!(!e.message.contains(secret), "leaked {secret}: {e:?}");
        }
        assert!(
            e.message.contains("starting") && e.message.contains("done"),
            "{e:?}"
        );
    }

    #[test]
    fn a_process_that_dies_at_start_explains_itself_from_stderr() {
        let mut p = Phone::new(t(1200));
        let e = p
            .call("call_start", serde_json::json!({}), t(5), || {
                fake(&[
                    "--stderr",
                    "ModuleNotFoundError: No module named 'pjsua2'",
                    "--exit-after-init",
                ])
            })
            .unwrap_err();
        assert!(e.message.contains("No module named 'pjsua2'"), "{e:?}");
    }

    #[test]
    fn the_tail_keeps_only_the_last_lines_and_cuts_long_ones() {
        let many: Vec<String> = (0..60).map(|i| format!("line {i}")).collect();
        let mut long = many.join("|");
        long.push_str(&format!("|{}", "x".repeat(900)));
        let mut p = Phone::new(t(1200));
        let e = p
            .call("call_start", serde_json::json!({}), t(5), || {
                fake(&["--stderr", &long, "--error-on", "call_start"])
            })
            .unwrap_err();
        assert!(
            !e.message.contains("line 0|") && !e.message.contains("line 10\n"),
            "{}",
            &e.message[..80.min(e.message.len())]
        );
        assert!(e.message.contains("line 59"), "{e:?}");
        assert!(e.message.len() < 6000, "bounded: {}", e.message.len());
    }
}
