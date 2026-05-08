/**
 * TTS 提供商抽象层
 *
 * 支持：
 *   - OpenAI tts-1 / tts-1-hd（双音色 alloy / onyx）
 *   - 自定义 OpenAI 兼容端点（/v1/audio/speech）
 *   - MiMo-V2.5-TTS（Chat Completions + streaming PCM16，自动检测 model 含 "mimo"）
 *
 * 每个 DialogueLine 独立调用 TTS，返回 blob URL。
 * 前端使用 <audio> 标签顺序播放各段。
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
    /** 自定义端点根地址，例如 "https://token-plan-cn.xiaomimimo.com/v1"。provider=openai 时忽略。 */
    customEndpoint: string
    /**
     * 完整的语音合成请求路径（可选，仅用于非 MiMo 的自定义端点）。
     * 留空时自动拼接 customEndpoint + "/audio/speech"。
     */
    customSpeechUrl: string
    /** 模型名称。OpenAI 默认 tts-1；MiMo 填 MiMo-V2.5-TTS。 */
    model: string
    /** 主持人 A 的音色 */
    voiceA: string
    /** 主持人 B 的音色 */
    voiceB: string
    /** 语速 0.25-4.0，默认 1.0 */
    speed: number
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
    provider: "none",
    apiKey: "",
    customEndpoint: "",
    customSpeechUrl: "",
    model: "tts-1",
    voiceA: "alloy",
    voiceB: "onyx",
    speed: 1.0,
}

/** MiMo-V2.5-TTS 可用音色列表（来自 API 返回） */
export const MIMO_VOICES: Array<{ value: string; label: string; lang?: string }> = [
    // ── 中文 ──
    { value: "mimo_default", label: "默认音色", lang: "zh" },
    { value: "冰糖", label: "冰糖", lang: "zh" },
    { value: "茉莉", label: "茉莉", lang: "zh" },
    { value: "苏打", label: "苏打", lang: "zh" },
    { value: "白桦", label: "白桦", lang: "zh" },
    // ── English ──
    { value: "Mia", label: "Mia（Female）", lang: "en" },
    { value: "Chloe", label: "Chloe（Female）", lang: "en" },
    { value: "Milo", label: "Milo（Male）", lang: "en" },
    { value: "Dean", label: "Dean（Male）", lang: "en" },
]

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 检测当前配置是否为 MiMo Chat Completions 模式 */
function isMimoModel(config: TtsConfig): boolean {
    return (
        config.provider === "custom" &&
        config.model.toLowerCase().includes("mimo")
    )
}

/** base64 字符串转 Uint8Array */
function base64ToUint8Array(b64: string): Uint8Array {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

/**
 * PCM16LE Int16Array 编码为 WAV ArrayBuffer。
 * 采样率 24000 Hz，单声道，16-bit。
 */
function pcm16ToWav(pcm16: Int16Array, sampleRate = 24000, channels = 1): ArrayBuffer {
    const dataLength = pcm16.length * 2
    const buffer = new ArrayBuffer(44 + dataLength)
    const view = new DataView(buffer)

    const writeStr = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
    }

    writeStr(0, "RIFF")
    view.setUint32(4, 36 + dataLength, true)
    writeStr(8, "WAVE")
    writeStr(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, channels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * channels * 2, true)
    view.setUint16(32, channels * 2, true)
    view.setUint16(34, 16, true)
    writeStr(36, "data")
    view.setUint32(40, dataLength, true)
    new Uint8Array(buffer, 44).set(new Uint8Array(pcm16.buffer, pcm16.byteOffset, dataLength))

    return buffer
}

// ─── 单段 TTS 合成 ────────────────────────────────────────────────────────────

export interface TtsSegmentResult {
    /** Blob URL，可直接赋值给 audio src */
    blobUrl: string
    /** 原始 ArrayBuffer */
    buffer: ArrayBuffer
}

/**
 * MiMo-V2.5-TTS 专用合成函数。
 * POST /chat/completions + audio 参数，流式 SSE 返回 base64 PCM16，转为 WAV。
 */
async function synthesizeMimoLine(
    text: string,
    voice: string,
    config: TtsConfig,
    signal?: AbortSignal,
): Promise<TtsSegmentResult> {
    const baseUrl = config.customEndpoint.replace(/\/$/, "")
    const url = `${baseUrl}/chat/completions`

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "text/event-stream",
    }

    const body = {
        model: config.model.toLowerCase(),  // MiMo API 要求全小写
        messages: [
            { role: "user", content: "请用自然流畅的语气朗读以下文字。" },
            { role: "assistant", content: text },
        ],
        audio: {
            format: "pcm16",
            voice,
        },
        stream: true,
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
        throw new Error(`MiMo TTS request failed — ${detail}\n[URL: ${url}]`)
    }

    const pcm16Chunks: Int16Array[] = []

    const parseSseLine = (line: string) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) return
        const dataStr = trimmed.slice(5).trim()
        if (dataStr === "[DONE]") return
        try {
            const parsed = JSON.parse(dataStr)
            const audioData = parsed?.choices?.[0]?.delta?.audio?.data
            if (typeof audioData === "string" && audioData.length > 0) {
                const pcmBytes = base64ToUint8Array(audioData)
                const pcm16 = new Int16Array(
                    pcmBytes.buffer,
                    pcmBytes.byteOffset,
                    Math.floor(pcmBytes.byteLength / 2),
                )
                pcm16Chunks.push(pcm16)
            }
        } catch {
            // ignore malformed JSON
        }
    }

    if (response.body) {
        const reader = (response.body as ReadableStream<Uint8Array>).getReader()
        const decoder = new TextDecoder()
        let remainder = ""
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            remainder += decoder.decode(value, { stream: true })
            const lines = remainder.split("\n")
            remainder = lines.pop() ?? ""
            for (const line of lines) parseSseLine(line)
        }
        if (remainder.trim()) parseSseLine(remainder)
    } else {
        const fullText = await response.text()
        for (const line of fullText.split("\n")) parseSseLine(line)
    }

    if (pcm16Chunks.length === 0) {
        throw new Error("MiMo TTS: 未收到任何音频数据，请检查 API Key 和账户余额")
    }

    const totalSamples = pcm16Chunks.reduce((sum, c) => sum + c.length, 0)
    const merged = new Int16Array(totalSamples)
    let offset = 0
    for (const chunk of pcm16Chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
    }

    const wavBuffer = pcm16ToWav(merged, 24000, 1)
    const blob = new Blob([wavBuffer], { type: "audio/wav" })
    const blobUrl = URL.createObjectURL(blob)

    return { blobUrl, buffer: wavBuffer }
}

/**
 * 合成单条台词，返回 Blob URL。
 * 内部走 tauri-plugin-http（Rust fetch），绕过 CORS 限制。
 *
 * - OpenAI / 标准自定义端点：POST /audio/speech → 二进制 mp3
 * - MiMo（model 含 "mimo"）：POST /chat/completions → SSE PCM16 → WAV
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
    const speed = Math.max(0.25, Math.min(4.0, config.speed || 1.0))

    if (isMimoModel(config)) {
        return synthesizeMimoLine(text, voice, config, signal)
    }

    // 标准 OpenAI /audio/speech
    const model = config.model || "tts-1"
    let url: string
    if (config.provider === "custom") {
        url = config.customSpeechUrl?.trim()
            || `${config.customEndpoint.replace(/\/$/, "")}/audio/speech`
    } else {
        url = "https://api.openai.com/v1/audio/speech"
    }

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
        throw new Error(`TTS request failed — ${detail}\n[URL: ${url}]`)
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
    /** 每段 ArrayBuffer */
    buffers: ArrayBuffer[]
}

/**
 * 批量合成脚本所有段落。
 * 串行执行，通过 onProgress 回调汇报进度。
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

// ─── 其他工具函数 ────────────────────────────────────────────────────────────

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

/** 估算单行 TTS 时长（秒） */
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