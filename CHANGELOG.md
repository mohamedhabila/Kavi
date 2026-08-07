# Changelog

All notable changes to Kavi will be documented in this file.

The format is based on Keep a Changelog, and this project follows semantic
versioning where practical for tagged releases.

## [Unreleased]

### Changed

- Long-horizon runs keep far more raw context before summarizing. The working
  context window is now 75% of the model's real window (previously 25%), so a
  128K model retains roughly 67K message tokens instead of ~30K. On-device
  runtimes keep a separate phone-sized cap.
- Compaction summaries are model-authored by default instead of opt-in. The
  previous "Off" chip under Memory & privacy is now an explicit
  **Automatic / Off** control; an existing install migrates to Automatic and can
  switch back. On-device providers always use the deterministic summarizer.
- Compaction summaries now carry code-owned open threads — live goals and
  in-flight external work — so unfinished work survives a summary.
- The turn-1 tool surface includes everyday read-only capabilities
  (`web_search`, `web_fetch`, `calendar_events`, `contacts_search`,
  `location_current`, `device_query`). Mutating tools still require discovery and
  approval.
- A new code-owned Capability Index tells the model which capability domains
  exist in the current run but are not on this turn's surface, so a listed
  capability is never reported as unavailable without discovery.
- Tool eviction under budget pressure follows the default surface and live goal
  capabilities instead of a fixed list of file tools.
- Personas own their operating instructions. The Assistant persona's prompt is
  now actually used — editing it in the agent roster previously had no effect —
  and the user system prompt is an additive customization rather than a
  replacement. The shipped default system prompt is empty; an existing install
  carrying the old generic one-liner is migrated to empty (settings schema v16).
- Long-horizon iteration extensions apply to every persona-driven run without an
  explicit caller budget, not only the SuperAgent persona. Extensions still
  require code-owned evidence of recent completed tool progress.
- A chitchat conversation that reaches for a capability only an agentic run may
  use now escalates to agentic mode with a visible transcript marker, instead of
  silently dropping the tool.

### Fixed

- A goal can no longer be declared into a state it can never leave. Blocking criteria
  are monotonic, so an unsatisfiable one could not be withdrawn and the run spent its
  budget retrying against an unwinnable gate. `completionPolicy` is now derived when
  omitted — it is absent from the tool schema's required list, so a schema-conformant
  call was rejected at runtime and the obvious retry hit a second wall. A criterion
  whose operand describes a resource instead of naming one is refused while the goal is
  still repairable, including a file path passed to `evidence.json_field`, whose first
  operand is a dotted field path unlike every sibling form. Count criteria may now be
  revised: the engine already refused to accept one as a deliverable or to let one be
  appended, so locking it guarded nothing. Criteria naming a deliverable stay monotonic.
- A delegation goal is no longer corrupted by the supervisor's own side effects.
  Effect-completion materialization attached its criterion to whichever goal was active
  and blocking, which in a delegation run is the goal meaning "a worker delivered" — and
  the criterion could never be removed. Evidence routing already refused to treat a
  delegation goal as a container for this run's tool output; that rule is now shared.
- A delegated worker can report success for a deliverable that is an answer. Its Worker
  Contract told it to answer directly without tools while the Execution Evidence
  Contract in the same prompt required completed tool results for `verified_success`, so
  a worker asked to return a value did exactly that and could not report it. Both the
  contract it is told and the bar the runtime enforces now follow the scoping goal's own
  criteria; a goal demanding structural proof still demands it.
- A fact is filed under the identifier the user actually used. `memory_remember`
  instructed callers to preserve a user-supplied identifier exactly, but nothing
  enforced it, so a decorated predicate was accepted and the fact stored where that name
  would never find it. The write reported success and the loss surfaced only at recall.
- A tool the run has already used is no longer evicted first under budget pressure, and
  a rejected off-surface call now names the discovery step that brings the capability
  back instead of stating only that the tool is not allowed. Evicting a tool in use
  spends a round-trip rather than saving one.
- A rejected `update_goals` call now reports the current goal list alongside the error.
  It described what went wrong but not what was actually true, so the model retried
  against its own stale picture of the graph and a single rejection became a loop.
- Completing a goal the engine already completed now succeeds instead of erroring. The
  engine auto-completes a blocking goal as soon as its criteria are satisfied, so a
  model that then said "complete" was told to activate first — and activating was
  refused because completed goals cannot be reactivated. That contradiction left no
  legal move and the run ground against it; any tool whose result satisfies a goal
  could reach it.
- A goal that has already earned its evidence can be completed straight from pending.
  The `update_goals` schema does not require `status`, so a goal added without one is
  created pending — and completing required `active`, so a model following the
  documented schema did the work, was refused with "Use activate first", and spent
  another call activating. The evidence bar is unchanged: only a goal whose own
  requirements are satisfied takes this path.
- A tool that cannot work in the current runtime is no longer offered. Availability was
  a hardcoded chain of tool-name comparisons, so any tool it did not name was
  advertised unconditionally — `web_search` appeared on every turn even with no search
  provider configured, spending a model round-trip on a call that could only fail.
  Tools now declare their runtime conditions in `contract.runtimeRequirements` and
  availability is evaluated from those declarations, so a new tool is gated by
  describing itself. An unrecognized requirement fails open, because hiding a working
  capability is worse than one wasted call.
- A spilled tool result previews its own content instead of its JSON envelope, and a
  result the caller already bounded is no longer spilled at all. Offloading a large
  result to the workspace is meant to save context, but a 1,200-character slice of the
  wrapper told the model nothing, so it read the file back every time — turning one
  tool call into three and costing a full prompt re-send. `web_fetch` returns up to
  20,000 characters by default, well over the old 8 KB spill threshold, so every
  substantial page fetch paid that tax.
- `web_fetch` can look for a specific value in a page instead of guessing where it
  sits. A new `find` argument returns only the regions mentioning the given text, with
  surrounding context, and `matchCount: 0` states plainly that the page does not
  contain it. A positional window could not answer "where is this value" — a model
  needing one field from a long page had no way to tell whether it sat at offset 20,000
  or 120,000, so trying a different URL was cheaper than trying a different offset.
- `web_fetch` can read past the first window of a long page. A response longer than
  `maxChars` now returns a contiguous window plus `charCount` and `nextOffset`, and a
  new `offset` argument continues from there. Previously a long page came back as a
  head-and-tail excerpt with no way to reach the middle, so a model needing a field
  that fell in the gap could only re-fetch — repeatedly, at a full model turn each
  time. Windows are contiguous, which also stops JSON responses being spliced into
  unparseable fragments.
- A goal activated after its evidence was earned now inherits that evidence. Only the
  one active goal in a lane receives routed evidence, and activating a goal demotes the
  previously active one — so running an effectful tool, which materializes a code-owned
  verification goal, moved the model's own goal to pending exactly when its evidence
  arrived. The goal could then never complete and the model repeated the side effect
  trying to re-earn what the run had already proved. A goal still only inherits
  evidence its own success criteria ask for.
- A goal no longer starves when the engine materializes its own verification goal.
  Running an effectful tool creates a code-owned "Verify <tool> effect" goal, which
  made the run look like it had two objectives and disqualified the model's own goal
  from receiving unscoped evidence. The model's only recourse was to repeat the side
  effect. Code-owned bookkeeping goals still collect evidence but no longer count as
  competing objectives.
- Tool declarations now keep a stable prompt-cache prefix. The default core surface
  is declared ahead of discovery-activated tools, so activating a tool mid-run
  appends to the request instead of inserting into the middle of the declaration
  block. Previously every tool was treated as cacheable and sorted by name, so each
  activation shifted the declarations after it and invalidated the prompt cache from
  that point through the rest of the request.
- The Capability Index is constant for a run. It heads the cacheable prompt prefix,
  but listed only the capabilities *not* on the current turn's surface, so every
  successful discovery rewrote the first bytes of the system prompt and invalidated
  the prompt cache for the whole request. It now lists the capabilities available in
  the run regardless of what this turn exposes.
- Token attribution and prompt-cache telemetry reach usage reports again. The
  foreground usage callback rebuilt its payload field by field and dropped the token
  buckets, prompt-cache structure, and token details the engine computes, so every
  downstream report showed zeroes and cache behaviour could not be measured.
- The evaluation readiness gate no longer requires cache-create telemetry from
  providers that cache implicitly. DeepSeek and OpenRouter passthrough never emit a
  cache-create event, so the criterion could never pass and masked the criteria that
  genuinely failed. A run with no cache telemetry at all still fails it.
- Goals can now collect evidence from tools that have an effect. `evidence.tool`
  and `evidence.prefix` matched only the plain evidence string that effect-free
  tools emit, so no effectful tool in any family — workspace writes, file edits,
  memory writes, image generation, messaging, calendar — could satisfy them. A
  goal asserting `evidence.tool:write_file` stayed open no matter how many times
  the file was written.
- `evidence.artifact` and `evidence.file_hash` compare workspace paths through
  the same normalization the workspace applies when writing. Previously the
  criterion was matched against the receipt as raw text, so a goal naming
  `./notes.md` was never satisfied by the write that produced `notes.md`.
- A goal declared after the work was already done now inherits the evidence the run
  already earned, instead of starting empty. Previously the model's only recovery
  was to repeat the tool call — wasteful for a file write, and a duplicated
  real-world action for a message or calendar event. A goal only inherits evidence
  that satisfies a criterion it explicitly declares.
- A run stopped by loop detection now ends with a plain explanation of what
  stopped and which goals were left unfinished. The internal loop diagnostic
  ("CRITICAL: 3 consecutive …") was previously delivered to the user as the
  assistant's final message; it now stays on the observability channel.

## [1.0.0] - 2026-06-20

### Added

- Mobile-only assistant app for iOS and Android with direct chat, agentic
  workflows, conversation workspaces, attachments, voice input, and no required
  Kavi server or gateway for core use.
- Structured tool orchestration for local app actions, MCP servers, SSH
  sessions, browser automation, remote workspaces, and Expo/EAS workflows.
- ClawHub-compatible skill discovery and installation while keeping MCP runtime
  surfaces available for public integrations.
- On-device Gemma runtime support with native integration, runtime selection,
  installation checks, and fallback handling.
- Long-term memory with local fact, entity, focus, episode, recall, and
  task-scoped context storage.
- Explicit, user-authorized preservation of bounded source text for exact
  cross-conversation recall, with local withdrawal and memory opt-out controls.
- Public contributor documentation for development setup, testing, privacy,
  permissions, release checks, third-party notices, and provenance.

### Changed

- Documentation now describes contributor setup, verification tiers, optional
  remote integrations, and maintainer-owned signing responsibilities.
- Default verification now runs public hygiene, public language, Markdown link
  validation, dependency license checks, app metadata checks, i18n consistency,
  structural guards, lint, typecheck, and the Jest suite.
- Generated editor assets remain committed and reproducible so native builds do
  not depend on runtime bundling.
- The terminal renderer and addons are now generated from pinned npm inputs and
  bundled into both platform assets, so the local terminal does not load
  executable code from a runtime CDN.
- Python automation now requires explicit per-invocation network authority,
  routes supported HTTP through the native URL, bounded redirect, and
  response-size policy, and reports content-free network-effect evidence to
  durable execution receipts.
- Effect-free Python interpreter failures remain ordinary failed computations
  that the agent can recover from, while possible or indeterminate external
  mutations continue to require reconciliation.
- Intermediate provider tool markup is hidden when the same turn already has a
  structured tool call, while ordinary final-answer content is preserved.
- App, package, native, and MCP client metadata are aligned at version `1.0.0`
  while retaining the current iOS and Android application identifiers.
- iOS EventKit permission metadata now covers both calendar and reminder
  requesters so release builds can initialize the calendar module safely.
- Preserve explicitly trusted MCP read/write and effect metadata through
  dynamic tool discovery instead of reducing every integration tool to an
  unknown discovery capability.
- Keep empty category searches inside their requested boundary while returning
  structured alternative-category guidance, with one bounded reconsideration
  before integration-owned work is handed back to the user.
- Record successful mutating MCP returns as unverified acknowledgements so the
  assistant can perform a safe read-back without treating opaque result content
  as completion evidence or automatically replaying an uncertain mutation.

### Security

- Added repository hygiene checks for ignored local material, generated output,
  local artifacts, tracked secret patterns, and contributor-facing language.
- Documented private vulnerability reporting expectations and
  sensitive-data-handling guidance.
- Added dependency license inventory checks and generated third-party notices.
- Kept signing material, local environment files, generated reports, and
  release artifacts out of the public tree.
- Updated vulnerable direct and lockfile dependency resolutions without forcing
  incompatible MCP or Expo downgrades; remaining moderate transitive advisories
  and their reachability are documented in the release checklist.

### Tests

- Default contributor verification runs the local Jest suite, lint, typecheck,
  documentation link checks, license checks, metadata checks, and repository
  guardrails.
- Added durable coverage for repository hygiene checks, dependency license
  inventory, GitHub workflow hardening, contributor documentation, and release
  checklist expectations.
- App metadata checks now reject missing or divergent native iOS usage
  descriptions before a release artifact is built.
- Retained strict maintainer gates for memory, agent, and live E2E validation
  without requiring provider credentials for ordinary pull requests.
