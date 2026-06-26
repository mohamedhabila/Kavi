# Kavi Isolated Memory for LongMemEval-V2

Kavi is a mobile-first general assistant with a structured long-term memory
system. This LongMemEval-V2 submission evaluates that memory system in
isolation, not the Kavi assistant graph.

The submitted memory backend uses the official LongMemEval `Memory` interface:

- `insert()` forwards each official trajectory to a persistent local Kavi
  memory runtime.
- The runtime stores trajectory state/action histories in Kavi's SQLite memory
  chunk store and records trajectory-level episodes through Kavi's memory
  episode API.
- `query()` calls Kavi's SQLite hybrid memory search over the stored trajectory
  memory and returns compact text context items to the official harness.

The Python adapter does not implement retrieval, ranking, summarization, or
question answering. It only maintains the official benchmark boundary and a
persistent Node worker process. The Node worker calls Kavi's TypeScript memory
store; a local `better-sqlite3` adapter provides the same synchronous
`expo-sqlite` API shape required by Kavi's mobile memory modules during local
benchmark execution.

The upstream LongMemEval-V2 harness performs all question selection, prompt
construction, reader-model calls, judge-model scoring, aggregation, latency
measurement, LAFS calculation, and leaderboard packaging.
