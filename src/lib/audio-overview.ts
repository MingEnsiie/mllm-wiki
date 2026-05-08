/**
 * Audio Overview — 双主持人播客脚本生成
 *
 * 流程：
 *   1. 读取 scope 内的 wiki/sources/*.md 摘要 + 关键主题
 *   2. LLM 一步生成对白脚本（JSON 数组）
 *   3. 持久化到 wiki/studio/audio/<id>/script.json + script.md
 *
 * 不依赖 Tauri 命令，全部走 readFile / writeFile FS 抽象。
 */

import { streamChat } from "./llm-client"
import type { LlmConfig } from "@/stores/wiki-store"
import { readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "./path-utils"
import { buildLanguageDirective } from "./output-language"
import type { OutputLanguage } from "@/stores/wiki-store"

// ─── 公共类型 ────────────────────────────────────────────────────────────────

export type AudioStyle = "deep-dive" | "brief" | "debate"

export interface DialogueLine {
  speaker: "A" | "B"
  text: string
}

export interface AudioScript {
  id: string
  title: string
  style: AudioStyle
  scopeSources: string[]
  lines: DialogueLine[]
  /** 生成时间戳 ISO string */
  createdAt: string
  /** 总字符数，用于估算时长（中文~150字/分钟，英文~130词/分钟） */
  totalChars: number
}

// ─── 脚本生成 ────────────────────────────────────────────────────────────────

/** 最大上下文字符数（留给脚本生成 prompt 用） */
const MAX_SOURCE_CHARS = 40_000

/**
 * 读取 sources guide 文件内容，合并为 context 字符串。
 * 优先读 wiki/sources/<slug>.md（含 frontmatter 摘要），
 * 回退到 raw/sources/<filename>（截断前 4000 字）。
 */
async function buildSourceContext(
  projectPath: string,
  scopeSources: string[],
): Promise<string> {
  const pp = normalizePath(projectPath)
  const parts: string[] = []
  let totalChars = 0

  for (const fileName of scopeSources) {
    if (totalChars >= MAX_SOURCE_CHARS) break

    // 1. 优先读 wiki/sources guide（有摘要 frontmatter）
    const slug = fileName
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
    let content = ""
    try {
      content = await readFile(`${pp}/wiki/sources/${slug}.md`)
    } catch {
      // 回退：读原始 source，截断
      try {
        const raw = await readFile(`${pp}/raw/sources/${fileName}`)
        content = raw.slice(0, 4000)
      } catch {
        continue
      }
    }

    const excerpt = content.slice(0, MAX_SOURCE_CHARS - totalChars)
    parts.push(`### 来源：${fileName}\n\n${excerpt}`)
    totalChars += excerpt.length
  }

  return parts.join("\n\n---\n\n")
}

/** 根据风格生成 prompt */
function buildScriptPrompt(
  context: string,
  style: AudioStyle,
  langDirective: string,
): string {
  const styleDesc = {
    "deep-dive": "深度探讨：两位主持人（A和B）进行深度的学术性对话，详细展开每个核心概念，适合专业听众。对话应有来回讨论、追问、类比和具体例子，时长约8-12分钟（约1500-2000字）。",
    "brief": "简明概述：两位主持人（A和B）进行简洁友好的对话，快速覆盖最重要的要点，适合忙碌的听众。时长约3-5分钟（约600-900字）。",
    "debate": "辩论式：主持人A持支持/正向观点，主持人B持质疑/批评观点，双方围绕核心议题展开有建设性的辩论。时长约6-8分钟（约1000-1500字）。",
  }[style]

  return `你是一位专业的播客制作人。请根据以下资料内容，生成一段双主持人播客对白脚本。

## 风格要求
${styleDesc}

## 格式要求
严格以 JSON 数组格式输出，每个元素包含 speaker（"A" 或 "B"）和 text（该主持人的台词）：
[
  {"speaker": "A", "text": "开场白..."},
  {"speaker": "B", "text": "回应..."},
  ...
]

**只输出 JSON 数组，不要任何前言、解释或 markdown 代码块标记。**

## 对话要求
- 开场介绍主题，结尾总结要点
- 语言自然口语化，像真实播客而非论文朗读
- 两位主持人要有明显的互动（提问、追问、表示认同/异议）
- 引用资料中的具体概念、数据或例子来支撑观点
${langDirective ? `- ${langDirective}` : ""}

## 资料内容

${context}`
}

/** 从 LLM 输出中提取 JSON 数组 */
function parseDialogueLines(raw: string): DialogueLine[] {
  // 尝试直接解析
  const trimmed = raw.trim()
  // 去掉可能的 markdown 代码块
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()

  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error("Not an array")
    return parsed
      .filter(
        (item): item is DialogueLine =>
          typeof item === "object" &&
          item !== null &&
          (item.speaker === "A" || item.speaker === "B") &&
          typeof item.text === "string" &&
          item.text.trim().length > 0,
      )
  } catch {
    // 回退：尝试提取 [...] 块
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        const parsed2 = JSON.parse(match[0])
        if (Array.isArray(parsed2)) {
          return parsed2.filter(
            (item): item is DialogueLine =>
              typeof item === "object" &&
              item !== null &&
              (item.speaker === "A" || item.speaker === "B") &&
              typeof item.text === "string" &&
              item.text.trim().length > 0,
          )
        }
      } catch {
        // ignore
      }
    }
    throw new Error(`Failed to parse dialogue script from LLM output. Raw: ${raw.slice(0, 200)}`)
  }
}

/** 将脚本转换为 Markdown 文本（用于预览 / 持久化） */
export function scriptToMarkdown(script: AudioScript): string {
  const styleLabel = { "deep-dive": "Deep Dive", "brief": "Brief", "debate": "Debate" }[script.style]
  const lines = script.lines
    .map((l) => `**${l.speaker === "A" ? "🎙️ 主持人 A" : "🎤 主持人 B"}**：${l.text}`)
    .join("\n\n")

  return `---
type: audio-script
title: ${script.title}
style: ${script.style}
scope_sources: [${script.scopeSources.map((s) => JSON.stringify(s)).join(", ")}]
created: ${script.createdAt.slice(0, 10)}
total_chars: ${script.totalChars}
---

# 🎧 ${script.title}

**风格**：${styleLabel} · **时长估算**：约 ${Math.round(script.totalChars / 200)} 分钟

---

${lines}
`
}

export interface GenerateScriptOptions {
  projectPath: string
  scopeSources: string[]
  style: AudioStyle
  llmConfig: LlmConfig
  outputLanguage?: OutputLanguage
  /** 进度回调（流式 token） */
  onToken?: (token: string) => void
  /** 取消信号 */
  signal?: AbortSignal
}

export interface GenerateScriptResult {
  script: AudioScript
  /** 持久化的 script.json 路径 */
  jsonPath: string
  /** 持久化的 script.md 路径 */
  mdPath: string
}

/**
 * 生成播客脚本并持久化到 wiki/studio/audio/<id>/
 */
export async function generateAudioScript(
  opts: GenerateScriptOptions,
): Promise<GenerateScriptResult> {
  const {
    projectPath,
    scopeSources,
    style,
    llmConfig,
    outputLanguage = "auto",
    onToken,
    signal,
  } = opts

  const pp = normalizePath(projectPath)

  // 1. 构建上下文
  const context = await buildSourceContext(pp, scopeSources)
  if (!context.trim()) {
    throw new Error("No source content found. Please ingest sources first.")
  }

  // 2. 构建语言指令
  const sampleText = context.slice(0, 300)
  const langDirective = buildLanguageDirective(sampleText, outputLanguage)

  // 3. 生成脚本 prompt
  const prompt = buildScriptPrompt(context, style, langDirective)

  // 4. 调用 LLM（非流式累积）
  let rawOutput = ""
  await new Promise<void>((resolve, reject) => {
    streamChat(
      llmConfig,
      [{ role: "user", content: prompt }],
      {
        onToken: (token) => {
          rawOutput += token
          onToken?.(token)
        },
        onDone: resolve,
        onError: reject,
      },
      signal,
    )
  })

  // 5. 解析 JSON
  const lines = parseDialogueLines(rawOutput)
  if (lines.length < 4) {
    throw new Error(`Script too short (${lines.length} lines). LLM may have failed to follow the format.`)
  }

  // 6. 构造 AudioScript 对象
  const id = `audio-${Date.now()}`
  const titleSource = scopeSources.length === 1
    ? scopeSources[0].replace(/\.[^.]+$/, "")
    : `${scopeSources.length} Sources`
  const styleLabel = { "deep-dive": "Deep Dive", "brief": "Brief", "debate": "Debate" }[style]
  const title = `${styleLabel}: ${titleSource}`
  const totalChars = lines.reduce((sum, l) => sum + l.text.length, 0)

  const script: AudioScript = {
    id,
    title,
    style,
    scopeSources,
    lines,
    createdAt: new Date().toISOString(),
    totalChars,
  }

  // 7. 持久化
  const dir = `${pp}/wiki/studio/audio/${id}`
  const jsonPath = `${dir}/script.json`
  const mdPath = `${dir}/script.md`

  await writeFile(jsonPath, JSON.stringify(script, null, 2))
  await writeFile(mdPath, scriptToMarkdown(script))

  return { script, jsonPath, mdPath }
}

// ─── 脚本加载 ────────────────────────────────────────────────────────────────

/** 列出项目下所有已生成的音频脚本（降序，最新在前） */
export async function listAudioScripts(projectPath: string): Promise<AudioScript[]> {
  const pp = normalizePath(projectPath)
  const baseDir = `${pp}/wiki/studio/audio`

  // 用 listDirectory 枚举子目录
  const { listDirectory } = await import("@/commands/fs")
  let dirs: import("@/types/wiki").FileNode[]
  try {
    const tree = await listDirectory(baseDir)
    dirs = tree.filter((n) => n.is_dir)
  } catch {
    return []
  }

  const scripts: AudioScript[] = []
  for (const dir of dirs) {
    try {
      const raw = await readFile(`${dir.path}/script.json`)
      const parsed = JSON.parse(raw) as AudioScript
      scripts.push(parsed)
    } catch {
      // skip corrupt entries
    }
  }

  return scripts.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/** 删除一个音频脚本目录 */
export async function deleteAudioScript(projectPath: string, id: string): Promise<void> {
  const pp = normalizePath(projectPath)
  const { deleteFile } = await import("@/commands/fs")
  await deleteFile(`${pp}/wiki/studio/audio/${id}`)
}
