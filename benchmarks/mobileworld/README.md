# MobileWorld

This adapter connects MobileWorld's Android action loop to Kavi's exact foreground-chat execution. The benchmark owns screenshots, action parsing, device actions, task setup, and scoring. Kavi receives each current screenshot as a normal image attachment and runs its foreground graph with no benchmark-specific product tools or memory writes. A provider-enforced external-action contract gives the turn authority to propose exactly one controller action without pretending that Kavi's product tools executed it.

## Pinned source

- Repository: [Tongyi-MAI/MobileWorld](https://github.com/Tongyi-MAI/MobileWorld)
- Revision: `8ae506487bf87785292d6cad101c49955d704d39`
- License: Apache-2.0

The upstream checkout, submodules, Python environment, emulator images, APKs, run traces, and credentials stay under `.private/` and are not redistributed.

## What the adapter proves

The opt-in pilot uses an ADB-connected Android emulator or device and MobileWorld's unmodified server, controller, and general-E2E action parser. It asks Kavi to create an alarm, then verifies the exact hour, minute, and enabled state directly in the Clock database. A prose claim of completion cannot pass the test.

The pilot is deliberately labeled `non_official_ad_hoc_device_pilot`: it does not use an official MobileWorld task initializer or scorer and is not a leaderboard score. Its purpose is to validate the real screenshot-to-chat-to-action-to-device loop before spending provider budget on the full suite.

The model returns one strict JSON object containing its rationale and proposed action. The local adapter validates that object, normalizes it with MobileWorld's unchanged action parser, and returns MobileWorld's canonical transcript for trajectory logging. There is no fallback to the legacy free-form `Thought:` / `Action:` parser. A malformed handoff is returned to the same foreground conversation as a typed validation failure; recovery is bounded at three attempts and does not inspect task text, language, expected actions, or gold state.

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

The selected model must accept image inputs. The adapter never sends provider credentials to MobileWorld or writes them into results.

The adapter uses Kavi's exact foreground **chitchat** route as a one-step visual policy. MobileWorld owns the multi-step action loop and executes each parsed action after the chat turn. This is the faithful mapping for MobileWorld's custom-agent protocol: Kavi's code-owned external-action contract authorizes a proposal to the host controller, while only a later observation can provide outcome evidence. It is distinct from Kavi's product-tool authority. Report these results as screen understanding, external action selection, recovery, and end-task completion evidence—not as a direct test of Kavi's internal product-tool control graph.

At session initialization, the adapter intersects MobileWorld's canonical controller identifiers with packages installed on the selected device. That device-specific catalog is carried as system-level capability metadata and constrains `open_app` in the provider-enforced schema. The model therefore selects controller identifiers such as `files` or `sms` instead of guessing product labels the controller cannot accept.

The bridge carries a bounded chronological ledger into the next foreground turn. Each entry distinguishes the model's proposed action, MobileWorld's parser-normalized controller action, and the post-action observation. Exact pixel equality, simulated-user responses, and external-tool results are evidence fields; the bridge never promotes pixel change into a semantic-effect claim and records semantic effect as `unverified`. The assistant must judge the visible state, and the unchanged upstream scorer remains the final task authority. Three consecutive structurally similar actions with no verified semantic effect produce an advisory recovery signal. The detector does not inspect task names, apps, prompt text, expected answers, or scorer state.

The current public adapter covers MobileWorld's GUI action channel and user-interaction observations. It does not expose MobileWorld MCP tools to Kavi. Keep MCP-tagged tasks out of reported adapter aggregates until a separate typed MCP authority and outcome channel is implemented and validated end to end.

Run adapter checks and the device pilot:

```sh
PYTHONDONTWRITEBYTECODE=1 .private/evals/upstream/mobileworld/.venv/bin/python \
  -m unittest discover -s benchmarks/mobileworld -p 'test_*.py'
node ./scripts/mobileworld-pilot.js
```

Set `MOBILEWORLD_DEVICE`, `MOBILEWORLD_AW_HOST`, or `MOBILEWORLD_PILOT_MAX_STEPS` only when the environment requires it. Results are written to a fresh ignored directory under `.private/evals/runs/mobileworld/`.

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
- The bridge sends only the user objective, chronological observations, typed action contract, and typed validation failures.
- Gold task state and database verification remain outside the app process.
- No provider key, raw private trace, local absolute path, or emulator snapshot is committed.
- Keep pass@1 primary. Report retries, repairs, latency, token use, device state, and failures alongside success rate.
