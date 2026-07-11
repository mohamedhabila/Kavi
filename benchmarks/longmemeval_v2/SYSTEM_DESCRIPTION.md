# Kavi Isolated Memory for LongMemEval-V2

Kavi is a mobile-first general assistant with a structured long-term memory
system. This LongMemEval-V2 submission evaluates that memory system in
isolation, not the Kavi assistant graph.

The submitted memory backend uses the official LongMemEval `Memory` interface:

- `insert()` forwards each official trajectory to a persistent local Kavi
  memory runtime.
- A deterministic benchmark translator maps released trajectory metadata and
  state/action histories into synthetic Kavi user, tool, and final-assistant
  messages plus structured goal evidence. It then calls Kavi's production
  `processIngestionTurn` API. This validates the production ingestion and
  retrieval modules, but it does not validate natural-chat fact extraction or
  the complete mobile assistant graph.
- `query()` calls Kavi's production unified memory-access path over the isolated
  SQLite store and returns compact text context items to the official harness.

Every effective method setting is frozen in `runtime_inputs/memory_config.json`:
the clean Kavi commit, complete adapter-source digest, built runtime-bundle
digest, Node version, retrieval limits, chunking, minimum score, and all
auxiliary-model switches. Query-image understanding and LLM-assisted fact
selection are disabled unless explicitly enabled for the operating point. When
enabled, their public endpoint, model identifier, provider/protocol, and API-key
environment-variable name are recorded; key values are never stored. Web and
enterprise runs must use the exact same frozen identity.

The Python adapter does not implement retrieval, ranking, summarization, or
question answering. It maintains the official benchmark boundary, verifies the
frozen Node bundle before execution, and owns a persistent worker process. The
worker calls Kavi's TypeScript memory modules; a local `better-sqlite3` adapter
provides the same synchronous `expo-sqlite` API shape required by those modules
during local benchmark execution.

The upstream LongMemEval-V2 harness performs all question selection, prompt
construction, reader-model calls, judge-model scoring, aggregation, latency
measurement, LAFS calculation, and leaderboard packaging.
