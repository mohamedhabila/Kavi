# MobileWorld

This adapter connects MobileWorld's Android controller to Kavi's exact foreground agentic-chat execution. MobileWorld owns screenshots, device actions, task setup, and scoring; Kavi's persistent control graph owns action selection, recovery, and completion. Each current screenshot is ephemeral model evidence for the production `mobile_ui_action` tool. MobileWorld executes the published action and returns a correlated typed outcome before the same tracked run continues.

## Pinned source

- Repository: [Tongyi-MAI/MobileWorld](https://github.com/Tongyi-MAI/MobileWorld)
- Revision: `8ae506487bf87785292d6cad101c49955d704d39`
- License: Apache-2.0

The upstream checkout, submodules, Python environment, emulator images, APKs, run traces, and credentials stay under `.private/` and are not redistributed.

## What the adapter proves

The opt-in pilot uses an ADB-connected Android emulator or device and MobileWorld's unmodified server, controller, and general-E2E action parser. It asks Kavi to create an alarm, then verifies the exact hour, minute, and enabled state directly in the Clock database. A prose claim of completion cannot pass the test.

The pilot is deliberately labeled `non_official_ad_hoc_device_pilot`: it does not use an official MobileWorld task initializer or scorer and is not a leaderboard score. Its purpose is to validate the real screenshot-to-chat-to-action-to-device loop before spending provider budget on the full suite.

The provider uses Kavi's capability-narrowed production tool schema. The adapter translates only a graph-published controller action into MobileWorld's unchanged action parser and returns its canonical transcript for trajectory logging. Invalid actions are rejected before external-effect authority is claimed, so the same graph can repair them safely. There is no benchmark-owned parser repair loop, second policy model, task-name branch, or gold-state feedback.

## Private setup

Install `uv`, Android platform tools, and an Android emulator or connect a debuggable physical device. Then, from the repository root:

MobileWorld's unchanged `open_app` controller launches packages through Android `monkey`. Emulator configurations must expose a hardware keyboard (`hw.keyboard=yes`) and be cold-booted after changing that setting; otherwise newer Android images can exit before injecting the launch event. The public pilot preflights this exact controller path and fails before provider spend when it is unavailable.

The pilot also installs, activates, and reads back MobileWorld's ADB Keyboard before task initialization. A successful broadcast alone is not accepted as text-input readiness because Android can finish package installation before the new input method is selectable.

```sh
mkdir -p .private/evals/upstream
git clone https://github.com/Tongyi-MAI/MobileWorld .private/evals/upstream/mobileworld
git -C .private/evals/upstream/mobileworld checkout 8ae506487bf87785292d6cad101c49955d704d39
git -C .private/evals/upstream/mobileworld submodule update --init --recursive
cd .private/evals/upstream/mobileworld
uv sync --all-extras
export USER_AGENT_API_KEY='replace-with-openai-compatible-secret'
export USER_AGENT_BASE_URL='https://api.openai.com/v1'
export USER_AGENT_MODEL='gpt-4o-mini'
uv run mobile-world server --host 127.0.0.1 --port 6800
```

The three `USER_AGENT_*` values are required only for tasks that call `ask_user`, but they must be present in the MobileWorld **server process before it starts**. They configure upstream's simulated user, not Kavi's policy model. If they are absent or invalid, classify the attempt as infrastructure-invalid rather than a task failure.

Keep the server running. Configure a real provider in ignored `.env.local` or the shell:

```sh
E2E_PROVIDER=openrouter
E2E_OPENROUTER_MODEL=<vision-capable-agent-model>
OPENROUTER_API_KEY=<secret>
```

The selected model must accept image inputs and tool calls. The adapter never sends provider credentials to MobileWorld or writes them into results.

The adapter uses Kavi's exact foreground **agentic** route and one persistent tracked run. An admitted sandbox controller is code-pinned into that exact session's request-scoped tool surface. A controller call parks the foreground generation, MobileWorld executes it, and the next screenshot settles the exact handoff before the run resumes. This exercises the same graph, effect journal, chat projection, recovery, and tool authority boundaries used by the app; the benchmark remains only the external controller and scorer.

At session initialization, the adapter intersects MobileWorld's controller catalog with packages installed on the selected device. The admitted capability exposes each installed package exactly once by canonical package ID and constrains `open_app` to that set. The adapter privately translates the selected package back to one host-supported alias at the execution boundary, so localized labels and duplicate aliases never become model authority.

The host reports only facts it can observe: synchronous action acknowledgement, the next screenshot identity, and whether the stabilized visual observation changed. The adapter compares bounded grayscale observations so cursor blinks, status-bar updates, and isolated transient pixels do not masquerade as task progress. Visual change is never promoted into semantic completion; the model must inspect the new screen and the unchanged upstream scorer remains final authority. Kavi persists only hashed strategy state in the existing run graph, counts correlated `unchanged` or explicit-failure outcomes, rejects an equivalent fourth dispatch, and permits at most one materially different automatic recovery. Unknown outcomes are never converted into no-progress evidence. This policy is independent of language, task text, app label, expected action, provider, and scorer state.

The current public adapter covers MobileWorld's GUI action channel and user-interaction observations. It does not expose MobileWorld MCP tools to Kavi. Keep MCP-tagged tasks out of reported adapter aggregates until a separate typed MCP authority and outcome channel is implemented and validated end to end.

Run adapter checks and the device pilot:

```sh
PYTHONDONTWRITEBYTECODE=1 .private/evals/upstream/mobileworld/.venv/bin/python \
  -m unittest discover -s benchmarks/mobileworld -p 'test_*.py'
node ./scripts/mobileworld-pilot.js
```

Set `MOBILEWORLD_DEVICE`, `MOBILEWORLD_AW_HOST`, or `MOBILEWORLD_PILOT_MAX_STEPS` only when the environment requires it. Results are written to a fresh ignored directory under `.private/evals/runs/mobileworld/`.

Set `MOBILEWORLD_RELAUNCH_AFTER_FIRST_ACTION=1` only for the app-lifecycle diagnostic. The bridge then closes the local execution journal, discards and rehydrates the foreground chat state, runs normal startup recovery, and applies the first correlated controller outcome through a newly created foreground runtime. The result remains a local device diagnostic, not a separate MobileWorld score configuration.

To exercise an upstream initializer and scorer on a local development AVD, set one canonical task class name:

```sh
MOBILEWORLD_TASK=SetAlarmTask MOBILEWORLD_PILOT_MAX_STEPS=50 \
  node ./scripts/mobileworld-pilot.js
```

This mode creates a clean local `init_state` snapshot, then runs MobileWorld's unmodified task initializer and scorer. Task mode defaults to MobileWorld's documented 50-step submission budget; the environment variable is shown to keep the run manifest explicit. It is recorded as `local_official_task_diagnostic_custom_avd`, not an official score, because the AVD is not MobileWorld's prepared environment image.

## Full benchmark and official submission

The official score requires MobileWorld's complete prepared environment and all applicable tasks, not the ad-hoc pilot. Follow the upstream [environment setup](https://github.com/Tongyi-MAI/MobileWorld#-quick-start) on a supported Linux/KVM host or its documented [physical-device path](https://github.com/Tongyi-MAI/MobileWorld/blob/main/docs/real-devices.md). Keep the upstream task initialization, user simulator, MCP services, scorer, retry policy, and trajectory logger unchanged.

For a frozen run:

1. Use a clean Kavi commit and the pinned clean MobileWorld revision.
2. Record the provider family, exact model, base URL, device/OS, task track, max steps, concurrency, retries, and timestamps.
3. Run pass@1 first and retain every task attempt, including infrastructure and parse failures.
4. Keep GUI-only, user-interaction, and MCP results separate unless the upstream report explicitly aggregates them.
5. Inspect `traj_logs/<run-name>/` for completeness and secrets without editing scored outputs.
6. Run MobileWorld's `site/bundle_trajs.py` on the complete run directory.
7. Prepare the leaderboard metadata object specified by the official [submission guide](https://github.com/Tongyi-MAI/MobileWorld/blob/main/docs/submit.md).
8. Open an issue in the MobileWorld repository with the `.json.gz` bundle and optional trajectory video. Call the score official only after maintainer acceptance.

MobileWorld currently documents 201 tasks across 20 apps. A subset, ad-hoc task, modified scorer, missing trajectory set, or unsupported host adaptation must be reported as a local diagnostic rather than a MobileWorld score.

## Integrity guardrails

- Production code must not branch on MobileWorld task names, prompts, apps, expected actions, or reward state.
- The bridge sends only the user objective, current observation, graph-published action, and correlated host outcome.
- Gold task state and database verification remain outside the app process.
- No provider key, raw private trace, local absolute path, or emulator snapshot is committed.
- Keep pass@1 primary. Report retries, repairs, latency, token use, device state, and failures alongside success rate.
