import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { readFile } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import { useChatStore } from "@/stores/chat-store"
import { ScrollArea } from "@/components/ui/scroll-area"
import { BookOpen, Tag, HelpCircle, Loader2, AlertCircle } from "lucide-react"

export interface SourceGuideData {
  slug: string
  fileName: string
  summary: string
  key_topics: string[]
  suggested_questions: string[]
  generatedAt: string
}

interface SourceGuidePanelProps {
  /** The source file name, e.g. "my-paper.pdf" */
  fileName: string
}

export function SourceGuidePanel({ fileName }: SourceGuidePanelProps) {
  const { t } = useTranslation()
  const activeProject = useWikiStore((s) => s.project)
  const setChatExpanded = useWikiStore((s) => s.setChatExpanded)
  const createConversation = useChatStore((s) => s.createConversation)
  const addMessage = useChatStore((s) => s.addMessage)

  const [guide, setGuide] = useState<SourceGuideData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const slug = fileName.replace(/\.[^.]+$/, "")

  useEffect(() => {
    if (!activeProject) return
    setLoading(true)
    setError(null)
    setGuide(null)

    const guidePath = `${activeProject.path}/.llm-wiki/source-guides/${slug}.json`
    readFile(guidePath)
      .then((raw) => {
        const data = JSON.parse(raw) as SourceGuideData
        setGuide(data)
      })
      .catch(() => {
        setError("no-guide")
      })
      .finally(() => {
        setLoading(false)
      })
  }, [activeProject, slug])

  function handleAskQuestion(question: string) {
    if (!activeProject) return
    createConversation()
    addMessage("user", question)
    setChatExpanded(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2 py-12">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">{t("sourceGuide.loading", "Loading guide...")}</span>
      </div>
    )
  }

  if (error || !guide) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-12 px-6 text-center">
        <AlertCircle className="w-8 h-8 opacity-40" />
        <p className="text-sm font-medium">{t("sourceGuide.noGuide", "No Source Guide yet")}</p>
        <p className="text-xs opacity-70">
          {t(
            "sourceGuide.noGuideHint",
            "Re-ingest this source to generate a guide with summary, key topics, and suggested questions.",
          )}
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-5">
        {/* Summary */}
        {guide.summary && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BookOpen className="w-4 h-4 text-primary" />
              <span>{t("sourceGuide.summary", "Summary")}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{guide.summary}</p>
          </section>
        )}

        {/* Key Topics */}
        {guide.key_topics.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Tag className="w-4 h-4 text-primary" />
              <span>{t("sourceGuide.keyTopics", "Key Topics")}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {guide.key_topics.map((topic) => (
                <span
                  key={topic}
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-xs bg-secondary text-secondary-foreground border border-border"
                >
                  {topic}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Suggested Questions */}
        {guide.suggested_questions.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <HelpCircle className="w-4 h-4 text-primary" />
              <span>{t("sourceGuide.suggestedQuestions", "Suggested Questions")}</span>
            </div>
            <div className="space-y-1.5">
              {guide.suggested_questions.map((q) => (
                <button
                  key={q}
                  onClick={() => handleAskQuestion(q)}
                  className="w-full text-left text-sm px-3 py-2 rounded-md bg-muted hover:bg-accent hover:text-accent-foreground transition-colors border border-transparent hover:border-border"
                >
                  {q}
                </button>
              ))}
            </div>
          </section>
        )}

        {guide.generatedAt && (
          <p className="text-xs text-muted-foreground/50 pt-1">
            {t("sourceGuide.generatedAt", "Generated")}:{" "}
            {new Date(guide.generatedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </ScrollArea>
  )
}
