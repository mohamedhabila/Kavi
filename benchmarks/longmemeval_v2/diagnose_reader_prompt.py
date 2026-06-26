#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import time
from typing import Any
import urllib.error
import urllib.request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Call a LongMemEval reader endpoint for saved prompt_rows and record finish reasons.",
    )
    parser.add_argument("--prompt-rows", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--question-id", default=None)
    parser.add_argument("--env-file", default=None, type=Path)
    parser.add_argument("--reader-model", default=os.getenv("READER_MODEL"))
    parser.add_argument("--reader-base-url", default=os.getenv("READER_BASE_URL"))
    parser.add_argument("--reader-api-key-env", default=os.getenv("READER_API_KEY_ENV", "OPENROUTER_API_KEY"))
    parser.add_argument("--max-completion-tokens", type=int, default=20000)
    parser.add_argument("--reader-temperature", type=float, default=float(os.getenv("READER_TEMPERATURE", "0.6")))
    parser.add_argument("--reader-top-p", type=float, default=float(os.getenv("READER_TOP_P", "0.95")))
    parser.add_argument("--reader-top-k", type=int, default=int(os.getenv("READER_TOP_K", "20")))
    parser.add_argument("--timeout-seconds", type=float, default=240.0)
    parser.add_argument("--reader-enable-thinking", action=argparse.BooleanOptionalAction, default=True)
    return parser.parse_args()


def load_env_file(path: Path | None) -> None:
    if path is None or not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def load_prompt_rows(path: Path, question_id: str | None) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if question_id is not None:
        rows = [row for row in rows if row.get("question_id") == question_id]
    require(rows, f"No prompt rows found in {path}")
    return rows


def extract_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    reasoning = message.get("reasoning")
    return reasoning if isinstance(reasoning, str) else ""


def parse_boxed(text: str) -> str | None:
    marker = "\\boxed{"
    if marker not in text:
        return None
    return text.rsplit(marker, 1)[-1].split("}", 1)[0]


def build_payload(args: argparse.Namespace, messages: list[dict[str, Any]]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": args.reader_model,
        "messages": messages,
        "max_tokens": args.max_completion_tokens,
        "temperature": args.reader_temperature,
        "top_p": args.reader_top_p,
    }
    if args.reader_top_k is not None:
        payload["top_k"] = args.reader_top_k
    if (
        args.reader_base_url
        and args.reader_model == "Qwen/Qwen3.5-9B"
        and not args.reader_enable_thinking
    ):
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    return payload


def call_reader(args: argparse.Namespace, api_key: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
    request = urllib.request.Request(
        args.reader_base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(build_payload(args, messages)).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=args.timeout_seconds) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        return {
            "ok": False,
            "elapsed_seconds": round(time.time() - started, 3),
            "http_status": exc.code,
            "error_body": exc.read().decode("utf-8", errors="replace")[:4000],
        }

    choice = payload.get("choices", [{}])[0]
    message = choice.get("message") or {}
    text = extract_text(message)
    reasoning = message.get("reasoning") if isinstance(message, dict) else None
    if not isinstance(reasoning, str):
        reasoning = ""
    return {
        "ok": True,
        "elapsed_seconds": round(time.time() - started, 3),
        "served_model": payload.get("model"),
        "finish_reason": choice.get("finish_reason"),
        "native_finish_reason": choice.get("native_finish_reason"),
        "usage": payload.get("usage"),
        "content_chars": len(text),
        "reasoning_chars": len(reasoning),
        "boxed": parse_boxed(text),
        "content_tail": text[-1200:],
    }


def main() -> None:
    args = parse_args()
    load_env_file(args.env_file)
    if args.reader_model is None:
        args.reader_model = os.getenv("READER_MODEL")
    if args.reader_base_url is None:
        args.reader_base_url = os.getenv("READER_BASE_URL")
    require(args.reader_model, "READER_MODEL or --reader-model is required")
    require(args.reader_base_url, "READER_BASE_URL or --reader-base-url is required")
    api_key = os.getenv(args.reader_api_key_env)
    require(api_key, f"Missing reader API key in {args.reader_api_key_env}")

    rows = load_prompt_rows(args.prompt_rows.expanduser().resolve(), args.question_id)
    results = []
    for row in rows:
        result = call_reader(args, api_key, row["messages"])
        result["question_id"] = row.get("question_id")
        results.append(result)
        print(
            json.dumps(
                {
                    "question_id": result["question_id"],
                    "ok": result["ok"],
                    "finish_reason": result.get("finish_reason"),
                    "native_finish_reason": result.get("native_finish_reason"),
                    "boxed": result.get("boxed"),
                    "usage": result.get("usage"),
                },
                ensure_ascii=True,
            ),
            flush=True,
        )

    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            {
                "reader_model": args.reader_model,
                "reader_base_url": args.reader_base_url,
                "max_completion_tokens": args.max_completion_tokens,
                "reader_temperature": args.reader_temperature,
                "reader_top_p": args.reader_top_p,
                "reader_top_k": args.reader_top_k,
                "reader_enable_thinking": args.reader_enable_thinking,
                "prompt_rows": str(args.prompt_rows),
                "results": results,
            },
            indent=2,
            ensure_ascii=True,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
