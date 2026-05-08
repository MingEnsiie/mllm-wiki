/**
 * TTS 提供商抽象层
 *
 * 支持：
 *   - OpenAI tts-1 / tts-1-hd（双音色 alloy / onyx）
 *   - 自定义 OpenAI 兼容端点（同样的 /v1/audio/speech API）
 *
 * 每个 DialogueLine 独立调用 TTS，返回 base64 mp3 数据。
 * 前端使用 Web Audio API 或 <audio> 标签顺序播放各段。
 *
 * 注意：浏览器中无法直接拼接 mp3 二进制，因此本层只负责
 * 返回每段音频的 blob URL；播放器组件负责顺序播放。
 */

import { getHttpFetch } from "./tauri-fetch"

// ─── 配置类型 ────────────────────────────────────────────────────────────────

export type TtsProvider = "openai" | "custom" | "none"

/** OpenAI TTS 支持的音色 */
export type OpenAiVoice =
  | "alloy"
  | "echo"
  | "fable"
  | "onyx"
  | "nova"
  | "shimmer"

export interface TtsConfig {
  /** TTS 提供商。"none" = 关闭 TTS，只展示脚本。 */
  provider: TtsProvider
  /** OpenAI API Key，custom 端点也可复用此字段 */
  apiKey: string
  /** 自定义端点根地址，例如 "http://localhost:8000/v1"。provider=openai 时忽略。 */
  customEndpoint: string
  /** 模型名称。OpenAI 默认 tts-1；自定义端点按实际填写。 */
  model: string
  /** 主持人 A 的音色 */
  voiceA: OpenAiVoice
  /** 主持人 B 的音色 */
  voiceB: OpenAiVoice
  /** 语速 0.25–4.0，默认 1.0 */
  speed: number
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  provider: "none",
  apiKey: "",
  customEndpoint: "",
  model: "tts-1",
  voiceA: "alloy",
  voiceB: "onyx",
  speed: 1.0,
}

// ─── 单段 TTS 合成 ────────────────────────────────────────────────────────────

export interface TtsSegmentResult {
  /** Blob URL，可直接赋值给 <audio src> */
  blobUrl: string
  /** 原始 ArrayBuffer，用于未来拼接 */
  buffer: ArrayBuffer
}

/**
 * 合成单条台词，返回 mp3 Blob URL。
 * 内部走 tauri-plugin-http（Rust fetch），绕过 CORS 限制。
 */
export async function synthesizeLine(
  text: string,
  speaker: "A" | "B",
  config: TtsConfig,
  signal?: AbortSignal,
): Promise<TtsSegmentResult> {
  if (config.provider === "none") {
    throw new Error("TTS is disabled. Set a TTS provider in Settings → Audio.")
  }

  const voice = speaker === "A" ? config.voiceA : config.voiceB
  const model = config.model || "tts-1"
  const speed = Math.max(0.25, Math.min(4.0, config.speed || 1.0))

  const baseUrl =
    config.provider === "custom"
      ? config.customEndpoint.replace(/\/$/, "")
      : "https://api.openai.com/v1"

  const url = `${baseUrl}/audio/speech`

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  }

  const body = {
    model,
    input: text,
    voice,
    response_format: "mp3",
    speed,
  }

  const httpFetch = await getHttpFetch()
  const response = await httpFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const errText = await response.text()
      if (errText) detail += `: ${errText}`
    } catch {
      // ignore
    }
    throw new Error(`TTS request failed — ${detail}`)
  }

  const buffer = await response.arrayBuffer()
  const blob = new Blob([buffer], { type: "audio/mpeg" })
  const blobUrl = URL.createObjectURL(blob)

  return { blobUrl, buffer }
}

// ─── 批量合成 ────────────────────────────────────────────────────────────────

export interface SynthesisProgress {
  completed: number
  total: number
  currentSpeaker: "A" | "B"
  currentText: string
}

export interface SynthesisResult {
  /** 每段的 blobUrl，与 lines 一一对应 */
  segmentUrls: string[]
  /** 每段 ArrayBuffer（保留给未来的本地拼接） */
  buffers: ArrayBuffer[]
}

/**
 * 批量合成脚本所有段落。
 * 串行执行（避免并发超限），通过 onProgress 回调汇报进度。
 */
export async function synthesizeScript(
  lines: Array<{ speaker: "A" | "B"; text: string }>,
  config: TtsConfig,
  onProgress?: (progress: SynthesisProgress) => void,
  signal?: AbortSignal,
): Promise<SynthesisResult> {
  const segmentUrls: string[] = []
  const buffers: ArrayBuffer[] = []

  for (let i = 0; i < lines.length; i++) {
    if (signal?.aborted) {
      throw new Error("TTS synthesis cancelled")
    }

    const line = lines[i]
    onProgress?.({
      completed: i,
      total: lines.length,
      currentSpeaker: line.speaker,
      currentText: line.text.slice(0, 60),
    })

    const result = await synthesizeLine(line.text, line.speaker, config, signal)
    segmentUrls.push(result.blobUrl)
    buffers.push(result.buffer)
  }

  onProgress?.({
    completed: lines.length,
    total: lines.length,
    currentSpeaker: "A",
    currentText: "",
  })

  return { segmentUrls, buffers }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 释放所有 Blob URL，防止内存泄漏 */
export function revokeBlobUrls(urls: string[]): void {
  for (const url of urls) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // ignore
    }
  }
}

/** 估算单行 TTS 时长（秒）。中文约 4 字/秒，英文约 2.5 词/秒，乘以语速倒数。 */
export function estimateLineDuration(text: string, speed = 1.0): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const otherWords = text.replace(/[\u4e00-\u9fff]/g, "").trim().split(/\s+/).filter(Boolean).length
  const seconds = chineseChars / 4 + otherWords / 2.5
  return seconds / speed
}

/** 返回 TTS 提供商的可读名称 */
export function ttsProviderLabel(provider: TtsProvider): string {
  switch (provider) {
    case "openai": return "OpenAI TTS"
    case "custom": return "Custom Endpoint"
    case "none": return "Disabled"
  }
}

/** OpenAI 常用音色列表（供 UI 下拉） */
export const OPENAI_VOICES: Array<{ value: OpenAiVoice; label: string }> = [
  { value: "alloy", label: "Alloy（中性）" },
  { value: "echo", label: "Echo（男声）" },
  { value: "fable", label: "Fable（英式）" },
  { value: "onyx", label: "Onyx（低沉）" },
  { value: "nova", label: "Nova（女声）" },
  { value: "shimmer", label: "Shimmer（温柔）" },
]
