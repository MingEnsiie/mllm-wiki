export interface PaperQaStartArgs {
  pythonPath: string
  bridgePath?: string
  pythonPathExtra?: string[]
}

export interface PaperQaStartResult {
  ok: boolean
  pid: number | null
  python: string
  bridge: string
  error: string | null
}

export interface PaperQaStatus {
  running: boolean
  pid: number | null
  python: string | null
  bridge: string | null
}

export interface PaperFile {
  path: string
  name: string
  size: number
  rel: string
}

export interface PaperContext {
  context: string
  score: number
  text_name?: string
  doc_citation?: string
  doc_docname?: string
  doc_doi?: string
  doc_title?: string
}

export interface PaperQueryDone {
  answer: string
  formatted_answer?: string
  cost?: number
  token_counts?: Record<string, unknown>
  references?: string
}

export interface PaperAddResult {
  docname: string
  title?: string
  doi?: string
  authors?: string[]
  year?: number
  journal?: string
  citation?: string
  citation_count?: number
  source_quality?: number
  is_retracted?: boolean
}

export type PaperQaEvent =
  | { id: string; type: "ready"; data: { pid: number } }
  | { id: string; type: "chunk"; data: string }
  | { id: string; type: "progress"; data: Record<string, unknown> }
  | { id: string; type: "contexts"; data: PaperContext[] }
  | { id: string; type: "result"; data: unknown }
  | { id: string; type: "done"; data: Record<string, unknown> }
  | { id: string; type: "error"; data: string }
