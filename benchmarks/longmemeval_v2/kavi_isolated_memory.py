from __future__ import annotations

import atexit
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from typing import Any
from uuid import uuid4

from .memory import Memory, MemoryConfig, MemoryContextItem, register_memory, require


DEFAULT_MAX_ITEMS = 6
DEFAULT_MAX_ITEM_CHARS = 5000
DEFAULT_CHUNK_CHARS = 3600
DEFAULT_CHUNK_OVERLAP_CHARS = 320


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return default


def _safe_name(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in value)
    return cleaned.strip("-")[:80] or "kavi-memory"


def _load_json_line(line: str) -> dict[str, Any]:
    payload = json.loads(line)
    require(isinstance(payload, dict), "Runtime response must be a JSON object")
    return payload


class KaviMemoryRuntimeClient:
    def __init__(
        self,
        *,
        repo_root: Path,
        runtime_bundle_path: Path,
        db_dir: Path,
        node_binary: str,
        config: dict[str, object],
    ) -> None:
        self.repo_root = repo_root
        self.runtime_bundle_path = runtime_bundle_path
        self.db_dir = db_dir
        self.node_binary = node_binary
        self.config = dict(config)
        self.request_counter = 0
        self.lock = threading.Lock()
        self.stderr_lines: list[str] = []

        self.db_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_runtime_bundle()

        env = dict(os.environ)
        env["KAVI_MEMORY_SQLITE_DIR"] = str(self.db_dir)
        env.setdefault("NODE_ENV", "production")
        self.process = subprocess.Popen(
            [self.node_binary, str(self.runtime_bundle_path)],
            cwd=str(self.repo_root),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        self.stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self.stderr_thread.start()
        atexit.register(self.close)
        self.call({"op": "reset", "config": self.config})

    def _ensure_runtime_bundle(self) -> None:
        if self.runtime_bundle_path.exists():
            return
        build_script = self.repo_root / "benchmarks" / "longmemeval_v2" / "build_kavi_memory_runtime.js"
        require(build_script.exists(), f"Missing runtime build script: {build_script}")
        self.runtime_bundle_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [self.node_binary, str(build_script), "--out", str(self.runtime_bundle_path)],
            cwd=str(self.repo_root),
            check=True,
        )

    def _read_stderr(self) -> None:
        assert self.process.stderr is not None
        for line in self.process.stderr:
            self.stderr_lines.append(line.rstrip())
            self.stderr_lines = self.stderr_lines[-200:]

    def call(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            if self.process.poll() is not None:
                raise RuntimeError(
                    f"Kavi memory runtime exited with {self.process.returncode}. "
                    f"stderr_tail={self.stderr_lines[-20:]}"
                )
            self.request_counter += 1
            request_id = f"req-{self.request_counter}"
            request = {"id": request_id, **payload}
            assert self.process.stdin is not None
            assert self.process.stdout is not None
            self.process.stdin.write(json.dumps(request, ensure_ascii=True) + "\n")
            self.process.stdin.flush()
            line = self.process.stdout.readline()
            require(line, "Kavi memory runtime closed stdout without a response")
            response = _load_json_line(line)
            require(response.get("id") in {request_id, None}, "Mismatched runtime response id")
            if not response.get("ok"):
                raise RuntimeError(
                    f"Kavi memory runtime request failed: {response.get('error')}\n"
                    f"{response.get('stack') or ''}\n"
                    f"stderr_tail={self.stderr_lines[-20:]}"
                )
            result = response.get("result")
            return result if isinstance(result, dict) else {}

    def close(self) -> None:
        process = getattr(self, "process", None)
        if process is None or process.poll() is not None:
            return
        try:
            self.call({"op": "shutdown"})
        except Exception:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


@register_memory
class KaviIsolatedMemory(Memory):
    """Official LongMemEval-V2 adapter for Kavi's isolated memory system.

    The Python layer only implements the benchmark's Memory boundary and keeps a
    persistent local runtime process. Ingestion and retrieval are performed by
    Kavi's TypeScript memory store and SQLite search runtime.
    """

    memory_type = "kavi_memory_isolated"

    def __init__(self, memory_params: dict[str, object]) -> None:
        super().__init__(memory_params)
        repo_root_value = memory_params.get("repo_root")
        workspace_root_value = memory_params.get("workspace_root")
        node_binary = str(memory_params.get("node_binary", "node")).strip()
        runtime_bundle_value = memory_params.get("runtime_bundle_path")

        require(isinstance(repo_root_value, str) and repo_root_value.strip(), "repo_root is required")
        require(
            isinstance(workspace_root_value, str) and workspace_root_value.strip(),
            "workspace_root is required",
        )
        require(node_binary, "node_binary must be non-empty")

        self.repo_root = Path(repo_root_value).resolve()
        self.workspace_root = Path(workspace_root_value).resolve()
        self.instance_id = _safe_name(f"{os.getpid()}-{uuid4().hex[:12]}")
        self.instance_dir = self.workspace_root / self.instance_id
        self.db_dir = self.instance_dir / "db"
        self.trace_dir: Path | None = None
        self.last_query_metadata: dict[str, object] | None = None

        if isinstance(runtime_bundle_value, str) and runtime_bundle_value.strip():
            runtime_bundle_path = Path(runtime_bundle_value).resolve()
        else:
            runtime_bundle_path = (
                self.repo_root / ".private" / "evals" / "runtime" / "kavi_memory_runtime.cjs"
            )

        self.config = {
            "maxItems": int(memory_params.get("max_items", DEFAULT_MAX_ITEMS)),
            "maxItemChars": int(memory_params.get("max_item_chars", DEFAULT_MAX_ITEM_CHARS)),
            "chunkChars": int(memory_params.get("chunk_chars", DEFAULT_CHUNK_CHARS)),
            "chunkOverlapChars": int(
                memory_params.get("chunk_overlap_chars", DEFAULT_CHUNK_OVERLAP_CHARS)
            ),
            "conversationId": f"longmemeval-{self.instance_id}",
            "queryImageUnderstanding": _as_bool(
                memory_params.get(
                    "query_image_understanding",
                    _env_bool("KAVI_LME_QUERY_IMAGE_UNDERSTANDING", True),
                ),
                True,
            ),
            "queryImageModel": str(
                memory_params.get(
                    "query_image_model",
                    os.getenv("KAVI_LME_QUERY_IMAGE_MODEL")
                    or os.getenv("E2E_OPENAI_MODEL")
                    or "",
                )
            ),
            "queryImageBaseUrl": str(
                memory_params.get(
                    "query_image_base_url",
                    os.getenv("KAVI_LME_QUERY_IMAGE_BASE_URL")
                    or os.getenv("OPENAI_BASE_URL")
                    or "https://api.openai.com/v1",
                )
            ),
            "queryImageApiKeyEnv": str(
                memory_params.get(
                    "query_image_api_key_env",
                    os.getenv("KAVI_LME_QUERY_IMAGE_API_KEY_ENV") or "OPENAI_API_KEY",
                )
            ),
        }

        self.client = KaviMemoryRuntimeClient(
            repo_root=self.repo_root,
            runtime_bundle_path=runtime_bundle_path,
            db_dir=self.db_dir,
            node_binary=node_binary,
            config=self.config,
        )

    @property
    def memory_config(self) -> MemoryConfig:
        return {
            "memory_type": self.memory_type,
            "memory_params": {
                "repo_root": str(self.repo_root),
                "workspace_root": str(self.workspace_root),
                "max_items": self.config["maxItems"],
                "max_item_chars": self.config["maxItemChars"],
                "chunk_chars": self.config["chunkChars"],
                "chunk_overlap_chars": self.config["chunkOverlapChars"],
                "query_image_understanding": self.config["queryImageUnderstanding"],
                "query_image_model": self.config["queryImageModel"],
                "query_image_base_url": self.config["queryImageBaseUrl"],
                "query_image_api_key_env": self.config["queryImageApiKeyEnv"],
            },
        }

    def configure_runtime(self, **kwargs: object) -> None:
        raw_trace_dir = kwargs.get("query_trace_dir")
        if isinstance(raw_trace_dir, (str, Path)):
            self.trace_dir = Path(raw_trace_dir)
            self.trace_dir.mkdir(parents=True, exist_ok=True)

    def insert(self, trajectory: dict[str, object]) -> None:
        self.client.call({"op": "insert", "trajectory": trajectory, "config": self.config})

    def query(
        self,
        query: str,
        query_image: str | None = None,
    ) -> list[MemoryContextItem]:
        context = self.get_query_context()
        result = self.client.call(
            {
                "op": "query",
                "query": query,
                "queryImage": query_image,
                "questionId": context.get("question_id"),
                "questionContext": context.get("question_item"),
                "config": self.config,
            }
        )
        self.last_query_metadata = result
        if self.trace_dir is not None:
            question_id = _safe_name(str(context.get("question_id") or "query"))
            (self.trace_dir / f"{question_id}.json").write_text(
                json.dumps(result, indent=2, ensure_ascii=True) + "\n",
                encoding="utf-8",
            )
        memory_context = result.get("memory_context")
        require(isinstance(memory_context, list), "Runtime returned invalid memory_context")
        return memory_context  # type: ignore[return-value]

    def post_query_hook(
        self,
        *,
        query: str,
        query_image: str | None,
        memory_context: list[MemoryContextItem],
    ) -> dict[str, object] | None:
        metadata = self.last_query_metadata or {}
        return {
            "memory_type": self.memory_type,
            "returned_items": len(memory_context),
            "duration_seconds": metadata.get("duration_seconds"),
            "stats": metadata.get("stats"),
        }

    def _save_backend(self, output_dir: Path) -> None:
        stats = self.client.call({"op": "stats"})
        (output_dir / "kavi_memory_runtime_stats.json").write_text(
            json.dumps(stats, indent=2, ensure_ascii=True) + "\n",
            encoding="utf-8",
        )
