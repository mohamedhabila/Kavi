from __future__ import annotations

import atexit
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
from typing import Any
from uuid import uuid4

from .memory import Memory, MemoryConfig, MemoryContextItem, register_memory, require


SHA256_RE = re.compile(r"[a-f0-9]{64}")
COMMIT_SHA_RE = re.compile(r"[a-f0-9]{40}")


def _required_string(
    memory_params: dict[str, object], key: str, *, allow_empty: bool = False
) -> str:
    value = memory_params.get(key)
    require(isinstance(value, str), f"{key} must be a string")
    normalized = value.strip()
    require(allow_empty or bool(normalized), f"{key} must be non-empty")
    return normalized


def _required_bool(memory_params: dict[str, object], key: str) -> bool:
    value = memory_params.get(key)
    require(isinstance(value, bool), f"{key} must be a boolean")
    return value


def _required_int(memory_params: dict[str, object], key: str) -> int:
    value = memory_params.get(key)
    require(isinstance(value, int) and not isinstance(value, bool), f"{key} must be an integer")
    return value


def _required_number(memory_params: dict[str, object], key: str) -> float:
    value = memory_params.get(key)
    require(
        isinstance(value, (int, float)) and not isinstance(value, bool),
        f"{key} must be numeric",
    )
    return float(value)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
        runtime_bundle_sha256: str,
        config: dict[str, object],
    ) -> None:
        self.repo_root = repo_root
        self.runtime_bundle_path = runtime_bundle_path
        self.db_dir = db_dir
        self.node_binary = node_binary
        self.runtime_bundle_sha256 = runtime_bundle_sha256
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
        require(
            self.runtime_bundle_path.is_file() and not self.runtime_bundle_path.is_symlink(),
            f"Missing regular runtime bundle: {self.runtime_bundle_path}",
        )
        require(
            _sha256_file(self.runtime_bundle_path) == self.runtime_bundle_sha256,
            "Runtime bundle does not match the frozen SHA-256",
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
    """LongMemEval-V2 upstream-protocol adapter for Kavi's isolated memory system.

    The Python layer only implements the benchmark's Memory boundary and keeps a
    persistent local runtime process. Ingestion and retrieval are performed by
    Kavi's TypeScript memory store and SQLite search runtime.
    """

    memory_type = "kavi_memory_isolated"

    def __init__(self, memory_params: dict[str, object]) -> None:
        super().__init__(memory_params)
        repo_root_value = _required_string(memory_params, "repo_root")
        workspace_root_value = _required_string(memory_params, "workspace_root")
        node_binary = _required_string(memory_params, "node_binary")
        runtime_bundle_value = _required_string(memory_params, "runtime_bundle_path")
        self.app_commit_sha = _required_string(memory_params, "app_commit_sha")
        self.adapter_source_sha256 = _required_string(memory_params, "adapter_source_sha256")
        self.runtime_bundle_sha256 = _required_string(memory_params, "runtime_bundle_sha256")
        self.node_version = _required_string(memory_params, "node_version")
        require(COMMIT_SHA_RE.fullmatch(self.app_commit_sha) is not None, "app_commit_sha is invalid")
        require(
            SHA256_RE.fullmatch(self.adapter_source_sha256) is not None,
            "adapter_source_sha256 is invalid",
        )
        require(
            SHA256_RE.fullmatch(self.runtime_bundle_sha256) is not None,
            "runtime_bundle_sha256 is invalid",
        )

        self.repo_root = Path(repo_root_value).resolve()
        self.workspace_root = Path(workspace_root_value).resolve()
        self.instance_id = _safe_name(f"{os.getpid()}-{uuid4().hex[:12]}")
        self.instance_dir = self.workspace_root / self.instance_id
        self.db_dir = self.instance_dir / "db"
        self.trace_dir: Path | None = None
        self.last_query_metadata: dict[str, object] | None = None

        runtime_bundle_path = Path(runtime_bundle_value).resolve()

        query_image_understanding = _required_bool(memory_params, "query_image_understanding")
        query_image_model = _required_string(
            memory_params, "query_image_model", allow_empty=not query_image_understanding
        )
        require(
            query_image_understanding or not query_image_model,
            "query_image_model must be empty when image understanding is disabled",
        )
        retrieval_llm_enabled = _required_bool(memory_params, "retrieval_llm_enabled")
        retrieval_llm_model = _required_string(
            memory_params, "retrieval_llm_model", allow_empty=not retrieval_llm_enabled
        )
        require(
            retrieval_llm_enabled or not retrieval_llm_model,
            "retrieval_llm_model must be empty when retrieval LLM is disabled",
        )

        self.config = {
            "maxItems": _required_int(memory_params, "max_items"),
            "maxItemChars": _required_int(memory_params, "max_item_chars"),
            "chunkChars": _required_int(memory_params, "chunk_chars"),
            "chunkOverlapChars": _required_int(memory_params, "chunk_overlap_chars"),
            "minScore": _required_number(memory_params, "min_score"),
            "conversationId": f"longmemeval-{self.instance_id}",
            "queryImageUnderstanding": query_image_understanding,
            "queryImageModel": query_image_model,
            "queryImageBaseUrl": _required_string(memory_params, "query_image_base_url"),
            "queryImageApiKeyEnv": _required_string(memory_params, "query_image_api_key_env"),
            "retrievalLlmEnabled": retrieval_llm_enabled,
            "retrievalLlmModel": retrieval_llm_model,
            "retrievalLlmBaseUrl": _required_string(memory_params, "retrieval_llm_base_url"),
            "retrievalLlmApiKeyEnv": _required_string(memory_params, "retrieval_llm_api_key_env"),
            "retrievalLlmProviderFamily": _required_string(
                memory_params, "retrieval_llm_provider_family"
            ),
            "retrievalLlmProtocol": _required_string(memory_params, "retrieval_llm_protocol"),
        }
        require(1 <= self.config["maxItems"] <= 50, "max_items is outside the runtime range")
        require(
            200 <= self.config["maxItemChars"] <= 20_000,
            "max_item_chars is outside the runtime range",
        )
        require(
            800 <= self.config["chunkChars"] <= 20_000,
            "chunk_chars is outside the runtime range",
        )
        require(
            0 <= self.config["chunkOverlapChars"] < self.config["chunkChars"],
            "chunk_overlap_chars is outside the runtime range",
        )
        require(0 <= self.config["minScore"] <= 1, "min_score is outside the runtime range")
        require(
            self.config["retrievalLlmProviderFamily"]
            in {
                "openai",
                "openrouter",
                "deepseek",
                "qwen",
                "kimi",
                "mistral",
                "voyage",
                "anthropic",
                "gemini",
                "ollama",
                "custom",
            },
            "retrieval_llm_provider_family is unsupported",
        )
        require(
            self.config["retrievalLlmProtocol"]
            in {
                "auto",
                "openai-responses",
                "openai-chat",
                "anthropic-messages",
                "gemini-native",
            },
            "retrieval_llm_protocol is unsupported",
        )

        self.client = KaviMemoryRuntimeClient(
            repo_root=self.repo_root,
            runtime_bundle_path=runtime_bundle_path,
            db_dir=self.db_dir,
            node_binary=node_binary,
            runtime_bundle_sha256=self.runtime_bundle_sha256,
            config=self.config,
        )

    @property
    def memory_config(self) -> MemoryConfig:
        return {
            "memory_type": self.memory_type,
            "memory_params": {
                "repo_root": str(self.repo_root),
                "workspace_root": str(self.workspace_root),
                "app_commit_sha": self.app_commit_sha,
                "adapter_source_sha256": self.adapter_source_sha256,
                "runtime_bundle_sha256": self.runtime_bundle_sha256,
                "node_version": self.node_version,
                "max_items": self.config["maxItems"],
                "max_item_chars": self.config["maxItemChars"],
                "chunk_chars": self.config["chunkChars"],
                "chunk_overlap_chars": self.config["chunkOverlapChars"],
                "min_score": self.config["minScore"],
                "query_image_understanding": self.config["queryImageUnderstanding"],
                "query_image_model": self.config["queryImageModel"],
                "query_image_base_url": self.config["queryImageBaseUrl"],
                "query_image_api_key_env": self.config["queryImageApiKeyEnv"],
                "retrieval_llm_enabled": self.config["retrievalLlmEnabled"],
                "retrieval_llm_model": self.config["retrievalLlmModel"],
                "retrieval_llm_base_url": self.config["retrievalLlmBaseUrl"],
                "retrieval_llm_api_key_env": self.config["retrievalLlmApiKeyEnv"],
                "retrieval_llm_provider_family": self.config["retrievalLlmProviderFamily"],
                "retrieval_llm_protocol": self.config["retrievalLlmProtocol"],
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
