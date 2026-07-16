from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest


def load_adapter_module() -> types.ModuleType:
    package_name = "kavi_isolated_memory_test_package"
    package = types.ModuleType(package_name)
    package.__path__ = [str(Path(__file__).parent)]  # type: ignore[attr-defined]
    sys.modules[package_name] = package

    memory_module = types.ModuleType(f"{package_name}.memory")

    class Memory:
        def __init__(self, memory_params: dict[str, object]) -> None:
            self.memory_params = memory_params

    def require(condition: bool, message: str) -> None:
        if not condition:
            raise RuntimeError(message)

    memory_module.Memory = Memory
    memory_module.MemoryConfig = dict
    memory_module.MemoryContextItem = dict
    memory_module.register_memory = lambda memory_class: memory_class
    memory_module.require = require
    sys.modules[memory_module.__name__] = memory_module

    module_name = f"{package_name}.kavi_isolated_memory"
    spec = importlib.util.spec_from_file_location(
        module_name,
        Path(__file__).with_name("kavi_isolated_memory.py"),
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Kavi isolated-memory adapter")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class FakeRuntimeClient:
    def __init__(self) -> None:
        self.close_calls = 0

    def close(self) -> None:
        self.close_calls += 1

    def call(self, payload: dict[str, object]) -> dict[str, object]:
        raise AssertionError(f"Unexpected runtime call after query: {payload}")


class KaviIsolatedMemoryLifecycleTest(unittest.TestCase):
    def test_post_query_releases_the_one_shot_runtime_and_workspace(self) -> None:
        module = load_adapter_module()
        adapter = module.KaviIsolatedMemory.__new__(module.KaviIsolatedMemory)
        client = FakeRuntimeClient()
        adapter.client = client
        adapter.last_query_metadata = {
            "duration_seconds": 0.25,
            "stats": {"inserted_trajectories": 100},
        }
        adapter.last_runtime_stats = None

        with tempfile.TemporaryDirectory() as temp:
            instance_dir = Path(temp) / "instance"
            instance_dir.mkdir()
            (instance_dir / "kavi-memory.db").write_bytes(b"fixture")
            adapter.instance_dir = instance_dir

            metadata = adapter.post_query_hook(
                query="What happened?",
                query_image=None,
                memory_context=[{"type": "text", "value": "evidence"}],
            )

            self.assertEqual(client.close_calls, 1)
            self.assertFalse(instance_dir.exists())
            self.assertEqual(adapter.last_runtime_stats, {"inserted_trajectories": 100})
            self.assertEqual(
                metadata,
                {
                    "memory_type": "kavi_memory_isolated",
                    "returned_items": 1,
                    "duration_seconds": 0.25,
                    "stats": {"inserted_trajectories": 100},
                    "workspace_retained": False,
                },
            )

            output_dir = Path(temp) / "saved"
            output_dir.mkdir()
            adapter._save_backend(output_dir)
            self.assertIn(
                '"inserted_trajectories": 100',
                (output_dir / "kavi_memory_runtime_stats.json").read_text(),
            )


if __name__ == "__main__":
    unittest.main()
