import { create } from "zustand"
import type {
  PaperContext,
  PaperFile,
  PaperQaStatus,
  PaperQueryDone,
} from "@/types/paperqa"

export interface PaperQuerySession {
  id: string
  question: string
  answer: string
  contexts: PaperContext[]
  done: PaperQueryDone | null
  error: string | null
  stage: string
  running: boolean
  createdAt: number
}

export interface PaperQaConfig {
  /** Absolute path to python (e.g. .wiki/bin/python). */
  pythonPath: string
  /** Paper directory to index/query. */
  paperDir: string
  /** Optional: override the bridge script path. */
  bridgePath?: string
  /** Optional: extra PYTHONPATH entries. */
  pythonPathExtra?: string[]
}

export interface PaperQaStoreState {
  config: PaperQaConfig
  status: PaperQaStatus
  papers: PaperFile[]
  sessions: PaperQuerySession[]
  activeSessionId: string | null
  stderrTail: string[]

  setConfig: (patch: Partial<PaperQaConfig>) => void
  setStatus: (s: PaperQaStatus) => void
  setPapers: (ps: PaperFile[]) => void
  addSession: (s: PaperQuerySession) => void
  updateSession: (id: string, patch: Partial<PaperQuerySession>) => void
  setActiveSession: (id: string | null) => void
  appendAnswer: (id: string, chunk: string) => void
  pushContexts: (id: string, contexts: PaperContext[]) => void
  pushStderr: (line: string) => void
}

const DEFAULT_CONFIG: PaperQaConfig = {
  pythonPath: "",
  paperDir: "",
}

const MAX_STDERR_LINES = 200

export const usePaperQaStore = create<PaperQaStoreState>((set) => ({
  config: DEFAULT_CONFIG,
  status: { running: false, pid: null, python: null, bridge: null },
  papers: [],
  sessions: [],
  activeSessionId: null,
  stderrTail: [],

  setConfig: (patch) =>
    set((s) => ({ config: { ...s.config, ...patch } })),
  setStatus: (status) => set({ status }),
  setPapers: (papers) => set({ papers }),
  addSession: (session) =>
    set((s) => ({
      sessions: [session, ...s.sessions].slice(0, 50),
      activeSessionId: session.id,
    })),
  updateSession: (id, patch) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, ...patch } : sess
      ),
    })),
  setActiveSession: (activeSessionId) => set({ activeSessionId }),
  appendAnswer: (id, chunk) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, answer: sess.answer + chunk } : sess
      ),
    })),
  pushContexts: (id, contexts) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, contexts } : sess
      ),
    })),
  pushStderr: (line) =>
    set((s) => ({
      stderrTail: [...s.stderrTail, line].slice(-MAX_STDERR_LINES),
    })),
}))

export const PAPERQA_STORE_KEY = "paperqa.config"
