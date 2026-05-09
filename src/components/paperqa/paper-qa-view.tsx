import { useCallback, useEffect, useState } from "react"
import { BookOpen, Play, Square, RefreshCw, Plus, Loader2 } from "lucide-react"
import { usePaperQaStore } from "@/stores/paperqa-store"
import {
  paperqaStart,
  paperqaStop,
  paperqaStatus,
  paperqaCall,
  listenPaperQaEvents,
  listenPaperQaStderr,
  paperqaSend,
} from "@/commands/paperqa"
import type { PaperAddResult, PaperFile } from "@/types/paperqa"
import { PaperResults } from "./paper-results"
import { load as loadStore } from "@tauri-apps/plugin-store"

const STORE_FILE = "app-state.json"
const CONFIG_KEY = "paperqa.config"

export function PaperQaView() {
  const config = usePaperQaStore((s) => s.config)
  const setConfig = usePaperQaStore((s) => s.setConfig)
  const status = usePaperQaStore((s) => s.status)
  const setStatus = usePaperQaStore((s) => s.setStatus)
  const papers = usePaperQaStore((s) => s.papers)
  const setPapers = usePaperQaStore((s) => s.setPapers)
  const sessions = usePaperQaStore((s) => s.sessions)
  const activeSessionId = usePaperQaStore((s) => s.activeSessionId)
  const addSession = usePaperQaStore((s) => s.addSession)
  const updateSession = usePaperQaStore((s) => s.updateSession)
  const appendAnswer = usePaperQaStore((s) => s.appendAnswer)
  const pushContexts = usePaperQaStore((s) => s.pushContexts)
  const pushStderr = usePaperQaStore((s) => s.pushStderr)

  const [question, setQuestion] = useState("")
  const [busy, setBusy] = useState(false)
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // Load persisted config once on mount.
  useEffect(() => {
    ;(async () => {
      try {
        const store = await loadStore(STORE_FILE)
        const saved = (await store.get(CONFIG_KEY)) as typeof config | null
        if (saved) setConfig(saved)
      } catch {
        /* ignore */
      }
      try {
        const s = await paperqaStatus()
        setStatus(s)
      } catch {
        /* ignore */
      }
    })()
  }, [setConfig, setStatus])

  // Mirror stderr lines into the store so the dev panel can show them.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    listenPaperQaStderr((line) => pushStderr(line)).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [pushStderr])

  const persistConfig = useCallback(async (next: typeof config) => {
    try {
      const store = await loadStore(STORE_FILE)
      await store.set(CONFIG_KEY, next)
      await store.save()
    } catch {
      /* ignore */
    }
  }, [])

  const handleStart = useCallback(async () => {
    setErrorBanner(null)
    if (!config.pythonPath) {
      setErrorBanner("请先在下方设置 Python 路径（例如 .wiki/bin/python）")
      return
    }
    try {
      const res = await paperqaStart({
        pythonPath: config.pythonPath,
        bridgePath: config.bridgePath,
        pythonPathExtra: config.pythonPathExtra,
      })
      setStatus({
        running: res.ok,
        pid: res.pid,
        python: res.python,
        bridge: res.bridge,
      })
    } catch (e) {
      setErrorBanner(`启动失败: ${e}`)
    }
  }, [config, setStatus])

  const handleStop = useCallback(async () => {
    try {
      await paperqaStop()
      setStatus({ running: false, pid: null, python: null, bridge: null })
    } catch (e) {
      setErrorBanner(`停止失败: ${e}`)
    }
  }, [setStatus])

  const refreshPapers = useCallback(async () => {
    if (!status.running || !config.paperDir) return
    try {
      const files = await paperqaCall<PaperFile[]>("list_papers", {
        paper_dir: config.paperDir,
      })
      setPapers(files)
    } catch (e) {
      setErrorBanner(`列出论文失败: ${e}`)
    }
  }, [status.running, config.paperDir, setPapers])

  useEffect(() => {
    if (status.running && config.paperDir) {
      refreshPapers()
    }
  }, [status.running, config.paperDir, refreshPapers])

  const handleAddPaper = useCallback(async () => {
    if (!status.running) {
      setErrorBanner("请先启动 bridge")
      return
    }
    const path = window.prompt("论文文件绝对路径（PDF/TXT/MD/HTML/DOCX）:")
    if (!path) return
    setBusy(true)
    try {
      const res = await paperqaCall<PaperAddResult>("add_paper", { path })
      setErrorBanner(null)
      await refreshPapers()
      console.log("added paper:", res)
    } catch (e) {
      setErrorBanner(`添加失败: ${e}`)
    } finally {
      setBusy(false)
    }
  }, [status.running, refreshPapers])

  const handleQuery = useCallback(async () => {
    if (!question.trim()) return
    if (!status.running) {
      setErrorBanner("请先启动 bridge")
      return
    }
    if (!config.paperDir) {
      setErrorBanner("请先设置论文目录")
      return
    }
    const id = crypto.randomUUID()
    addSession({
      id,
      question,
      answer: "",
      contexts: [],
      done: null,
      error: null,
      stage: "starting",
      running: true,
      createdAt: Date.now(),
    })
    setBusy(true)

    let unlisten: (() => void) | null = null
    const cleanup = () => {
      unlisten?.()
      setBusy(false)
    }

    unlisten = await listenPaperQaEvents(id, (ev) => {
      if (ev.type === "chunk") {
        appendAnswer(id, ev.data)
      } else if (ev.type === "progress") {
        updateSession(id, {
          stage: String((ev.data as Record<string, unknown>).stage ?? ""),
        })
      } else if (ev.type === "contexts") {
        pushContexts(id, ev.data)
      } else if (ev.type === "done") {
        updateSession(id, {
          done: ev.data as never,
          running: false,
          stage: "done",
        })
        cleanup()
      } else if (ev.type === "error") {
        updateSession(id, { error: ev.data, running: false, stage: "error" })
        cleanup()
      }
    })

    try {
      await paperqaSend(id, "query", {
        question,
        paper_dir: config.paperDir,
      })
    } catch (e) {
      updateSession(id, { error: `${e}`, running: false, stage: "error" })
      cleanup()
    }
  }, [question, status.running, config.paperDir, addSession, appendAnswer, pushContexts, updateSession])

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <header className="flex items-center gap-3 border-b px-4 py-3 shrink-0">
        <BookOpen className="w-5 h-5" />
        <h2 className="text-base font-medium">Paper Q&A</h2>
        <div className="ml-4 flex items-center gap-2 text-xs">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              status.running ? "bg-green-500" : "bg-zinc-400"
            }`}
          />
          <span className="text-muted-foreground">
            {status.running ? `running (pid ${status.pid})` : "stopped"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!status.running ? (
            <button
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
              onClick={handleStart}
            >
              <Play className="w-3 h-3" /> 启动 Bridge
            </button>
          ) : (
            <button
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded border hover:bg-accent"
              onClick={handleStop}
            >
              <Square className="w-3 h-3" /> 停止
            </button>
          )}
        </div>
      </header>

      {errorBanner && (
        <div className="px-4 py-2 text-xs bg-red-50 text-red-700 border-b shrink-0">
          {errorBanner}
        </div>
      )}

      <div className="px-4 py-3 border-b space-y-2 shrink-0 bg-muted/30">
        <div className="flex gap-2 items-center text-xs">
          <label className="w-24 text-muted-foreground">Python 路径</label>
          <input
            className="flex-1 border rounded px-2 py-1 text-xs bg-background"
            placeholder=".wiki/bin/python 绝对路径"
            value={config.pythonPath}
            onChange={(e) => {
              const next = { ...config, pythonPath: e.target.value }
              setConfig({ pythonPath: e.target.value })
              persistConfig(next)
            }}
          />
        </div>
        <div className="flex gap-2 items-center text-xs">
          <label className="w-24 text-muted-foreground">论文目录</label>
          <input
            className="flex-1 border rounded px-2 py-1 text-xs bg-background"
            placeholder="包含 PDF 的目录绝对路径"
            value={config.paperDir}
            onChange={(e) => {
              const next = { ...config, paperDir: e.target.value }
              setConfig({ paperDir: e.target.value })
              persistConfig(next)
            }}
          />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r overflow-y-auto bg-muted/20 shrink-0">
          <div className="flex items-center gap-1 px-3 py-2 border-b text-xs font-medium">
            <span>已索引论文 ({papers.length})</span>
            <button
              className="ml-auto p-1 hover:bg-accent rounded"
              onClick={refreshPapers}
              title="刷新"
              disabled={!status.running}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
            <button
              className="p-1 hover:bg-accent rounded"
              onClick={handleAddPaper}
              title="添加论文"
              disabled={!status.running || busy}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
          <ul className="text-xs">
            {papers.map((p) => (
              <li
                key={p.path}
                className="px-3 py-1.5 border-b hover:bg-accent cursor-default truncate"
                title={p.path}
              >
                {p.rel || p.name}
              </li>
            ))}
            {papers.length === 0 && (
              <li className="px-3 py-4 text-muted-foreground text-center">
                {status.running ? "没有论文，点击 + 添加" : "启动 bridge 后加载"}
              </li>
            )}
          </ul>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="border-b p-3 space-y-2 shrink-0">
            <textarea
              className="w-full border rounded px-3 py-2 text-sm bg-background resize-none h-20"
              placeholder="对论文集提问…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleQuery()
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                onClick={handleQuery}
                disabled={busy || !status.running || !question.trim()}
              >
                {busy ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Play className="w-3 h-3" />
                )}
                运行查询 (Ctrl/⌘+Enter)
              </button>
              {activeSession && activeSession.stage && (
                <span className="text-xs text-muted-foreground">
                  stage: {activeSession.stage}
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <PaperResults session={activeSession} allSessions={sessions} />
          </div>
        </main>
      </div>
    </div>
  )
}
