/**
 * Audio Overview Panel
 *
 * 功能：
 *   - 选择范围（全部源 / 已选源）和风格（Deep Dive / Brief / Debate）
 *   - 调用 generateAudioScript → 活动面板显示进度
 *   - 脚本展示：双色对话气泡，带行号
 *   - TTS 合成：逐段合成，顺序播放
 *   - 播放器：播放/暂停、倍速、进度高亮、下载脚本
 */

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Mic,
  Play,
  Pause,
  SkipBack,
  Volume2,
  Download,
  Loader2,
  Headphones,
  RefreshCw,
  ChevronDown,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWikiStore } from "@/stores/wiki-store"
import { useActivityStore } from "@/stores/activity-store"
import {
  generateAudioScript,
  listAudioScripts,
  deleteAudioScript,
  scriptToMarkdown,
  type AudioScript,
  type AudioStyle,
} from "@/lib/audio-overview"
import {
  synthesizeScript,
  revokeBlobUrls,
} from "@/lib/tts-providers"

// ─── 子组件：风格选择器 ───────────────────────────────────────────────────────

const AUDIO_STYLES: AudioStyle[] = ["deep-dive", "brief", "debate"]

// ─── 子组件：对话气泡 ─────────────────────────────────────────────────────────

function DialogueBubble({
  speaker,
  text,
  index,
  isActive,
  onClick,
}: {
  speaker: "A" | "B"
  text: string
  index: number
  isActive: boolean
  onClick: () => void
}) {
  const isA = speaker === "A"
  return (
    <div
      className={`flex gap-2 mb-3 cursor-pointer transition-opacity ${isActive ? "opacity-100" : "opacity-70 hover:opacity-90"}`}
      onClick={onClick}
    >
      {isA && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
          A
        </div>
      )}
      <div
        className={`flex-1 rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isActive
            ? isA
              ? "bg-primary/15 ring-1 ring-primary/40"
              : "bg-secondary/30 ring-1 ring-secondary/60"
            : isA
              ? "bg-muted/60"
              : "bg-muted/40"
        } ${isA ? "" : "text-right"}`}
      >
        <span className="text-[10px] text-muted-foreground mr-1">#{index + 1}</span>
        {text}
      </div>
      {!isA && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-secondary/30 flex items-center justify-center text-xs font-bold text-secondary-foreground">
          B
        </div>
      )}
    </div>
  )
}

// ─── 子组件：播放器控制栏 ─────────────────────────────────────────────────────

function PlayerBar({
  isPlaying,
  isSynthesizing,
  synthProgress,
  currentLine,
  totalLines,
  speed,
  onPlayPause,
  onRestart,
  onSpeedChange,
  onDownload,
  ttsEnabled,
}: {
  isPlaying: boolean
  isSynthesizing: boolean
  synthProgress: { completed: number; total: number } | null
  currentLine: number
  totalLines: number
  speed: number
  onPlayPause: () => void
  onRestart: () => void
  onSpeedChange: (s: number) => void
  onDownload: () => void
  ttsEnabled: boolean
}) {
  const { t } = useTranslation()
  const speeds = [0.75, 1.0, 1.25, 1.5, 2.0]

  return (
    <div className="border-t bg-background/95 backdrop-blur px-4 py-3 flex items-center gap-3">
      {ttsEnabled ? (
        <Button
          size="icon"
          variant="default"
          className="h-9 w-9 rounded-full"
          onClick={onPlayPause}
          disabled={isSynthesizing}
        >
          {isSynthesizing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Volume2 className="h-4 w-4" />
          <span>{t("audio.noTts")}</span>
        </div>
      )}

      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={onRestart}
        disabled={isSynthesizing}
        title={t("audio.restartTitle")}
      >
        <SkipBack className="h-4 w-4" />
      </Button>

      <div className="flex-1 flex flex-col gap-1">
        {isSynthesizing && synthProgress ? (
          <div className="text-xs text-muted-foreground">
            {t("audio.synthesizing", { completed: synthProgress.completed, total: synthProgress.total })}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            {ttsEnabled
              ? `${currentLine + 1} / ${totalLines}`
              : t("audio.linesDialogue", { count: totalLines })}
          </div>
        )}
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all"
            style={{
              width: isSynthesizing && synthProgress
                ? `${(synthProgress.completed / Math.max(synthProgress.total, 1)) * 100}%`
                : `${((currentLine + 1) / Math.max(totalLines, 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      {ttsEnabled && (
        <div className="flex items-center gap-1">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                speed === s
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      )}

      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        onClick={onDownload}
        title={t("audio.downloadTitle")}
      >
        <Download className="h-4 w-4" />
      </Button>
    </div>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

interface AudioOverviewPanelProps {
  /** 当前可用的 source 文件名列表 */
  availableSources: string[]
  /** 当前已勾选的 source 文件名（来自 scope store） */
  scopeSources: string[]
  onClose?: () => void
}

export function AudioOverviewPanel({
  availableSources,
  scopeSources,
  onClose,
}: AudioOverviewPanelProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const ttsConfig = useWikiStore((s) => s.ttsConfig)
  const outputLanguage = useWikiStore((s) => s.outputLanguage)
  const addItem = useActivityStore((s) => s.addItem)
  const updateItem = useActivityStore((s) => s.updateItem)

  // ── 生成状态 ──
  const [style, setStyle] = useState<AudioStyle>("deep-dive")
  const [useScope, setUseScope] = useState(scopeSources.length > 0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const generateAbortRef = useRef<AbortController | null>(null)

  // ── 脚本列表 ──
  const [scripts, setScripts] = useState<AudioScript[]>([])
  const [activeScript, setActiveScript] = useState<AudioScript | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // ── TTS 播放状态 ──
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const [synthProgress, setSynthProgress] = useState<{ completed: number; total: number } | null>(null)
  const [segmentUrls, setSegmentUrls] = useState<string[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentLine, setCurrentLine] = useState(0)
  const [playSpeed, setPlaySpeed] = useState(1.0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const synthAbortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 决定实际使用的 sources
  const effectiveSources = useScope && scopeSources.length > 0
    ? scopeSources
    : availableSources

  // ── 加载历史脚本 ──
  const loadScripts = useCallback(async () => {
    if (!project) return
    const list = await listAudioScripts(project.path)
    setScripts(list)
    if (list.length > 0 && !activeScript) {
      setActiveScript(list[0])
    }
  }, [project, activeScript])

  useEffect(() => {
    loadScripts()
  }, [loadScripts])

  // ── 生成脚本 ──
  async function handleGenerate() {
    if (!project || isGenerating) return
    if (effectiveSources.length === 0) {
      setGenerateError(t("audio.errorNoSources"))
      return
    }

    setGenerateError(null)
    setIsGenerating(true)
    generateAbortRef.current = new AbortController()

    const actId = addItem({
      type: "audio",
      title: `Audio Overview (${t(`audio.style${style.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}`)})`,
      status: "running",
      detail: t("audio.generating"),
      filesWritten: [],
    })

    try {
      const result = await generateAudioScript({
        projectPath: project.path,
        scopeSources: effectiveSources,
        style,
        llmConfig,
        outputLanguage,
        signal: generateAbortRef.current.signal,
      })

      updateItem(actId, {
        status: "done",
        detail: t("audio.linesDialogue", { count: result.script.lines.length }),
        filesWritten: [result.mdPath],
      })

      await loadScripts()
      setActiveScript(result.script)
      setSegmentUrls([])
      setCurrentLine(0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setGenerateError(msg)
      updateItem(actId, { status: "error", detail: msg })
    } finally {
      setIsGenerating(false)
      generateAbortRef.current = null
    }
  }

  // ── TTS 合成 ──
  async function handleSynthesize() {
    if (!activeScript || isSynthesizing) return
    if (ttsConfig.provider === "none") {
      setGenerateError(t("audio.errorNoTts"))
      return
    }

    // 清理旧的 blob URLs
    revokeBlobUrls(segmentUrls)
    setSegmentUrls([])
    setIsSynthesizing(true)
    const actScript = activeScript
    setSynthProgress({ completed: 0, total: actScript.lines.length })
    synthAbortRef.current = new AbortController()
    const actId = addItem({
      type: "audio",
      title: `TTS: ${actScript.title}`,
      status: "running",
      detail: t("audio.generating"),
      filesWritten: [],
    })

    try {
      const result = await synthesizeScript(
        actScript.lines,
        ttsConfig,
        (progress) => setSynthProgress({ completed: progress.completed, total: progress.total }),
        synthAbortRef.current.signal,
      )

      setSegmentUrls(result.segmentUrls)
      setCurrentLine(0)
      updateItem(actId, {
        status: "done",
        detail: t("audio.linesCount", { count: result.segmentUrls.length }),
      })
      // 自动开始播放
      setTimeout(() => playSegment(0, result.segmentUrls, actScript), 100)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setGenerateError(msg)
      updateItem(actId, { status: "error", detail: msg })
    } finally {
      setIsSynthesizing(false)
      setSynthProgress(null)
      synthAbortRef.current = null
    }
  }

  // ── 音频播放 ──
  function playSegment(
    index: number,
    urls: string[],
    script: AudioScript,
  ) {
    if (index >= urls.length || index >= script.lines.length) {
      setIsPlaying(false)
      return
    }

    setCurrentLine(index)
    setIsPlaying(true)

    // 滚动到当前行
    const lineEl = document.getElementById(`audio-line-${index}`)
    lineEl?.scrollIntoView({ behavior: "smooth", block: "nearest" })

    const audio = new Audio(urls[index])
    audioRef.current = audio
    audio.playbackRate = playSpeed

    audio.onended = () => {
      playSegment(index + 1, urls, script)
    }

    audio.onerror = () => {
      setIsPlaying(false)
    }

    audio.play().catch(() => setIsPlaying(false))
  }

  function handlePlayPause() {
    if (!activeScript) return

    if (isPlaying) {
      audioRef.current?.pause()
      setIsPlaying(false)
      return
    }

    if (segmentUrls.length === 0) {
      // 还没合成，先合成
      handleSynthesize()
      return
    }

    // 从当前行继续
    if (audioRef.current?.paused) {
      audioRef.current.play()
      setIsPlaying(true)
    } else {
      playSegment(currentLine, segmentUrls, activeScript)
    }
  }

  function handleRestart() {
    audioRef.current?.pause()
    audioRef.current = null
    setCurrentLine(0)
    setIsPlaying(false)
    if (segmentUrls.length > 0 && activeScript) {
      playSegment(0, segmentUrls, activeScript)
    }
  }

  function handleSpeedChange(s: number) {
    setPlaySpeed(s)
    if (audioRef.current) {
      audioRef.current.playbackRate = s
    }
  }

  // ── 下载脚本 ──
  function handleDownload() {
    if (!activeScript) return
    const md = scriptToMarkdown(activeScript)
    const blob = new Blob([md], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${activeScript.id}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── 删除脚本 ──
  async function handleDelete(script: AudioScript) {
    if (!project) return
    await deleteAudioScript(project.path, script.id)
    if (activeScript?.id === script.id) {
      setActiveScript(null)
      revokeBlobUrls(segmentUrls)
      setSegmentUrls([])
    }
    await loadScripts()
  }

  // ── 清理 ──
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      revokeBlobUrls(segmentUrls)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ttsEnabled = ttsConfig.provider !== "none"
  const estimatedMinutes = activeScript
    ? Math.round(activeScript.totalChars / 200)
    : 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Headphones className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{t("audio.title", "Audio Overview")}</span>
          {activeScript && (
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              — {activeScript.title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* 历史脚本切换 */}
          {scripts.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setShowHistory(!showHistory)}
            >
              <span>{t("audio.scriptsCount", { count: scripts.length })}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showHistory ? "rotate-180" : ""}`} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={loadScripts}
            title={t("audio.refreshTitle")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* 历史脚本下拉 */}
      {showHistory && scripts.length > 0 && (
        <div className="border-b bg-background shadow-sm z-10">
          {scripts.map((s) => (
            <div
              key={s.id}
              className={`flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-accent text-sm ${
                activeScript?.id === s.id ? "bg-accent/50 font-medium" : ""
              }`}
              onClick={() => {
                setActiveScript(s)
                setShowHistory(false)
                setSegmentUrls([])
                setCurrentLine(0)
                audioRef.current?.pause()
                setIsPlaying(false)
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="truncate max-w-[280px]">{s.title}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(s.createdAt).toLocaleDateString()} · {t("audio.scriptLines", { count: s.lines.length })} · {t("audio.scriptMinutes", { count: Math.round(s.totalChars / 200) })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={(e) => { e.stopPropagation(); handleDelete(s) }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* 生成控制区 */}
      <div className="px-4 py-3 border-b space-y-3">
        {/* 范围选择 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">{t("audio.scope", "范围")}：</span>
          <button
            onClick={() => setUseScope(false)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              !useScope
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            {t("audio.scopeAll", "全部来源")} ({availableSources.length})
          </button>
          {scopeSources.length > 0 && (
            <button
              onClick={() => setUseScope(true)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                useScope
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
              }`}
            >
              {t("audio.scopeSelected", "已选 {{count}} 个", { count: scopeSources.length })}
            </button>
          )}
        </div>

        {/* 风格选择 */}
        <div className="flex gap-2 flex-wrap">
          {AUDIO_STYLES.map((sv) => (
            <button
              key={sv}
              onClick={() => setStyle(sv)}
              className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors text-left ${
                style === sv
                  ? "bg-primary/10 border-primary/40 text-primary font-medium"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
              title={t(`audio.style${sv.split("-").map((w: string) => w[0].toUpperCase() + w.slice(1)).join("")}Desc`)}
            >
              {t(`audio.style${sv.split("-").map((w: string) => w[0].toUpperCase() + w.slice(1)).join("")}`)}
            </button>
          ))}
        </div>

        {/* 生成按钮 */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleGenerate}
            disabled={isGenerating || effectiveSources.length === 0}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("audio.generating", "生成中...")}
              </>
            ) : (
              <>
                <Mic className="h-3.5 w-3.5" />
                {t("audio.generate", "生成播客脚本")}
              </>
            )}
          </Button>
          {isGenerating && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => {
                generateAbortRef.current?.abort()
                setIsGenerating(false)
              }}
            >
              {t("audio.cancel", "取消")}
            </Button>
          )}
          {effectiveSources.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {t("audio.noSources", "请先导入并摄入资料")}
            </span>
          )}
        </div>

        {/* 错误提示 */}
        {generateError && (
          <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1.5">
            {generateError}
          </div>
        )}
      </div>

      {/* 脚本内容区 */}
      {activeScript ? (
        <>
          {/* 脚本元信息 */}
          <div className="px-4 py-2 flex items-center gap-3 text-xs text-muted-foreground border-b bg-muted/20">
            <span>{t("audio.linesDialogue", { count: activeScript.lines.length })}</span>
            <span>·</span>
            <span>{t("audio.aboutMinutes", { minutes: estimatedMinutes })}</span>
            <span>·</span>
            <span>{t(`audio.style${activeScript.style.split("-").map((w: string) => w[0].toUpperCase() + w.slice(1)).join("")}`)}</span>
            {!ttsEnabled && (
              <>
                <span>·</span>
                <span className="text-amber-600">
                  {t("audio.ttsDisabledHint", "在设置中启用 TTS 来播放音频")}
                </span>
              </>
            )}
          </div>

          {/* 对话内容 */}
          <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
            <div className="px-4 py-3">
              {activeScript.lines.map((line, i) => (
                <div key={i} id={`audio-line-${i}`}>
                  <DialogueBubble
                    speaker={line.speaker}
                    text={line.text}
                    index={i}
                    isActive={currentLine === i && (isPlaying || segmentUrls.length > 0)}
                    onClick={() => {
                      if (segmentUrls.length > 0) {
                        audioRef.current?.pause()
                        playSegment(i, segmentUrls, activeScript)
                      }
                    }}
                  />
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* 播放器控制栏 */}
          <PlayerBar
            isPlaying={isPlaying}
            isSynthesizing={isSynthesizing}
            synthProgress={synthProgress}
            currentLine={currentLine}
            totalLines={activeScript.lines.length}
            speed={playSpeed}
            onPlayPause={handlePlayPause}
            onRestart={handleRestart}
            onSpeedChange={handleSpeedChange}
            onDownload={handleDownload}
            ttsEnabled={ttsEnabled}
          />
        </>
      ) : (
        /* 空状态 */
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8 text-muted-foreground">
          <Headphones className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium">
            {t("audio.emptyTitle", "还没有播客脚本")}
          </p>
          <p className="text-xs max-w-[260px]">
            {t("audio.emptyHint", "选择风格后点击「生成播客脚本」，AI 将把你的资料转换为双主持人播客对白。")}
          </p>
        </div>
      )}
    </div>
  )
}