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
/// (speak, listen, a made-up name) is refused before it reaches the server.
pub const ALLOWED_TOOLS: [&str; 5] = [
    "call_start",
    "converse",
    "call_end",
    "call_status",
    "get_conversation",
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

/// One running ringback server. Requests are one JSON object per line; a reader
/// thread forwards stdout lines so every wait can time out.
pub struct McpClient {
    child: Child,
    stdin: Option<ChildStdin>,
    rx: Receiver<String>,
    next_id: u64,
    dead: bool,
}

impl McpClient {
    pub fn start(mut cmd: Command) -> Result<McpClient, String> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start ringback: {e}"))?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().ok_or("ringback has no stdout")?;
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
        };
        c.request(
            "initialize",
            json!({"protocolVersion": "2024-11-05", "capabilities": {},
                   "clientInfo": {"name": "jarvis", "version": "1"}}),
            Duration::from_secs(120),
        )?;
        c.write_line(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))?;
        Ok(c)
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
            "call_end",
            "call_status",
            "get_conversation",
        ] {
            assert!(tool_allowed(ok), "{ok}");
        }
        for bad in ["speak", "listen", "", "call_start; rm"] {
            assert!(!tool_allowed(bad), "{bad:?}");
        }
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
        let mut dead = McpClient::start(fake(&["--exit-after-init"])).expect("start");
        let r = dead.call_tool("call_start", serde_json::json!({}), Duration::from_secs(5));
        assert!(
            r.as_ref().err().map_or(false, |m| m.contains("ended")),
            "{r:?}"
        );
        assert!(!dead.is_alive());
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
}
