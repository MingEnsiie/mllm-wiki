import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type {
  PaperQaEvent,
  PaperQaStartArgs,
  PaperQaStartResult,
  PaperQaStatus,
} from "@/types/paperqa"

export async function paperqaStart(
  args: PaperQaStartArgs
): Promise<PaperQaStartResult> {
  return invoke<PaperQaStartResult>("paperqa_start", {
    args: {
      python_path: args.pythonPath,
      bridge_path: args.bridgePath,
      python_path_extra: args.pythonPathExtra,
    },
  })
}

export async function paperqaStop(): Promise<void> {
  return invoke<void>("paperqa_stop")
}

export async function paperqaStatus(): Promise<PaperQaStatus> {
  return invoke<PaperQaStatus>("paperqa_status")
}

export async function paperqaSend(
  id: string,
  method: string,
  params?: Record<string, unknown>
): Promise<void> {
  return invoke<void>("paperqa_send", {
    args: { id, method, params: params ?? {} },
  })
}

/** Subscribe to events for a given request id. Returns an unlisten fn. */
export async function listenPaperQaEvents(
  requestId: string,
  onEvent: (ev: PaperQaEvent) => void
): Promise<UnlistenFn> {
  return listen<string>(`paperqa:${requestId}`, ({ payload }) => {
    try {
      const parsed = JSON.parse(payload) as PaperQaEvent
      onEvent(parsed)
    } catch {
      // ignore parse errors
    }
  })
}

export async function listenPaperQaStderr(
  onLine: (line: string) => void
): Promise<UnlistenFn> {
  return listen<string>("paperqa:stderr", ({ payload }) => onLine(payload))
}

/** Make a request/response style call that collects events until `done` or `error`. */
export async function paperqaCall<T = unknown>(
  method: string,
  params?: Record<string, unknown>,
  onEvent?: (ev: PaperQaEvent) => void
): Promise<T> {
  const id = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    let result: unknown = undefined
    let unlisten: UnlistenFn | null = null
    listenPaperQaEvents(id, (ev) => {
      onEvent?.(ev)
      if (ev.type === "result") {
        result = ev.data
      } else if (ev.type === "done") {
        unlisten?.()
        resolve((result ?? ev.data) as T)
      } else if (ev.type === "error") {
        unlisten?.()
        reject(new Error(ev.data))
      }
    })
      .then((fn) => {
        unlisten = fn
        return paperqaSend(id, method, params)
      })
      .catch(reject)
  })
}
