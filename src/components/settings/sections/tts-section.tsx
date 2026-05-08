/**
 * TTS 设置区 — 配置 Audio Overview 的语音合成提供商
 */

import { useTranslation } from "react-i18next"
import type { SettingsDraft, DraftSetter } from "../settings-types"
import { OPENAI_VOICES, type OpenAiVoice } from "@/lib/tts-providers"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium leading-none">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function TtsSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.sections.tts.title", "Audio Overview (TTS)")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.tts.description", "配置 Audio Overview 的语音合成服务。选择 \"Disabled\" 则只展示脚本文本，不进行语音合成。")}
        </p>
      </div>

      {/* 提供商选择 */}
      <FieldRow label={t("settings.sections.tts.provider", "TTS 提供商")}>
        <select
          value={draft.ttsProvider}
          onChange={(e) => setDraft("ttsProvider", e.target.value as SettingsDraft["ttsProvider"])}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="none">{t("settings.sections.tts.providerNone", "Disabled（仅展示脚本）")}</option>
          <option value="openai">{t("settings.sections.tts.providerOpenai", "OpenAI TTS")}</option>
          <option value="custom">{t("settings.sections.tts.providerCustom", "自定义兼容端点")}</option>
        </select>
      </FieldRow>

      {draft.ttsProvider !== "none" && (
        <>
          {/* API Key */}
          <FieldRow
            label={t("settings.sections.tts.apiKey", "API Key")}
            hint={
              draft.ttsProvider === "custom"
                ? t("settings.sections.tts.apiKeyHintCustom", "如端点不需要鉴权可留空")
                : t("settings.sections.tts.apiKeyHint", "与 LLM 同一个 OpenAI key 即可")
            }
          >
            <input
              type="password"
              value={draft.ttsApiKey}
              onChange={(e) => setDraft("ttsApiKey", e.target.value)}
              placeholder="sk-..."
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </FieldRow>

          {/* 自定义端点 */}
          {draft.ttsProvider === "custom" && (
            <FieldRow
              label={t("settings.sections.tts.customEndpoint", "自定义端点")}
              hint={t("settings.sections.tts.customEndpointHint", "OpenAI 兼容的 /v1 根地址，例如 http://localhost:8000/v1")}
            >
              <input
                type="text"
                value={draft.ttsCustomEndpoint}
                onChange={(e) => setDraft("ttsCustomEndpoint", e.target.value)}
                placeholder="http://localhost:8000/v1"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </FieldRow>
          )}

          {/* 模型 */}
          <FieldRow
            label={t("settings.sections.tts.model", "模型")}
            hint={
              draft.ttsProvider === "openai"
                ? t("settings.sections.tts.modelHintOpenai", "tts-1（速度快）或 tts-1-hd（质量更高）")
                : t("settings.sections.tts.modelHintCustom", "按实际端点填写")
            }
          >
            {draft.ttsProvider === "openai" ? (
              <select
                value={draft.ttsModel}
                onChange={(e) => setDraft("ttsModel", e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="tts-1">tts-1（快速）</option>
                <option value="tts-1-hd">tts-1-hd（高清）</option>
              </select>
            ) : (
              <input
                type="text"
                value={draft.ttsModel}
                onChange={(e) => setDraft("ttsModel", e.target.value)}
                placeholder="tts-1"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
          </FieldRow>

          {/* 音色选择 */}
          <div className="grid grid-cols-2 gap-4">
            <FieldRow label={t("settings.sections.tts.voiceA", "主持人 A 音色")}>
              <select
                value={draft.ttsVoiceA}
                onChange={(e) => setDraft("ttsVoiceA", e.target.value as OpenAiVoice)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {OPENAI_VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label={t("settings.sections.tts.voiceB", "主持人 B 音色")}>
              <select
                value={draft.ttsVoiceB}
                onChange={(e) => setDraft("ttsVoiceB", e.target.value as OpenAiVoice)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {OPENAI_VOICES.map((v) => (
                  <option key={v.value} value={v.value}>{v.label}</option>
                ))}
              </select>
            </FieldRow>
          </div>

          {/* 语速 */}
          <FieldRow
            label={t("settings.sections.tts.speed", "语速")}
            hint={t("settings.sections.tts.speedHint", "范围 0.25–4.0，默认 1.0。播放器里也可以实时调整。")}
          >
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.25}
                max={2.0}
                step={0.25}
                value={draft.ttsSpeed}
                onChange={(e) => setDraft("ttsSpeed", parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm tabular-nums w-8 text-right">{draft.ttsSpeed}x</span>
            </div>
          </FieldRow>

          {/* 费用提示 */}
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
              {t("settings.sections.tts.costHeading", "费用提示")}
            </p>
            <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 list-disc list-inside">
              <li>{t("settings.sections.tts.costPoint1", "每行台词调用一次 TTS API（通常每次 0.01–0.05 元）")}</li>
              <li>{t("settings.sections.tts.costPoint2", "一集 Deep Dive 脚本约 30–60 行，合计约 ¥0.5–2")}</li>
              <li>{t("settings.sections.tts.costPoint3", "脚本一旦生成，再次播放不重复计费（前端缓存）")}</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
