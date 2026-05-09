//! Paper-QA Python sidecar transport.
//!
//! Spawns a user-configured Python interpreter running
//! `sidecar/paperqa_bridge.py`. Requests are written as JSON lines to
//! stdin; responses stream back as JSON lines on stdout, which we
//! forward as Tauri events on the topic `paperqa:{request_id}`.
//!
//! The bridge lifecycle is independent from any single request: one
//! process serves many requests. Frontend calls `paperqa_start` once,
//! then `paperqa_send` N times, and `paperqa_stop` on teardown.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct PaperQaState {
    inner: Arc<Mutex<Option<BridgeHandle>>>,
}

struct BridgeHandle {
    child: Child,
    stdin: ChildStdin,
    python_path: String,
    bridge_script: String,
}

#[derive(Serialize)]
pub struct StartResult {
    pub ok: bool,
    pub pid: Option<u32>,
    pub python: String,
    pub bridge: String,
    pub error: Option<String>,
}

#[derive(Deserialize)]
pub struct StartArgs {
    /// Absolute path to python interpreter (e.g. from the .wiki venv).
    pub python_path: String,
    /// Absolute path to paperqa_bridge.py. If empty, uses the bundled
    /// sidecar path under the app's resource dir.
    pub bridge_path: Option<String>,
    /// Extra paths to prepend to PYTHONPATH (e.g. paper-qa/src).
    pub python_path_extra: Option<Vec<String>>,
}

fn resolve_bridge_script(app: &AppHandle, override_path: Option<String>) -> Result<String, String> {
    if let Some(p) = override_path.filter(|s| !s.is_empty()) {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return Ok(p);
        }
        return Err(format!("bridge script not found: {p}"));
    }
    // Dev fallback: walk up from the tauri manifest dir to find sidecar/.
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("sidecar")
            .join("paperqa_bridge.py"),
    ];
    for c in &candidates {
        if c.exists() {
            return Ok(c.to_string_lossy().to_string());
        }
    }
    // Production: look under the app resource dir.
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("sidecar").join("paperqa_bridge.py");
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    Err("could not locate paperqa_bridge.py".to_string())
}

/// Start the paper-qa bridge sidecar. If already running, returns the
/// existing handle's metadata (pid).
#[tauri::command]
pub async fn paperqa_start(
    app: AppHandle,
    state: State<'_, PaperQaState>,
    args: StartArgs,
) -> Result<StartResult, String> {
    let mut guard = state.inner.lock().await;
    if let Some(handle) = guard.as_mut() {
        if let Ok(None) = handle.child.try_wait() {
            return Ok(StartResult {
                ok: true,
                pid: handle.child.id(),
                python: handle.python_path.clone(),
                bridge: handle.bridge_script.clone(),
                error: None,
            });
        }
        // stale — drop it
        let _ = handle.child.start_kill();
        *guard = None;
    }

    let bridge_script = resolve_bridge_script(&app, args.bridge_path.clone())?;
    let mut cmd = Command::new(&args.python_path);
    cmd.arg("-u").arg(&bridge_script);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(extras) = &args.python_path_extra {
        let joined = extras.join(if cfg!(windows) { ";" } else { ":" });
        cmd.env("PYTHONPATH", joined);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn python bridge: {e}"))?;

    let stdin = child.stdin.take().ok_or_else(|| "missing stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "missing stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "missing stderr".to_string())?;
    let pid = child.id();

    // Drain stdout line-by-line; forward each JSON line as a Tauri event.
    let app_for_stdout = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            // Parse once to extract request id for topic routing; forward raw line.
            let id = serde_json::from_str::<serde_json::Value>(&line)
                .ok()
                .and_then(|v| v.get("id").and_then(|x| x.as_str()).map(str::to_owned))
                .unwrap_or_default();
            let topic = if id.is_empty() {
                "paperqa:broadcast".to_string()
            } else {
                format!("paperqa:{id}")
            };
            if app_for_stdout.emit(&topic, line).is_err() {
                break;
            }
        }
        let _ = app_for_stdout.emit("paperqa:exit", serde_json::json!({"pid": pid}));
    });

    // Drain stderr -> dev terminal + broadcast to frontend for diagnostics.
    let app_for_stderr = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            eprintln!("[paperqa stderr] {line}");
            let _ = app_for_stderr.emit("paperqa:stderr", line);
        }
    });

    let python_path = args.python_path.clone();
    *guard = Some(BridgeHandle {
        child,
        stdin,
        python_path: python_path.clone(),
        bridge_script: bridge_script.clone(),
    });

    Ok(StartResult {
        ok: true,
        pid,
        python: python_path,
        bridge: bridge_script,
        error: None,
    })
}

#[derive(Deserialize)]
pub struct SendArgs {
    pub id: String,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn paperqa_send(
    state: State<'_, PaperQaState>,
    args: SendArgs,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let handle = guard
        .as_mut()
        .ok_or_else(|| "paperqa bridge not started".to_string())?;
    let payload = serde_json::json!({
        "id": args.id,
        "method": args.method,
        "params": args.params.unwrap_or(serde_json::json!({})),
    });
    let mut line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    line.push('\n');
    handle
        .stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("write failed: {e}"))?;
    handle
        .stdin
        .flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn paperqa_stop(state: State<'_, PaperQaState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut handle) = guard.take() {
        let _ = handle.child.start_kill();
    }
    Ok(())
}

#[derive(Serialize)]
pub struct StatusInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub python: Option<String>,
    pub bridge: Option<String>,
}

#[tauri::command]
pub async fn paperqa_status(state: State<'_, PaperQaState>) -> Result<StatusInfo, String> {
    let mut guard = state.inner.lock().await;
    if let Some(handle) = guard.as_mut() {
        if let Ok(None) = handle.child.try_wait() {
            return Ok(StatusInfo {
                running: true,
                pid: handle.child.id(),
                python: Some(handle.python_path.clone()),
                bridge: Some(handle.bridge_script.clone()),
            });
        }
        *guard = None;
    }
    Ok(StatusInfo {
        running: false,
        pid: None,
        python: None,
        bridge: None,
    })
}
