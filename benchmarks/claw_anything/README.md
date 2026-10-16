# Claw-Anything

This adapter runs [Claw-Anything](https://github.com/LiberCoders/Claw-Anything) with Kavi as the agent. Claw-Anything benchmarks always-on personal assistants over a person's digital world: mail, calendar, contacts, notes, todo, finance, chat and more, as 35 mock services, plus three months of activity logs per task. Its CLI-only tasks are the 100 `benchmark/skill` and 50 `benchmark/tool` tasks. The 50 `benchmark/gui` tasks drive an Android device through a GUI grounding model and are out of scope.

## Pinned source

- Repository: [LiberCoders/Claw-Anything](https://github.com/LiberCoders/Claw-Anything)
- Revision: `615344de6357534578dc5aa323c29d7e7baafeef`
- License: MIT

The checkout, its virtualenv, traces and credentials stay under `.private/` and are not redistributed.

## What runs where

Claw-Anything owns everything except the agent: it loads the task, starts its mock services with the task's day frozen, stages the activity logs, dispatches every tool call (including its optional 429/500 error injection), takes the services' audit snapshots, writes the trace and grades it. `KaviAgent` (`kavi_agent.py`) replaces only the agent:

1. It serves the task's tools to Kavi as one MCP integration over Streamable HTTP. Each call goes through Claw-Anything's own `ToolDispatcher`, so Kavi sees exactly the results every other harness sees, and each call is recorded in the trace.
2. It runs the request through Kavi's foreground conversation path (`scripts/claw-anything-task.js`, then `__tests__/acceptance/clawAnythingLive.test.ts`). Each trial uses a fresh profile with the clock set to noon UTC on the task's day, as the mock services freeze it, and the activity logs in Kavi's workspace.
3. It writes Kavi's steps (text, tool calls, results, the final reply) into the trace for Claw-Anything's grader and judge.

Kavi runs as shipped: its default persona and its own runtime guidance, at each model's default thinking level. Beyond that it gets what OpenHarness, the paper's harness, gets beyond its own base prompt: the task's day (its clock), the "Activity Logs" section that says where the logs are, and Claw-Anything's "Agent Guidelines" section, given after the persona as the person's own instructions. Nothing names the task, its rubric or its expected tools. The integration's tools are allowed the way every E2E scenario's tools are allowed, so whether to send, delete or only draft is Kavi's judgment, as it is the other harnesses'. Long-term memory is off: one request on a fresh profile cannot use it.

## Setup

```sh
mkdir -p .private/evals/upstream
git clone https://github.com/LiberCoders/Claw-Anything .private/evals/upstream/claw-anything
git -C .private/evals/upstream/claw-anything checkout 615344de6357534578dc5aa323c29d7e7baafeef
cd .private/evals/upstream/claw-anything
uv venv --python 3.12 .venv
VIRTUAL_ENV=$PWD/.venv uv pip install -e ".[mock,sandbox]"
```

Write a Claw-Anything `config.yaml` outside the repository with the judge the paper uses (Claude Sonnet 4.5); `${VAR}` values are read from the environment:

```yaml
model:
  api_key: ${OPENROUTER_API_KEY}
  base_url: https://openrouter.ai/api/v1
  model_id: anthropic/claude-sonnet-5.5
judge:
  api_key: ${OPENROUTER_API_KEY}
  base_url: https://openrouter.ai/api/v1
  model_id: anthropic/claude-sonnet-4.5
  enabled: true
```

Kavi runs on its E2E provider (`E2E_PROVIDER` and its key in `.env.local` or the shell; see `docs/testing.md`). The `model` block is used only by Claw-Anything's own agents.

## Run

From the repository root, with the judge's key exported, one task per `run` (Claw-Anything's `batch` always runs trials in Docker containers, and Kavi runs on the host):

```sh
for task in .private/evals/upstream/claw-anything/benchmark/tool/*/; do
  .private/evals/upstream/claw-anything/.venv/bin/python benchmarks/claw_anything/run_kavi.py \
    run --task "benchmark/tool/$(basename "$task")" --config /path/to/config.yaml \
    --trace-dir "$PWD/.private/evals/claw-anything/runs/<name>" \
    --model <Kavi's model id, recorded in the trace>
done
```

Run tasks one at a time: every task's mock services listen on the same fixed ports, and each trial runs up to 18 services and a Jest process. Set `CLAW_INJECT_ERRORS=0.25` to have the mock services answer a quarter of tool calls with 429/500 errors or slow responses; Claw-Anything's robustness score then measures recovery.

The reference arm is Claw-Anything's own agent on the same tasks, model and judge: `benchmarks/claw_anything/run_reference.py run --task … --agent loop …` runs its CLI unchanged. An endpoint that needs a header, such as Anthropic's OpenAI-compatible API with a key that is not scoped to a workspace (`anthropic-workspace-id`), gets it from `CLAW_ANYTHING_EXTRA_HEADERS`, a JSON object. `CLAW_ANYTHING_DROP_PARAMS` maps a model id to request fields to drop: Claw-Anything always sends `temperature: 0.0`, which Claude Sonnet 5.5 rejects on Anthropic's API, so the reference arm drops it for that model only and the judge keeps it. All drivers apply both to every client Claw-Anything creates (client_options.py).

Each trial's trace (`<task>_<id>.jsonl`) is graded by Claw-Anything as usual. Beside it, `.kavi.json` holds Kavi's own numbers (completion, terminal reason, token usage with cache reads, estimated cost) and `.kavi.log` the run's log. A trial whose Kavi process fails is recorded as an error (`failure_modes` in its trace end), not as a task failure; rerun that task.

Adapter checks:

```sh
npm run test:claw-anything-adapter
./node_modules/.bin/jest __tests__/acceptance/clawAnything.test.ts
```

## Reporting

Claw-Anything reports Pass@1, Pass@3, Pass^3 and the continuous score over three trials. The paper's numbers cover all 200 tasks, including the 50 GUI tasks, so compare Kavi only with a reference harness run on the same CLI-only tasks with the same model and judge. Report the error-injection runs separately from clean runs.

## Integrity guardrails

- Production code must not branch on Claw-Anything task names, prompts, services, expected tools or rubrics.
- The adapter sends Kavi only the request, the task's day, the activity logs and their index, and the tools' own names, descriptions and schemas.
- Fixtures, `task.yaml` and graders stay outside Kavi's workspace.
- No provider key, private trace or local absolute path is committed.
