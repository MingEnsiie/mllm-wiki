"""JSON-RPC bridge: expose paper-qa functionality to the Tauri host.

Protocol (line-delimited JSON, one message per line on stdin/stdout):

Request:
    {"id": "uuid", "method": "...", "params": {...}}

Responses (multiple per request for streaming methods):
    {"id": "uuid", "type": "chunk",    "data": "..."}
    {"id": "uuid", "type": "contexts", "data": [...]}
    {"id": "uuid", "type": "result",   "data": {...}}
    {"id": "uuid", "type": "done",     "data": {...}}
    {"id": "uuid", "type": "error",    "data": "message"}

Methods:
    status      -> {"version": "...", "ok": true}
    add_paper   {"path": "..."}
    list_papers {"paper_dir": "..."}
    search      {"query": "...", "paper_dir": "...", "k": 5}
    query       {"question": "...", "paper_dir": "...", "settings": {...}}
                streams "chunk" events for the answer, then "contexts" and "done"
    cancel      {"target_id": "..."}
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


def emit(msg: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()


def log(msg: str) -> None:
    sys.stderr.write(f"[paperqa-bridge] {msg}\n")
    sys.stderr.flush()


# ---------------------------------------------------------------------------
# paper-qa shims
# ---------------------------------------------------------------------------


def _build_settings(paper_dir: str | None, overrides: dict[str, Any] | None) -> Any:
    from paperqa import Settings

    cfg: dict[str, Any] = {}
    if paper_dir:
        cfg.setdefault("agent", {}).setdefault("index", {})["paper_directory"] = (
            paper_dir
        )
    if overrides:
        # Shallow-merge known top-level overrides to avoid clobbering nested dicts.
        for key, value in overrides.items():
            if key in cfg and isinstance(cfg[key], dict) and isinstance(value, dict):
                cfg[key].update(value)
            else:
                cfg[key] = value
    return Settings(**cfg) if cfg else Settings()


async def handle_status(req_id: str, params: dict[str, Any]) -> None:
    import paperqa

    emit(
        {
            "id": req_id,
            "type": "result",
            "data": {
                "ok": True,
                "version": getattr(paperqa, "__version__", "unknown"),
                "python": sys.version.split()[0],
            },
        }
    )
    emit({"id": req_id, "type": "done", "data": {}})


async def handle_list_papers(req_id: str, params: dict[str, Any]) -> None:
    paper_dir = params.get("paper_dir")
    if not paper_dir:
        emit({"id": req_id, "type": "error", "data": "paper_dir is required"})
        return
    root = Path(paper_dir).expanduser()
    if not root.exists():
        emit({"id": req_id, "type": "result", "data": []})
        emit({"id": req_id, "type": "done", "data": {}})
        return

    exts = {".pdf", ".txt", ".md", ".html", ".docx"}
    files = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix.lower() in exts:
            try:
                stat = p.stat()
                files.append(
                    {
                        "path": str(p),
                        "name": p.name,
                        "size": stat.st_size,
                        "rel": str(p.relative_to(root)),
                    }
                )
            except OSError:
                continue
    emit({"id": req_id, "type": "result", "data": files})
    emit({"id": req_id, "type": "done", "data": {}})


async def handle_add_paper(req_id: str, params: dict[str, Any]) -> None:
    from paperqa import Docs

    path = params.get("path")
    if not path:
        emit({"id": req_id, "type": "error", "data": "path is required"})
        return

    settings = _build_settings(params.get("paper_dir"), params.get("settings"))
    docs = Docs()
    name = await docs.aadd(Path(path).expanduser(), settings=settings)
    if name is None:
        emit({"id": req_id, "type": "error", "data": f"failed to add {path}"})
        return

    doc = docs.docs.get(docs.docnames_to_dockeys.get(name, ""))
    detail: dict[str, Any] = {"docname": name}
    if doc is not None:
        for attr in (
            "title",
            "doi",
            "authors",
            "year",
            "journal",
            "citation",
            "citation_count",
            "source_quality",
            "is_retracted",
        ):
            val = getattr(doc, attr, None)
            if val is not None:
                detail[attr] = val
    emit({"id": req_id, "type": "result", "data": detail})
    emit({"id": req_id, "type": "done", "data": {}})


async def handle_search(req_id: str, params: dict[str, Any]) -> None:
    from paperqa.agents.search import get_directory_index

    query = params.get("query", "")
    paper_dir = params.get("paper_dir")
    k = int(params.get("k", 10))
    if not paper_dir:
        emit({"id": req_id, "type": "error", "data": "paper_dir is required"})
        return

    settings = _build_settings(paper_dir, params.get("settings"))
    index = await get_directory_index(settings=settings)
    results = await index.query(query=query, top_n=k)
    # results are tuples/Docs; normalize
    out = []
    for r in results:
        if hasattr(r, "model_dump"):
            out.append(r.model_dump())
        elif isinstance(r, (list, tuple)) and r:
            first = r[0]
            if hasattr(first, "model_dump"):
                out.append(first.model_dump())
            else:
                out.append(str(first))
        else:
            out.append(str(r))
    emit({"id": req_id, "type": "result", "data": out})
    emit({"id": req_id, "type": "done", "data": {}})


async def handle_query(req_id: str, params: dict[str, Any]) -> None:
    """Run the full agentic RAG pipeline. Streams progress events."""
    from paperqa import agent_query

    question = params.get("question", "")
    paper_dir = params.get("paper_dir")
    if not question or not paper_dir:
        emit(
            {
                "id": req_id,
                "type": "error",
                "data": "question and paper_dir are required",
            }
        )
        return

    settings = _build_settings(paper_dir, params.get("settings"))

    emit({"id": req_id, "type": "progress", "data": {"stage": "starting"}})
    try:
        response = await agent_query(query=question, settings=settings)
    except Exception as exc:
        emit(
            {
                "id": req_id,
                "type": "error",
                "data": f"agent_query failed: {exc}\n{traceback.format_exc()}",
            }
        )
        return

    session = response.session

    # Stream the answer content in chunks (fake-stream, since paper-qa
    # returns a full string; the frontend still gets incremental UX).
    answer = session.answer or ""
    CHUNK = 80
    for i in range(0, len(answer), CHUNK):
        emit({"id": req_id, "type": "chunk", "data": answer[i : i + CHUNK]})

    contexts = []
    for ctx in session.contexts or []:
        try:
            contexts.append(
                {
                    "context": ctx.context,
                    "score": ctx.score,
                    "text_name": getattr(ctx.text, "name", None),
                    "doc_citation": getattr(
                        getattr(ctx.text, "doc", None), "citation", None
                    ),
                    "doc_docname": getattr(
                        getattr(ctx.text, "doc", None), "docname", None
                    ),
                    "doc_doi": getattr(getattr(ctx.text, "doc", None), "doi", None),
                    "doc_title": getattr(getattr(ctx.text, "doc", None), "title", None),
                }
            )
        except Exception:
            pass

    emit({"id": req_id, "type": "contexts", "data": contexts})

    done_payload: dict[str, Any] = {
        "answer": answer,
        "formatted_answer": session.formatted_answer,
        "cost": session.cost,
        "token_counts": session.token_counts,
        "references": session.references,
    }
    emit({"id": req_id, "type": "done", "data": done_payload})


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

HANDLERS = {
    "status": handle_status,
    "list_papers": handle_list_papers,
    "add_paper": handle_add_paper,
    "search": handle_search,
    "query": handle_query,
}


async def dispatch(req: dict[str, Any]) -> None:
    req_id = req.get("id", "")
    method = req.get("method", "")
    params = req.get("params") or {}
    handler = HANDLERS.get(method)
    if handler is None:
        emit({"id": req_id, "type": "error", "data": f"unknown method: {method}"})
        return
    try:
        await handler(req_id, params)
    except Exception as exc:
        emit(
            {
                "id": req_id,
                "type": "error",
                "data": f"{exc}\n{traceback.format_exc()}",
            }
        )


async def main() -> None:
    log(f"paperqa bridge starting (python {sys.version.split()[0]})")
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    emit({"id": "", "type": "ready", "data": {"pid": os.getpid()}})

    while True:
        line = await reader.readline()
        if not line:
            log("stdin closed; exiting")
            return
        try:
            req = json.loads(line.decode("utf-8"))
        except json.JSONDecodeError as exc:
            emit({"id": "", "type": "error", "data": f"bad json: {exc}"})
            continue
        # Fire-and-forget: run each request concurrently
        asyncio.create_task(dispatch(req))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
