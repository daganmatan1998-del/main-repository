/* =====================================================================
   AUTHORIZED PROJECTS (2.37.0)

   The Coding Agent's old workspace (one folder under AppData, see
   workspace_root in main.rs) stays exactly as it was. This adds HIS
   projects: real folders on his disk that he has pointed at himself.

   How a folder becomes reachable: only through project_authorize, which
   opens the Windows folder picker and takes whatever HE clicks. No path
   from a model, a page or a tool call can ever add a folder - the command
   takes no path at all. Drive roots and the system's own folders are
   refused even when picked. project_forget removes one.

   Inside an authorized project:
     - read, list, search, index, find a symbol, see what changed: free;
     - write a file: allowed, and every overwrite first copies the old file
       to a recovery point under AppData (project_restore_file puts it
       back), and a write can carry the version it was based on, so an edit
       made on top of a file someone else changed meanwhile is refused as a
       conflict instead of silently overwriting it;
     - git: status/diff/log/branch/show freely, add/commit only when the
       page says he approved it, and nothing else at all - no push, reset,
       checkout, clean or rebase exists here;
     - commands: only ones DETECTED in the project's own manifests (npm
       scripts, cargo, pytest), run from an argv - never a shell string -
       with a timeout and the output kept. The test/lint/build/check kind
       runs on its own; anything else needs his approval.
   Every action lands in an append-only audit file beside the list.
   ===================================================================== */

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_READ_BYTES: u64 = 400 * 1024;
const MAX_SEARCH_FILE_BYTES: u64 = 1024 * 1024;
const MAX_WALK_FILES: usize = 20_000;
const OUTPUT_TAIL_BYTES: usize = 48 * 1024;
const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist-electron", ".next", ".nuxt", "build", "out", "__pycache__",
    ".venv", "venv", ".idea", ".vs", ".vscode-test", "coverage", ".cache", ".turbo", ".wrangler", "gen",
];

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn jarvis_dir() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir().ok_or("could not find a per-user data directory")?;
    let dir = base.join("jarvis");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

#[derive(Clone)]
struct Project {
    id: String,
    name: String,
    path: PathBuf,
    added_at: u64,
}

fn load_projects() -> Vec<Project> {
    let Ok(dir) = jarvis_dir() else { return vec![] };
    let Ok(text) = std::fs::read_to_string(dir.join("projects.json")) else { return vec![] };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return vec![] };
    v["projects"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    Some(Project {
                        id: p["id"].as_str()?.to_string(),
                        name: p["name"].as_str().unwrap_or("").to_string(),
                        path: PathBuf::from(p["path"].as_str()?),
                        added_at: p["added_at"].as_u64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn save_projects(list: &[Project]) -> Result<(), String> {
    let dir = jarvis_dir()?;
    let v = serde_json::json!({
        "projects": list.iter().map(|p| serde_json::json!({
            "id": p.id, "name": p.name, "path": p.path.display().to_string(), "added_at": p.added_at
        })).collect::<Vec<_>>()
    });
    std::fs::write(dir.join("projects.json"), serde_json::to_string_pretty(&v).unwrap_or_default())
        .map_err(|e| format!("could not save the project list: {e}"))
}

/* Append-only, one JSON object per line. Paths and command names, never
   file contents or command output. */
fn audit(action: &str, project: &str, detail: serde_json::Value, ok: bool) {
    let Ok(dir) = jarvis_dir() else { return };
    let line = serde_json::json!({ "at": now_ms(), "action": action, "project": project, "ok": ok, "detail": detail });
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("audit.log")) {
        use std::io::Write;
        let _ = writeln!(f, "{line}");
    }
}

fn project_by_id(id: &str) -> Result<Project, String> {
    let id = id.trim();
    let list = load_projects();
    list.iter()
        .find(|p| p.id == id)
        .or_else(|| list.iter().find(|p| p.name.eq_ignore_ascii_case(id)))
        .cloned()
        .ok_or_else(|| {
            let known: Vec<String> = list.iter().map(|p| p.id.clone()).collect();
            if known.is_empty() {
                "no project is authorized yet - he adds one with the Projects button (a folder picker)".to_string()
            } else {
                format!("no authorized project \"{id}\". Authorized: {}", known.join(", "))
            }
        })
}

fn project_root(p: &Project) -> Result<PathBuf, String> {
    p.path
        .canonicalize()
        .map_err(|e| format!("the folder of project \"{}\" is not reachable any more: {e}", p.id))
}

/* Same rule as resolve_in_workspace in main.rs: join, then canonicalise the
   nearest existing ancestor and require it to sit inside the root, which is
   what catches `..` and symlink escapes. */
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim();
    let candidate = if rel.is_empty() || rel == "." { root.to_path_buf() } else { root.join(rel.trim_start_matches(['/', '\\'])) };
    let mut check = candidate.clone();
    while !check.exists() {
        match check.parent() {
            Some(p) if p != check => check = p.to_path_buf(),
            _ => break,
        }
    }
    let resolved = check.canonicalize().map_err(|e| format!("could not resolve \"{rel}\": {e}"))?;
    if !resolved.starts_with(root) {
        return Err(format!("\"{rel}\" is outside the project - refused"));
    }
    if candidate.components().any(|c| c.as_os_str().eq_ignore_ascii_case(".git")) {
        return Err("the .git folder is not touched directly - use project_git".into());
    }
    Ok(candidate)
}

fn rel_of(root: &Path, full: &Path) -> String {
    full.strip_prefix(root).unwrap_or(full).to_string_lossy().replace('\\', "/")
}

/* A cheap content fingerprint: enough to notice that a file changed
   between a read and a write. Not a security hash. */
fn version_of(bytes: &[u8]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{:x}-{}", h.finish(), bytes.len())
}

fn walk(root: &Path, mut each: impl FnMut(&Path, &std::fs::Metadata) -> bool) -> usize {
    let mut stack = vec![root.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let path = entry.path();
            if ft.is_dir() {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(path);
                }
                continue;
            }
            let Ok(md) = entry.metadata() else { continue };
            seen += 1;
            if seen > MAX_WALK_FILES || !each(&path, &md) {
                return seen;
            }
        }
    }
    seen
}

fn is_refused_folder(p: &Path) -> Option<&'static str> {
    if p.parent().is_none() {
        return Some("a whole drive cannot be a project - pick the project's own folder");
    }
    let s = p.to_string_lossy().to_lowercase().replace('/', "\\");
    let s = s.trim_start_matches("\\\\?\\");
    for bad in ["\\windows", "\\program files", "\\program files (x86)", "\\programdata"] {
        if s.len() >= 2 && (s[2..] == *bad || s[2..].starts_with(&format!("{bad}\\"))) {
            return Some("system folders cannot be projects");
        }
    }
    if let Some(home) = dirs_next::home_dir().and_then(|h| h.canonicalize().ok()) {
        if p == home {
            return Some("the whole user folder cannot be a project - pick the project's own folder");
        }
    }
    None
}

fn project_json(p: &Project) -> serde_json::Value {
    let git = p.path.join(".git").exists();
    serde_json::json!({ "id": p.id, "name": p.name, "path": p.path.display().to_string(), "git": git, "added_at": p.added_at })
}

#[tauri::command]
pub fn projects_list() -> serde_json::Value {
    serde_json::json!({ "projects": load_projects().iter().map(project_json).collect::<Vec<_>>() })
}

/* The one way in. Takes no path: he clicks the folder. */
#[tauri::command]
pub async fn project_authorize() -> Result<serde_json::Value, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new().set_title("JARVIS - choose a project folder to authorize").pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(folder) = picked else {
        return Ok(serde_json::json!({ "ok": false, "code": "cancelled" }));
    };
    let folder = folder.canonicalize().map_err(|e| format!("could not resolve the folder: {e}"))?;
    /* Windows canonical paths start \\?\; stored and shown without it. */
    let folder = match folder.to_str().and_then(|s| s.strip_prefix("\\\\?\\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => folder,
    };
    if let Some(why) = is_refused_folder(&folder) {
        audit("authorize", "", serde_json::json!({ "path": folder.display().to_string(), "refused": why }), false);
        return Ok(serde_json::json!({ "ok": false, "code": "refused", "why": why }));
    }
    let mut list = load_projects();
    if let Some(p) = list.iter().find(|p| p.path == folder) {
        return Ok(serde_json::json!({ "ok": true, "already": true, "project": project_json(p) }));
    }
    let name = folder.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project".into());
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let base = if base.is_empty() { "project".to_string() } else { base };
    let mut id = base.clone();
    let mut n = 2;
    while list.iter().any(|p| p.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    let p = Project { id, name, path: folder, added_at: now_ms() };
    list.push(p.clone());
    save_projects(&list)?;
    audit("authorize", &p.id, serde_json::json!({ "path": p.path.display().to_string() }), true);
    Ok(serde_json::json!({ "ok": true, "project": project_json(&p) }))
}

#[tauri::command]
pub fn project_forget(id: String) -> Result<serde_json::Value, String> {
    let mut list = load_projects();
    let before = list.len();
    list.retain(|p| p.id != id);
    if list.len() == before {
        return Err(format!("no authorized project \"{id}\""));
    }
    save_projects(&list)?;
    audit("forget", &id, serde_json::json!({}), true);
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
pub fn project_list_dir(project: String, path: Option<String>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let rel = path.unwrap_or_default();
    let full = resolve(&root, &rel)?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&full).map_err(|e| format!("could not list \"{rel}\": {e}"))?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let md = entry.metadata().ok();
        let dir = md.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        entries.push(serde_json::json!({ "name": name, "dir": dir, "bytes": if dir { None } else { md.map(|m| m.len()) } }));
        if entries.len() >= 500 {
            break;
        }
    }
    entries.sort_by(|a, b| (!a["dir"].as_bool().unwrap_or(false), a["name"].as_str().unwrap_or("")).cmp(&(!b["dir"].as_bool().unwrap_or(false), b["name"].as_str().unwrap_or(""))));
    Ok(serde_json::json!({ "project": p.id, "path": rel, "entries": entries }))
}

#[tauri::command]
pub fn project_read_file(project: String, path: String, start_line: Option<u32>, max_lines: Option<u32>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let full = resolve(&root, &path)?;
    let md = std::fs::metadata(&full).map_err(|e| format!("could not read \"{path}\": {e}"))?;
    if md.is_dir() {
        return Err(format!("\"{path}\" is a folder - use project_list_dir"));
    }
    if md.len() > MAX_READ_BYTES * 8 {
        return Err(format!("\"{path}\" is {} bytes - too big to read whole; search it with project_search", md.len()));
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("could not read \"{path}\": {e}"))?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Err(format!("\"{path}\" is a binary file"));
    }
    let version = version_of(&bytes);
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let start = start_line.unwrap_or(1).max(1) as usize;
    let want = max_lines.unwrap_or(400).clamp(1, 2000) as usize;
    let end = (start - 1 + want).min(lines.len());
    let mut out = String::new();
    for (i, l) in lines.iter().enumerate().take(end).skip(start - 1) {
        out.push_str(&format!("{:>5}| {}\n", i + 1, l));
        if out.len() as u64 > MAX_READ_BYTES {
            break;
        }
    }
    audit("read", &p.id, serde_json::json!({ "path": path }), true);
    Ok(serde_json::json!({
        "project": p.id, "path": rel_of(&root, &full), "version": version, "total_lines": lines.len(),
        "from_line": start, "to_line": end, "truncated": end < lines.len(), "content": out
    }))
}

/* Exact, case-insensitive text search across the project, skipping
   dependency and build folders, binaries and very large files. */
#[tauri::command]
pub async fn project_search(project: String, query: String, ext: Option<String>, max_results: Option<u32>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let q = query.trim().to_lowercase();
    if q.chars().count() < 2 {
        return Err("search for at least two characters".into());
    }
    let exts: Vec<String> = ext
        .unwrap_or_default()
        .split(',')
        .map(|e| e.trim().trim_start_matches('.').to_lowercase())
        .filter(|e| !e.is_empty())
        .collect();
    let cap = max_results.unwrap_or(60).clamp(1, 300) as usize;
    let id = p.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut hits = Vec::new();
        let mut files_hit = 0usize;
        let scanned = walk(&root, |path, md| {
            if md.len() > MAX_SEARCH_FILE_BYTES {
                return true;
            }
            if !exts.is_empty() {
                let e = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if !exts.contains(&e) {
                    return true;
                }
            }
            let Ok(bytes) = std::fs::read(path) else { return true };
            if bytes.iter().take(8000).any(|b| *b == 0) {
                return true;
            }
            let text = String::from_utf8_lossy(&bytes);
            let mut any = false;
            for (i, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&q) {
                    any = true;
                    let shown: String = line.trim().chars().take(220).collect();
                    hits.push(serde_json::json!({ "file": rel_of(&root, path), "line": i + 1, "text": shown }));
                    if hits.len() >= cap {
                        return false;
                    }
                }
            }
            if any {
                files_hit += 1;
            }
            true
        });
        audit("search", &id, serde_json::json!({ "query": query }), true);
        Ok(serde_json::json!({ "project": id, "query": query, "matches": hits, "files_with_matches": files_hit, "files_scanned": scanned, "capped": hits.len() >= cap }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ---------- the index: languages, manifests, entry points, symbols ---------- */

const CODE_EXTS: &[(&str, &str)] = &[
    ("rs", "Rust"), ("js", "JavaScript"), ("mjs", "JavaScript"), ("cjs", "JavaScript"), ("jsx", "JavaScript"),
    ("ts", "TypeScript"), ("tsx", "TypeScript"), ("py", "Python"), ("go", "Go"), ("java", "Java"), ("kt", "Kotlin"),
    ("cs", "C#"), ("cpp", "C++"), ("cc", "C++"), ("c", "C"), ("h", "C/C++ header"), ("hpp", "C++"), ("swift", "Swift"),
    ("rb", "Ruby"), ("php", "PHP"), ("html", "HTML"), ("htm", "HTML"), ("css", "CSS"), ("scss", "SCSS"), ("vue", "Vue"),
    ("svelte", "Svelte"), ("json", "JSON"), ("toml", "TOML"), ("yaml", "YAML"), ("yml", "YAML"), ("md", "Markdown"),
    ("sql", "SQL"), ("sh", "Shell"), ("ps1", "PowerShell"), ("bat", "Batch"), ("cmd", "Batch"), ("liquid", "Liquid"),
];
const MANIFESTS: &[&str] = &[
    "package.json", "Cargo.toml", "pyproject.toml", "requirements.txt", "setup.py", "go.mod", "pom.xml",
    "build.gradle", "composer.json", "Gemfile", "wrangler.toml", "tauri.conf.json", "Dockerfile",
    "docker-compose.yml", "vite.config.js", "vite.config.ts", "next.config.js", "tsconfig.json", "shopify.theme.toml",
];
const ENTRY_NAMES: &[&str] = &[
    "main.rs", "lib.rs", "main.py", "app.py", "__main__.py", "index.js", "index.ts", "index.html", "main.js", "main.ts",
    "server.js", "app.js", "main.go", "Program.cs", "worker.js",
];

/* path -> (mtime, symbols): files whose mtime did not change are not
   re-read, so a second index of the same project is mostly free. */
static SYMBOL_CACHE: Mutex<Option<HashMap<PathBuf, (u64, Vec<(String, usize)>)>>> = Mutex::new(None);

fn symbols_in(text: &str, ext: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let ident = |s: &str| -> String { s.chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$').collect() };
    for (i, raw) in text.lines().enumerate() {
        let l = raw.trim_start();
        let found: Option<String> = match ext {
            "rs" => ["pub async fn ", "async fn ", "pub fn ", "fn ", "pub struct ", "struct ", "pub enum ", "enum ", "pub trait ", "trait ", "impl "]
                .iter()
                .find(|k| l.starts_with(*k))
                .map(|k| ident(&l[k.len()..])),
            "py" => ["async def ", "def ", "class "].iter().find(|k| l.starts_with(*k)).map(|k| ident(&l[k.len()..])),
            "js" | "mjs" | "cjs" | "jsx" | "ts" | "tsx" | "html" | "vue" | "svelte" => {
                let l2 = l.trim_start_matches("export ").trim_start_matches("default ");
                if let Some(rest) = l2.strip_prefix("async function ").or_else(|| l2.strip_prefix("function ")) {
                    Some(ident(rest.trim_start_matches('*').trim_start()))
                } else if let Some(rest) = l2.strip_prefix("class ") {
                    Some(ident(rest))
                } else if let Some(rest) = l2.strip_prefix("const ").or_else(|| l2.strip_prefix("let ")) {
                    let name = ident(rest);
                    let after = rest[name.len()..].trim_start();
                    if after.starts_with('=') && (after.contains("=>") || after.contains("function") || after.contains('{')) && name.len() > 2 {
                        Some(name)
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            "go" => l.strip_prefix("func ").map(|r| ident(r.trim_start_matches(|c| c == '(' ).split(')').last().unwrap_or(r).trim())),
            "cs" | "java" | "kt" => {
                if l.contains(" class ") || l.starts_with("class ") {
                    l.split("class ").nth(1).map(ident)
                } else {
                    None
                }
            }
            _ => None,
        };
        if let Some(name) = found {
            if name.len() >= 2 {
                out.push((name, i + 1));
            }
        }
        if out.len() >= 400 {
            break;
        }
    }
    out
}

fn mtime_ms(md: &std::fs::Metadata) -> u64 {
    md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn index_project(root: &Path) -> serde_json::Value {
    let mut langs: HashMap<&'static str, (usize, u64)> = HashMap::new();
    let mut manifests = Vec::new();
    let mut entries = Vec::new();
    let mut files = 0usize;
    let mut bytes_total = 0u64;
    let mut symbols: Vec<serde_json::Value> = Vec::new();
    let mut symbol_count = 0usize;
    let mut guard = SYMBOL_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let cache = guard.get_or_insert_with(HashMap::new);
    walk(root, |path, md| {
        files += 1;
        bytes_total += md.len();
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let rel = rel_of(root, path);
        let depth = rel.matches('/').count();
        if MANIFESTS.contains(&name.as_str()) && depth <= 2 {
            manifests.push(rel.clone());
        }
        if ENTRY_NAMES.contains(&name.as_str()) && depth <= 3 {
            entries.push(rel.clone());
        }
        let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
        if let Some((_, lang)) = CODE_EXTS.iter().find(|(e, _)| *e == ext) {
            let slot = langs.entry(lang).or_insert((0, 0));
            slot.0 += 1;
            slot.1 += md.len();
            if md.len() <= 2 * 1024 * 1024 && !matches!(ext.as_str(), "json" | "toml" | "yaml" | "yml" | "md" | "css" | "scss" | "sql") {
                let mt = mtime_ms(md);
                let syms = match cache.get(path) {
                    Some((t, s)) if *t == mt => s.clone(),
                    _ => {
                        let s = std::fs::read(path).map(|b| symbols_in(&String::from_utf8_lossy(&b), &ext)).unwrap_or_default();
                        cache.insert(path.to_path_buf(), (mt, s.clone()));
                        s
                    }
                };
                symbol_count += syms.len();
                if !syms.is_empty() && symbols.len() < 120 {
                    let names: Vec<String> = syms.iter().take(40).map(|(n, l)| format!("{n}:{l}")).collect();
                    symbols.push(serde_json::json!({ "file": rel, "symbols": names, "more": syms.len().saturating_sub(40) }));
                }
            }
        }
        true
    });
    let mut lang_list: Vec<_> = langs.into_iter().collect();
    lang_list.sort_by(|a, b| b.1 .1.cmp(&a.1 .1));
    let top: Vec<String> = std::fs::read_dir(root)
        .map(|rd| {
            rd.flatten()
                .map(|e| {
                    let n = e.file_name().to_string_lossy().into_owned();
                    if e.file_type().map(|t| t.is_dir()).unwrap_or(false) { format!("{n}/") } else { n }
                })
                .filter(|n| n != ".git/")
                .take(80)
                .collect()
        })
        .unwrap_or_default();
    serde_json::json!({
        "files": files, "bytes": bytes_total,
        "languages": lang_list.iter().map(|(l, (n, b))| serde_json::json!({ "language": l, "files": n, "bytes": b })).collect::<Vec<_>>(),
        "manifests": manifests, "entry_points": entries, "top_level": top,
        "symbols_total": symbol_count, "symbols_by_file": symbols,
        "skipped_dirs": SKIP_DIRS
    })
}

#[tauri::command]
pub async fn project_index(project: String) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let id = p.id.clone();
    let mut v = tauri::async_runtime::spawn_blocking(move || index_project(&root)).await.map_err(|e| e.to_string())?;
    if let Some(o) = v.as_object_mut() {
        o.insert("project".into(), serde_json::Value::String(id.clone()));
        o.insert("git".into(), serde_json::Value::Bool(p.path.join(".git").exists()));
        o.insert("commands".into(), detect_commands(&p.path).into_iter().map(|c| c.to_json()).collect());
    }
    audit("index", &id, serde_json::json!({}), true);
    Ok(v)
}

#[tauri::command]
pub async fn project_find_symbol(project: String, name: String) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let want = name.trim().to_string();
    if want.len() < 2 {
        return Err("give a symbol name".into());
    }
    let id = p.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = index_project(&root); // fills/refreshes the cache
        let guard = SYMBOL_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let mut defs = Vec::new();
        if let Some(cache) = guard.as_ref() {
            for (path, (_, syms)) in cache.iter() {
                if !path.starts_with(&root) {
                    continue;
                }
                for (n, line) in syms {
                    if n == &want || n.eq_ignore_ascii_case(&want) {
                        defs.push(serde_json::json!({ "file": rel_of(&root, path), "line": line, "name": n }));
                    }
                }
            }
        }
        Ok(serde_json::json!({ "project": id, "symbol": want, "definitions": defs }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/* Files changed after a moment: what to re-read after an edit, a build or
   a git operation, rather than trusting an older summary. */
#[tauri::command]
pub async fn project_changes(project: String, since_ms: Option<u64>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let since = since_ms.unwrap_or_else(|| now_ms().saturating_sub(24 * 3600 * 1000));
    let id = p.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut changed: Vec<(u64, String)> = Vec::new();
        walk(&root, |path, md| {
            let t = mtime_ms(md);
            if t >= since {
                changed.push((t, rel_of(&root, path)));
            }
            true
        });
        changed.sort_by(|a, b| b.0.cmp(&a.0));
        let total = changed.len();
        Ok(serde_json::json!({
            "project": id, "since": since, "count": total,
            "files": changed.into_iter().take(100).map(|(t, f)| serde_json::json!({ "file": f, "modified": t })).collect::<Vec<_>>()
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn backups_dir(project: &str) -> Result<PathBuf, String> {
    let d = jarvis_dir()?.join("backups").join(project);
    std::fs::create_dir_all(&d).map_err(|e| format!("could not create the recovery folder: {e}"))?;
    Ok(d)
}

#[tauri::command]
pub fn project_write_file(project: String, path: String, content: String, expect_version: Option<String>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let full = resolve(&root, &path)?;
    if content.len() > 4 * 1024 * 1024 {
        return Err("that content is over 4 MB - refused".into());
    }
    let existed = full.exists();
    let mut backup: Option<String> = None;
    if existed {
        if full.is_dir() {
            return Err(format!("\"{path}\" is a folder"));
        }
        let old = std::fs::read(&full).map_err(|e| format!("could not read \"{path}\" before writing: {e}"))?;
        let current = version_of(&old);
        if let Some(want) = expect_version.as_deref().filter(|v| !v.is_empty()) {
            if want != current {
                audit("write", &p.id, serde_json::json!({ "path": path, "conflict": true }), false);
                return Ok(serde_json::json!({
                    "ok": false, "code": "conflict", "path": path, "current_version": current,
                    "why": "the file changed since it was read (another step, or him) - read it again and redo the edit on the current text"
                }));
            }
        }
        let stamp = now_ms();
        let dest = backups_dir(&p.id)?.join(stamp.to_string()).join(rel_of(&root, &full));
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("could not create the recovery point: {e}"))?;
        }
        std::fs::write(&dest, &old).map_err(|e| format!("could not create the recovery point: {e}"))?;
        backup = Some(stamp.to_string());
    } else if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create the folder for \"{path}\": {e}"))?;
    }
    std::fs::write(&full, content.as_bytes()).map_err(|e| format!("could not write \"{path}\": {e}"))?;
    /* Verified, not assumed: read it back. */
    let back = std::fs::read(&full).map_err(|e| format!("wrote \"{path}\" but could not read it back: {e}"))?;
    let ok = back == content.as_bytes();
    audit("write", &p.id, serde_json::json!({ "path": path, "bytes": content.len(), "created": !existed, "backup": backup }), ok);
    Ok(serde_json::json!({
        "ok": ok, "path": rel_of(&root, &full), "bytes": content.len(), "created": !existed,
        "version": version_of(&back), "recovery_point": backup, "verified": ok
    }))
}

/* Puts back the newest recovery copy of one file (or the one at `point`). */
#[tauri::command]
pub fn project_restore_file(project: String, path: String, point: Option<String>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let full = resolve(&root, &path)?;
    let rel = rel_of(&root, &full);
    let dir = backups_dir(&p.id)?;
    let mut points: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| dir.join(n).join(&rel).is_file())
        .collect();
    points.sort();
    let chosen = match point {
        Some(pt) if points.contains(&pt) => pt,
        Some(pt) => return Err(format!("no recovery point {pt} for \"{rel}\"")),
        None => points.last().cloned().ok_or_else(|| format!("there is no recovery point for \"{rel}\""))?,
    };
    let data = std::fs::read(dir.join(&chosen).join(&rel)).map_err(|e| e.to_string())?;
    std::fs::write(&full, &data).map_err(|e| format!("could not restore \"{rel}\": {e}"))?;
    audit("restore", &p.id, serde_json::json!({ "path": rel, "point": chosen }), true);
    Ok(serde_json::json!({ "ok": true, "path": rel, "restored_from": chosen, "version": version_of(&data), "other_points": points }))
}

/* ---------- git ---------- */

const GIT_READ: &[&str] = &["status", "diff", "log", "branch", "show", "rev-parse", "shortlog", "blame"];
const GIT_WRITE: &[&str] = &["add", "commit"];

#[tauri::command]
pub fn project_git(project: String, action: String, args: Option<Vec<String>>, approved: Option<bool>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let action = action.trim().to_lowercase();
    let args = args.unwrap_or_default();
    let write = GIT_WRITE.contains(&action.as_str());
    if !write && !GIT_READ.contains(&action.as_str()) {
        return Err(format!("git {action} is not available here. Read: {}. With his approval: {}. Push, reset, checkout, clean, rebase and the rest are never run by JARVIS.", GIT_READ.join(", "), GIT_WRITE.join(", ")));
    }
    if write && approved != Some(true) {
        return Ok(serde_json::json!({ "ok": false, "code": "needs_approval", "action": action }));
    }
    if action == "branch" && args.iter().any(|a| !a.starts_with('-') || matches!(a.as_str(), "-d" | "-D" | "-m" | "-M" | "--delete" | "--move" | "-c" | "-C" | "--copy")) {
        return Err("branch here only lists branches".into());
    }
    for a in &args {
        let al = a.to_lowercase();
        if al.starts_with("--output") || al.starts_with("--exec") || al.starts_with("--upload-pack") || al.starts_with("--receive-pack") || al == "-o" || al.starts_with("--open-files-in-pager") || al.starts_with("--ext-diff") {
            return Err(format!("the git option {a} is not allowed here"));
        }
    }
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&root).arg("--no-pager").arg(&action).args(&args)
        .env("GIT_TERMINAL_PROMPT", "0").env("GIT_PAGER", "cat");
    hide_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("could not run git: {e} - is it installed and on PATH?"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    audit("git", &p.id, serde_json::json!({ "action": action, "args": args }), out.status.success());
    Ok(serde_json::json!({
        "ok": out.status.success(), "action": action,
        "output": tail(&stdout, OUTPUT_TAIL_BYTES), "error": if out.status.success() { None } else { Some(tail(&stderr, 8000)) }
    }))
}

/* ---------- commands: only what the project itself declares ---------- */

struct DetectedCommand {
    id: String,
    program: String,
    args: Vec<String>,
    cwd: String,
    kind: &'static str, // "check" runs on its own; "other" needs approval
    label: String,
}
impl DetectedCommand {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({ "id": self.id, "label": self.label, "dir": self.cwd, "kind": self.kind,
                            "needs_approval": self.kind != "check" })
    }
}

fn check_kind(name: &str) -> &'static str {
    let n = name.to_lowercase();
    let safe = ["test", "tests", "lint", "check", "typecheck", "type-check", "tsc", "build", "format:check", "fmt:check", "verify", "validate"];
    if safe.iter().any(|s| n == *s || n.starts_with(&format!("{s}:")) || n.ends_with(&format!(":{s}"))) {
        "check"
    } else {
        "other"
    }
}

fn detect_commands(root: &Path) -> Vec<DetectedCommand> {
    let mut out = Vec::new();
    let mut dirs = vec![(root.to_path_buf(), String::new())];
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) && !n.starts_with('.') && !SKIP_DIRS.contains(&n.to_lowercase().as_str()) {
                dirs.push((e.path(), n));
            }
        }
    }
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    for (dir, sub) in dirs {
        if let Ok(text) = std::fs::read_to_string(dir.join("package.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(scripts) = v["scripts"].as_object() {
                    for (name, body) in scripts.iter().take(40) {
                        if !name.chars().all(|c| c.is_ascii_alphanumeric() || ":-_.".contains(c)) {
                            continue;
                        }
                        out.push(DetectedCommand {
                            id: format!("npm:{}{}", if sub.is_empty() { String::new() } else { format!("{sub}/") }, name),
                            program: npm.into(), args: vec!["run".into(), name.clone()], cwd: sub.clone(),
                            kind: check_kind(name),
                            label: format!("npm run {name}  ({})", body.as_str().unwrap_or("").chars().take(80).collect::<String>()),
                        });
                    }
                }
            }
        }
        let cargo_dir = if dir.join("Cargo.toml").is_file() { Some((dir.clone(), sub.clone())) } else if dir.join("src-tauri").join("Cargo.toml").is_file() {
            Some((dir.join("src-tauri"), if sub.is_empty() { "src-tauri".into() } else { format!("{sub}/src-tauri") }))
        } else { None };
        if let Some((_, csub)) = cargo_dir {
            for (name, args, kind) in [
                ("check", vec!["check"], "check"), ("test", vec!["test"], "check"), ("build", vec!["build"], "check"),
                ("clippy", vec!["clippy"], "check"), ("fmt-check", vec!["fmt", "--check"], "check"),
            ] {
                let id = format!("cargo:{}{}", if csub.is_empty() { String::new() } else { format!("{csub}/") }, name);
                if out.iter().any(|c| c.id == id) { continue; }
                out.push(DetectedCommand { id, program: "cargo".into(), args: args.iter().map(|s| s.to_string()).collect(), cwd: csub.clone(), kind, label: format!("cargo {}", args.join(" ")) });
            }
        }
        if dir.join("pyproject.toml").is_file() || dir.join("pytest.ini").is_file() || dir.join("tests").is_dir() && dir.join("requirements.txt").is_file() {
            let py = if cfg!(windows) { "python" } else { "python3" };
            out.push(DetectedCommand { id: format!("pytest:{sub}"), program: py.into(), args: vec!["-m".into(), "pytest".into(), "-q".into()], cwd: sub.clone(), kind: "check", label: "python -m pytest -q".into() });
        }
    }
    out
}

#[tauri::command]
pub fn project_commands(project: String) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    Ok(serde_json::json!({ "project": p.id, "commands": detect_commands(&root).iter().map(|c| c.to_json()).collect::<Vec<_>>() }))
}

static RUNNING: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn hide_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // its own group, so a timeout can stop the whole tree
    }
}

fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut start = s.len() - max;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    format!("...(earlier output cut)...\n{}", &s[start..])
}

fn kill_tree(pid: u32) {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c
    } else {
        let mut c = std::process::Command::new("kill");
        c.args(["-9", &format!("-{pid}")]);
        c
    };
    hide_window(&mut cmd);
    let _ = cmd.output();
}

#[tauri::command]
pub async fn project_run(project: String, command: String, approved: Option<bool>, timeout_secs: Option<u64>, run_id: Option<String>) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let cmds = detect_commands(&root);
    let Some(c) = cmds.into_iter().find(|c| c.id == command.trim()) else {
        return Err(format!("\"{command}\" is not one of this project's own commands - list them with project_commands"));
    };
    if c.kind != "check" && approved != Some(true) {
        return Ok(serde_json::json!({ "ok": false, "code": "needs_approval", "command": c.id, "label": c.label }));
    }
    let cwd = if c.cwd.is_empty() { root.clone() } else { resolve(&root, &c.cwd)? };
    let limit = Duration::from_secs(timeout_secs.unwrap_or(300).clamp(5, 1800));
    let run_id = run_id.unwrap_or_else(|| format!("r{}", now_ms()));
    let id = p.id.clone();
    let label = c.label.clone();
    let cid = c.id.clone();
    let res = tauri::async_runtime::spawn_blocking(move || -> Result<serde_json::Value, String> {
        let mut cmd = std::process::Command::new(&c.program);
        cmd.args(&c.args).current_dir(&cwd)
            .env("CI", "1").env("FORCE_COLOR", "0").env("NO_COLOR", "1").env("GIT_TERMINAL_PROMPT", "0")
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
        hide_window(&mut cmd);
        let started = Instant::now();
        let mut child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", c.program))?;
        RUNNING.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(run_id.clone(), child.id());
        /* Output is collected as it arrives, so whatever was printed is kept
           even when something left behind still holds the pipe open after a
           timeout: the wait for it below is bounded. */
        let collect = |src: Option<Box<dyn Read + Send>>| {
            let buf = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
            let b2 = buf.clone();
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            std::thread::spawn(move || {
                if let Some(mut s) = src {
                    let mut chunk = [0u8; 8192];
                    while let Ok(n) = s.read(&mut chunk) {
                        if n == 0 { break; }
                        let mut b = b2.lock().unwrap_or_else(|e| e.into_inner());
                        b.extend_from_slice(&chunk[..n]);
                        if b.len() > 4 * OUTPUT_TAIL_BYTES { let cut = b.len() - 2 * OUTPUT_TAIL_BYTES; b.drain(..cut); }
                    }
                }
                let _ = tx.send(());
            });
            (buf, rx)
        };
        let (out_buf, out_done) = collect(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
        let (err_buf, err_done) = collect(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
        let mut timed_out = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(st)) => break Some(st),
                Ok(None) => {
                    if started.elapsed() > limit {
                        timed_out = true;
                        kill_tree(child.id());
                        let _ = child.kill();
                        break child.wait().ok();
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(_) => break None,
            }
        };
        let cancelled = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|m| m.remove(&run_id)).is_none();
        let _ = out_done.recv_timeout(Duration::from_secs(3));
        let _ = err_done.recv_timeout(Duration::from_secs(1));
        let out = String::from_utf8_lossy(&out_buf.lock().unwrap_or_else(|e| e.into_inner())).into_owned();
        let err = String::from_utf8_lossy(&err_buf.lock().unwrap_or_else(|e| e.into_inner())).into_owned();
        let code = status.and_then(|s| s.code());
        Ok(serde_json::json!({
            "ok": code == Some(0) && !timed_out && !cancelled, "command": c.id, "label": c.label,
            "exit_code": code, "timed_out": timed_out, "cancelled": cancelled,
            "ms": started.elapsed().as_millis() as u64,
            "stdout": tail(&out, OUTPUT_TAIL_BYTES), "stderr": tail(&err, OUTPUT_TAIL_BYTES / 2)
        }))
    })
    .await
    .map_err(|e| e.to_string())??;
    audit("run", &id, serde_json::json!({ "command": cid, "label": label, "exit_code": res["exit_code"], "timed_out": res["timed_out"] }), res["ok"] == true);
    Ok(res)
}

/* Stops a command started with that run_id (the page's cancel button). */
#[tauri::command]
pub fn project_run_cancel(run_id: String) -> serde_json::Value {
    let pid = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|m| m.remove(&run_id));
    if let Some(pid) = pid {
        kill_tree(pid);
        serde_json::json!({ "ok": true, "stopped": run_id })
    } else {
        serde_json::json!({ "ok": false, "code": "not_running" })
    }
}

/* "Open VS Code and load my Jarvis project": the folder itself handed to
   the program, by argv. Only these programs, only an authorized folder. */
#[tauri::command]
pub fn project_open_in(project: String, app: String) -> Result<serde_json::Value, String> {
    let p = project_by_id(&project)?;
    let root = project_root(&p)?;
    let shown = root.display().to_string();
    let shown = shown.trim_start_matches("\\\\?\\").to_string();
    let which = app.trim().to_lowercase();
    let mut tries: Vec<(String, Vec<String>)> = Vec::new();
    match which.as_str() {
        "vscode" | "vs code" | "code" | "visual studio code" => {
            if let Some(local) = dirs_next::data_local_dir() {
                tries.push((local.join("Programs").join("Microsoft VS Code").join("Code.exe").display().to_string(), vec![shown.clone()]));
            }
            tries.push(("C:\\Program Files\\Microsoft VS Code\\Code.exe".into(), vec![shown.clone()]));
            tries.push((if cfg!(windows) { "code.cmd".into() } else { "code".into() }, vec![shown.clone()]));
        }
        "cursor" => {
            if let Some(local) = dirs_next::data_local_dir() {
                tries.push((local.join("Programs").join("cursor").join("Cursor.exe").display().to_string(), vec![shown.clone()]));
            }
        }
        "explorer" | "folder" | "file explorer" => tries.push(("explorer.exe".into(), vec![shown.clone()])),
        _ => return Err(format!("\"{app}\" is not a program a project can be opened in here - vscode, cursor or explorer")),
    }
    for (prog, args) in tries {
        if prog.contains('\\') && !Path::new(&prog).is_file() {
            continue;
        }
        let mut cmd = std::process::Command::new(&prog);
        cmd.args(&args);
        if cmd.spawn().is_ok() {
            audit("open_in", &p.id, serde_json::json!({ "app": which }), true);
            return Ok(serde_json::json!({ "ok": true, "app": which, "path": shown }));
        }
    }
    audit("open_in", &p.id, serde_json::json!({ "app": which }), false);
    Ok(serde_json::json!({ "ok": false, "code": "not_installed", "app": which }))
}

/* The audit trail, newest first. */
#[tauri::command]
pub fn project_audit(limit: Option<u32>) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(jarvis_dir()?.join("audit.log")).unwrap_or_default();
    let n = limit.unwrap_or(50).clamp(1, 500) as usize;
    let rows: Vec<serde_json::Value> = text.lines().rev().take(n).filter_map(|l| serde_json::from_str(l).ok()).collect();
    Ok(serde_json::json!({ "entries": rows }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbols_found() {
        let js = "async function runTask(x){}\nconst planSteps = (a) => a;\nexport class Engine {}\nlet n = 3;";
        let s: Vec<String> = symbols_in(js, "js").into_iter().map(|(n, _)| n).collect();
        assert_eq!(s, vec!["runTask", "planSteps", "Engine"]);
        let rs = "pub async fn project_run() {}\nstruct Ab;\nimpl Foo for Ab {}";
        let s: Vec<String> = symbols_in(rs, "rs").into_iter().map(|(n, _)| n).collect();
        assert_eq!(s, vec!["project_run", "Ab", "Foo"]);
        let py = "class Xy:\n    def go(self):\n        pass";
        let s: Vec<String> = symbols_in(py, "py").into_iter().map(|(n, _)| n).collect();
        assert_eq!(s, vec!["Xy", "go"]);
    }

    #[test]
    fn resolve_refuses_escape() {
        let tmp = std::env::temp_dir().join(format!("jarvis-proj-{}", now_ms()));
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        let root = tmp.canonicalize().unwrap();
        assert!(resolve(&root, "src/a.js").is_ok());
        assert!(resolve(&root, "new/dir/b.js").is_ok());
        assert!(resolve(&root, "../outside.txt").is_err());
        assert!(resolve(&root, ".git/config").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn kinds() {
        assert_eq!(check_kind("test"), "check");
        assert_eq!(check_kind("test:unit"), "check");
        assert_eq!(check_kind("build"), "check");
        assert_eq!(check_kind("deploy"), "other");
        assert_eq!(check_kind("publish"), "other");
        assert_eq!(check_kind("start"), "other");
    }

    #[test]
    fn detects_npm_and_cargo() {
        let tmp = std::env::temp_dir().join(format!("jarvis-cmd-{}", now_ms()));
        std::fs::create_dir_all(tmp.join("app/src-tauri")).unwrap();
        std::fs::write(tmp.join("package.json"), r#"{"scripts":{"test":"node t.js","deploy":"wrangler deploy","bad name":"x"}}"#).unwrap();
        std::fs::write(tmp.join("app/src-tauri/Cargo.toml"), "[package]\nname='x'").unwrap();
        let ids: Vec<String> = detect_commands(&tmp).iter().map(|c| format!("{}={}", c.id, c.kind)).collect();
        assert!(ids.contains(&"npm:test=check".to_string()), "{ids:?}");
        assert!(ids.contains(&"npm:deploy=other".to_string()), "{ids:?}");
        assert!(!ids.iter().any(|i| i.contains("bad name")));
        assert!(ids.contains(&"cargo:app/src-tauri/check=check".to_string()), "{ids:?}");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn versions_and_tail() {
        assert_ne!(version_of(b"a"), version_of(b"b"));
        assert_eq!(version_of(b"same"), version_of(b"same"));
        let t = tail(&"x".repeat(100), 10);
        assert!(t.ends_with("xxxxxxxxxx"));
    }
}
