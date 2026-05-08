import { useWikiStore } from "@/stores/wiki-store"
import { detectLanguage } from "./detect-language"
import { getLanguagePromptName } from "./language-metadata"

/**
 * Get the effective output language for LLM content generation.
 *
 * If user has explicitly set an outputLanguage, use it.
 * Otherwise (auto), fall back to detecting the language from the given text.
 *
 * IMPORTANT: The fallbackText should be the USER's query or existing wiki
 * content — NOT the source document being ingested. Detecting from source
 * content causes the entire wiki to be written in the source document's
 * language (e.g. an Indonesian paper → Indonesian wiki pages).
 */
export function getOutputLanguage(fallbackText: string = "", configuredOverride?: string): string {
  const configured = configuredOverride ?? useWikiStore.getState().outputLanguage
  if (configured && configured !== "auto") {
    return configured
  }
  // In auto mode: detect from fallback text, but treat source-document-
  // style long text as unreliable — cap sample to 300 chars so a short
  // user query drives the detection rather than a multi-page source body.
  const sample = (fallbackText || "").slice(0, 300).trim()
  return detectLanguage(sample || "English")
}

/**
 * Build a strong language directive to inject into system prompts.
 */
export function buildLanguageDirective(fallbackText: string = "", configuredOverride?: string): string {
  const lang = getOutputLanguage(fallbackText, configuredOverride)
  const promptLang = getLanguagePromptName(lang)
  return [
    `## ⚠️ MANDATORY OUTPUT LANGUAGE: ${promptLang}`,
    "",
    `You MUST write your entire response (including wiki page titles, content, descriptions, summaries, and any generated text) in **${promptLang}**.`,
    `The source material or wiki content may be in a different language, but this is IRRELEVANT to your output language.`,
    `Ignore the language of any source content. Generate everything in ${promptLang} only.`,
    `Proper nouns should use standard ${promptLang} transliteration when appropriate.`,
    `DO NOT use any other language. This overrides all other instructions.`,
  ].join("\n")
}

/**
 * Short reminder version — for placing right before user's current message.
 */
export function buildLanguageReminder(fallbackText: string = ""): string {
  const lang = getOutputLanguage(fallbackText)
  return `REMINDER: All output must be in ${getLanguagePromptName(lang)}. Do not use any other language.`
}
