// Liatir Native bridge SDK — managed by @liatir/cli.
// HTTP/1.0 + Connection: close avoids streaming/chunked framing dependencies.
#![allow(dead_code)]
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Clone, Copy, Default)]
pub struct Liatir;

impl Liatir {
    pub fn invoke(&self, cmd: &str, mut payload: Value) -> Result<Value> {
        if payload.is_null() {
            payload = json!({});
        }
        if let Some(dev) = dev_context() {
            payload
                .as_object_mut()
                .ok_or("bridge payload must be an object")?
                .insert("__liatirDevContext".into(), dev);
        }
        let ipc: Value = serde_json::from_slice(&std::fs::read(
            std::env::var("LIATIR_IPC_FILE")
                .map_err(|_| "Liatir connection missing: LIATIR_IPC_FILE is not set")?,
        )?)?;
        let port = ipc["port"]
            .as_u64()
            .filter(|p| *p > 0 && *p <= 65535)
            .ok_or("invalid IPC port")?;
        let token = ipc["token"]
            .as_str()
            .filter(|t| !t.is_empty() && !t.contains(['\r', '\n']))
            .ok_or("invalid IPC token")?;
        let body = serde_json::to_vec(&json!({ "cmd": cmd, "payload": payload }))?;
        let mut stream = TcpStream::connect(("127.0.0.1", port as u16))?;
        stream.set_read_timeout(Some(Duration::from_secs(600)))?;
        stream.set_write_timeout(Some(Duration::from_secs(600)))?;
        write!(stream, "POST /invoke HTTP/1.0\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n", body.len())?;
        stream.write_all(&body)?;
        let mut response = Vec::new();
        stream.read_to_end(&mut response)?;
        let split = response
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .ok_or("invalid IPC HTTP response")?;
        let headers = std::str::from_utf8(&response[..split])?;
        let status = headers.lines().next().unwrap_or_default();
        if !status.starts_with("HTTP/1.0 200 ") && !status.starts_with("HTTP/1.1 200 ") {
            return Err(format!("Liatir bridge request failed: {status}").into());
        }
        let value: Value = serde_json::from_slice(&response[split + 4..])?;
        if value["ok"] != true {
            return Err(value["error"]
                .as_str()
                .unwrap_or("bridge call failed")
                .to_string()
                .into());
        }
        Ok(value["result"].clone())
    }
    pub fn paths(&self) -> Result<Value> {
        let mut paths = self.invoke("lia_fs_paths", json!({}))?;
        if let Some(dev) = dev_context() {
            let rel = format!(
                "workspaces/{}/plugin-dev/{}",
                dev["workspaceId"].as_str().unwrap_or_default(),
                dev["sessionId"].as_str().unwrap_or_default()
            );
            for permanent in [true, false] {
                self.invoke(
                    "lia_fs_mkdir",
                    json!({ "rel": rel, "permanent": permanent }),
                )?;
            }
            for key in ["data", "cache"] {
                paths[key] = json!(format!("{}/{rel}", paths[key].as_str().unwrap_or_default()));
            }
            paths["temp"] = paths["cache"].clone();
        }
        Ok(paths)
    }
    pub fn jobs(&self) -> Jobs {
        Jobs(*self)
    }
    pub fn deps(&self) -> Deps {
        Deps(*self)
    }
    pub fn desktop(&self) -> Desktop {
        Desktop(*self)
    }
    pub fn log(&self) -> Log {
        Log(*self)
    }
    pub fn progress(&self) -> Progress {
        Progress(*self)
    }
}
fn dev_context() -> Option<Value> {
    if std::env::var("LIATIR_RUN_SCOPE").ok().as_deref() != Some("plugin-dev") {
        return None;
    }
    Some(
        json!({ "scope": "plugin-dev", "sessionId": std::env::var("LIATIR_DEV_SESSION_ID").unwrap_or_default(),
        "workspaceId": std::env::var("LIATIR_WORKSPACE_ID").unwrap_or_default() }),
    )
}
fn job_id() -> String {
    std::env::var("LIATIR_JOB_ID").unwrap_or_else(|_| "unknown".into())
}

pub struct Jobs(Liatir);
impl Jobs {
    pub fn spawn(&self, cmd: &str, args: &[&str], options: Value) -> Result<Value> {
        let mut payload = if options.is_null() {
            json!({})
        } else {
            options
        };
        let map = payload
            .as_object_mut()
            .ok_or("job options must be an object")?;
        map.insert("cmd".into(), json!(cmd));
        map.insert("args".into(), json!(args));
        self.0.invoke("lia_jobs_spawn", payload)
    }
    pub fn kill(&self, job: &str) -> Result<Value> {
        self.0.invoke("lia_jobs_kill", json!({"jobId": job}))
    }
    pub fn status(&self, job: &str) -> Result<Value> {
        self.0.invoke("lia_jobs_status", json!({"jobId": job}))
    }
    pub fn get_output(&self, job: &str, since: Option<usize>) -> Result<Value> {
        self.0
            .invoke("lia_jobs_get_output", json!({"jobId": job, "since": since}))
    }
    pub fn list(&self) -> Result<Value> {
        if let Some(dev) = dev_context() {
            let entries = self.0.invoke(
                "lia_jobs_list",
                json!({"workspaceId": dev["workspaceId"], "includeDev": true}),
            )?;
            return Ok(Value::Array(
                entries
                    .as_array()
                    .ok_or("invalid job list")?
                    .iter()
                    .filter(|e| e["metadata"]["pluginDevSessionId"] == dev["sessionId"])
                    .cloned()
                    .collect(),
            ));
        }
        self.0.invoke("lia_jobs_list", json!({}))
    }
    pub fn clear_done(&self) -> Result<Value> {
        if dev_context().is_some() {
            return Ok(json!(0));
        }
        self.0.invoke("lia_jobs_clear_done", json!({}))
    }
    pub fn run(
        &self,
        cmd: &str,
        args: &[&str],
        options: Value,
        mut on_stdout: impl FnMut(&str),
        mut on_stderr: impl FnMut(&str),
    ) -> Result<Value> {
        let job = self.spawn(cmd, args, options)?;
        let id = job["jobId"]
            .as_str()
            .ok_or("spawn did not return a jobId")?;
        let mut offsets = [0, 0];
        loop {
            std::thread::sleep(Duration::from_millis(100));
            let entry = self.status(id)?;
            let output = self.get_output(id, None)?;
            for (index, key) in ["stdout", "stderr"].iter().enumerate() {
                let lines = output[key].as_array().ok_or("invalid job output")?;
                for line in lines.iter().skip(offsets[index]) {
                    if index == 0 {
                        on_stdout(line.as_str().unwrap_or_default());
                    } else {
                        on_stderr(line.as_str().unwrap_or_default());
                    }
                }
                offsets[index] = lines.len();
            }
            if entry["status"]["type"] != "running" {
                return Ok(entry);
            }
        }
    }
}
pub struct Deps(Liatir);
impl Deps {
    pub fn check(&self, binary: &str) -> Result<Value> {
        self.0.invoke("lia_deps_check", json!({"binary": binary}))
    }
    pub fn check_many(&self, binaries: &[&str]) -> Result<Value> {
        self.0
            .invoke("lia_deps_check_many", json!({"binaries": binaries}))
    }
}
pub struct Desktop(Liatir);
impl Desktop {
    pub fn fs(&self) -> Fs {
        Fs(self.0)
    }
    pub fn app(&self) -> App {
        App(self.0)
    }
}
pub struct App(Liatir);
impl App {
    pub fn info(&self) -> Result<Value> {
        self.0.invoke("lia_app_info", json!({}))
    }
}
pub struct Fs(Liatir);
impl Fs {
    pub fn data(&self) -> FsScope {
        FsScope {
            bridge: self.0,
            permanent: true,
            plugin: None,
        }
    }
    pub fn cache(&self) -> FsScope {
        FsScope {
            bridge: self.0,
            permanent: false,
            plugin: None,
        }
    }
    pub fn plugin_fs(&self, plugin: &str) -> Result<FsScope> {
        if plugin.trim().is_empty() {
            return Err("Plugin name is required".into());
        }
        Ok(FsScope {
            bridge: self.0,
            permanent: true,
            plugin: Some(format!("{}.wasm", plugin.trim().replace(".wasm", ""))),
        })
    }
    pub fn paths(&self) -> Result<Value> {
        self.0.paths()
    }
}
pub struct FsScope {
    bridge: Liatir,
    permanent: bool,
    plugin: Option<String>,
}
impl FsScope {
    fn call(&self, cmd: &str, mut payload: Value) -> Result<Value> {
        payload["permanent"] = json!(self.permanent);
        if let Some(plugin) = &self.plugin {
            payload["pluginStoragePlugin"] = json!(plugin);
        }
        self.bridge.invoke(cmd, payload)
    }
    pub fn list_content(&self, rel: &str) -> Result<Value> {
        self.call("lia_fs_list_dir", json!({"rel": rel}))
    }
    pub fn new_directory(&self, rel: &str) -> Result<Value> {
        self.call("lia_fs_mkdir", json!({"rel": rel}))
    }
    pub fn remove(&self, rel: &str, recursive: bool) -> Result<Value> {
        self.call("lia_fs_rm", json!({"rel": rel, "recursive": recursive}))
    }
    pub fn stat(&self, rel: &str) -> Result<Value> {
        self.call("lia_fs_stat", json!({"rel": rel}))
    }
    pub fn exists(&self, rel: &str) -> Result<Value> {
        self.call("lia_fs_exists", json!({"rel": rel}))
    }
    pub fn read_text(&self, rel: &str) -> Result<Value> {
        self.call("lia_fs_read_text", json!({"rel": rel}))
    }
    pub fn write_text(
        &self,
        rel: &str,
        contents: &str,
        create_dirs: bool,
        append: bool,
    ) -> Result<Value> {
        self.call(
            "lia_fs_write_text",
            json!({"rel": rel, "contents": contents, "createDirs": create_dirs, "append": append}),
        )
    }
    pub fn read_bytes(&self, rel: &str) -> Result<Value> {
        self.call("lia_fs_read_bytes", json!({"rel": rel}))
    }
    pub fn write_bytes(&self, rel: &str, data_base64: &str, create_dirs: bool) -> Result<Value> {
        self.call(
            "lia_fs_write_bytes",
            json!({"rel": rel, "dataBase64": data_base64, "createDirs": create_dirs}),
        )
    }
    pub fn copy(
        &self,
        src: &str,
        dest: &str,
        recursive: bool,
        create_dirs: bool,
        overwrite: bool,
    ) -> Result<Value> {
        self.call("lia_fs_copy", json!({"src": src, "dest": dest, "recursive": recursive, "createDirs": create_dirs, "overwrite": overwrite}))
    }
    pub fn move_file(
        &self,
        src: &str,
        dest: &str,
        create_dirs: bool,
        overwrite: bool,
    ) -> Result<Value> {
        self.call(
            "lia_fs_move",
            json!({"src": src, "dest": dest, "createDirs": create_dirs, "overwrite": overwrite}),
        )
    }
    pub fn path(&self) -> Result<Value> {
        if self.plugin.is_some() {
            self.new_directory("")?;
            return Ok(self.stat("")?["path"].clone());
        }
        Ok(self.bridge.paths()?[if self.permanent { "data" } else { "cache" }].clone())
    }
    pub fn clear(&self) -> Result<Value> {
        self.bridge.invoke(
            if self.permanent {
                "lia_fs_clear_data"
            } else {
                "lia_fs_clear_cache"
            },
            json!({}),
        )
    }
    pub fn clear_storage(&self) -> Result<Value> {
        self.bridge
            .invoke("lia_plugin_storage_clear", json!({"plugin": self.plugin}))
    }
}
pub struct Log(Liatir);
impl Log {
    pub fn send(&self, level: &str, message: &str, meta: Value) -> Result<Value> {
        self.0.invoke(
            "lia_plugin_log",
            json!({"jobId": job_id(), "level": level, "message": message, "meta": meta}),
        )
    }
    pub fn info(&self, message: &str, meta: Value) -> Result<Value> {
        self.send("info", message, meta)
    }
    pub fn warn(&self, message: &str, meta: Value) -> Result<Value> {
        self.send("warn", message, meta)
    }
    pub fn error(&self, message: &str, meta: Value) -> Result<Value> {
        self.send("error", message, meta)
    }
    pub fn debug(&self, message: &str, meta: Value) -> Result<Value> {
        self.send("debug", message, meta)
    }
}
pub struct Progress(Liatir);
impl Progress {
    pub fn start(&self, total: u64, label: Option<&str>) -> Result<Value> {
        self.0.invoke(
            "lia_plugin_progress",
            json!({"jobId": job_id(), "current": 0, "total": total, "label": label}),
        )
    }
    pub fn advance(&self, delta: u64, label: Option<&str>) -> Result<Value> {
        self.0.invoke(
            "lia_plugin_progress",
            json!({"jobId": job_id(), "delta": delta, "label": label}),
        )
    }
    pub fn update(&self, current: u64, label: Option<&str>) -> Result<Value> {
        self.0.invoke(
            "lia_plugin_progress",
            json!({"jobId": job_id(), "current": current, "label": label}),
        )
    }
    pub fn done(&self) -> Result<Value> {
        self.0.invoke(
            "lia_plugin_progress",
            json!({"jobId": job_id(), "done": true}),
        )
    }
}
