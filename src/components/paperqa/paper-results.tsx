import type { PaperQuerySession } from "@/stores/paperqa-store"
import { usePaperQaStore } from "@/stores/paperqa-store"

interface Props {
  session: PaperQuerySession | null
  allSessions: PaperQuerySession[]
}

export function PaperResults({ session, allSessions }: Props) {
  const setActiveSession = usePaperQaStore((s) => s.setActiveSession)

  if (!session) {
    if (allSessions.length === 0) {
      return (
        <div className="p-8 text-center text-sm text-muted-foreground">
          尚无查询记录。输入问题后点击「运行查询」开始。
        </div>
      )
    }
    return (
      <div className="p-4">
        <h3 className="text-xs uppercase text-muted-foreground mb-2">
          历史查询
        </h3>
        <ul className="space-y-1">
          {allSessions.map((s) => (
            <li key={s.id}>
              <button
                className="w-full text-left text-sm p-2 rounded hover:bg-accent truncate"
                onClick={() => setActiveSession(s.id)}
              >
                {s.question}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="border-b pb-3">
        <div className="text-xs text-muted-foreground mb-1">问题</div>
        <div className="text-sm font-medium">{session.question}</div>
      </div>

      {session.error && (
        <div className="p-3 bg-red-50 text-red-700 text-xs rounded border border-red-200 whitespace-pre-wrap">
          {session.error}
        </div>
      )}

      <div>
        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
          <span>回答</span>
          {session.running && (
            <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
          )}
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">
          {session.answer || (
            <span className="text-muted-foreground italic">
              {session.running ? "生成中…" : "（无回答）"}
            </span>
          )}
        </div>
      </div>

      {session.contexts.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">
            引用来源 ({session.contexts.length})
          </div>
          <div className="space-y-2">
            {session.contexts.map((ctx, i) => (
              <div
                key={i}
                className="border rounded p-3 text-xs bg-muted/30"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">
                    {ctx.doc_title || ctx.doc_docname || "unknown"}
                  </span>
                  <span className="ml-auto px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
                    评分: {ctx.score}/10
                  </span>
                </div>
                {ctx.doc_citation && (
                  <div className="text-muted-foreground text-[11px] mb-1">
                    {ctx.doc_citation}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{ctx.context}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {session.done && (
        <div className="text-[11px] text-muted-foreground border-t pt-2">
          cost: ${session.done.cost ?? 0} · tokens: {JSON.stringify(session.done.token_counts ?? {})}
        </div>
      )}
    </div>
  )
}