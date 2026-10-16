// ---------------------------------------------------------------------------
// Kavi — Claw-Anything: one benchmark task as the adapter hands it to Kavi
// ---------------------------------------------------------------------------
// Claw-Anything (github.com/LiberCoders/Claw-Anything) runs a task's mock services and
// grades the trace; its Python adapter (benchmarks/claw_anything) writes this spec for one
// trial and reads back what Kavi did. The spec crosses a process boundary, so every field
// is checked here before Kavi sees any of it.

export type ClawAnythingTool = Readonly<{
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}>;

export type ClawAnythingLogFile = Readonly<{ path: string; content: string }>;

export type ClawAnythingTaskSpec = Readonly<{
  taskId: string;
  prompt: string;
  /** The task's day (YYYY-MM-DD); the mock services freeze "now" at its noon, UTC. */
  executionDate: string;
  timeoutSeconds: number;
  tools: ReadonlyArray<ClawAnythingTool>;
  /** Where each tool call goes: the benchmark's own dispatcher, which records it. */
  dispatchUrl: string;
  /** The person's activity logs, staged in Kavi's workspace at these paths. */
  activityLogs: ReadonlyArray<ClawAnythingLogFile>;
  /**
   * What the benchmark tells every harness about the person's setup (where the logs are),
   * given to Kavi as the person's own instructions.
   */
  instructions: string;
  outPath: string;
}>;

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TIMEOUT_SECONDS = 7_200;

function fail(message: string): never {
  throw new Error(`Invalid Claw-Anything task spec: ${message}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, { allowEmpty = false } = {}): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    fail(`${field} must be ${allowEmpty ? 'a string' : 'non-empty text'}`);
  }
  return value;
}

function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
}

function parseTool(value: unknown, index: number): ClawAnythingTool {
  const tool = record(value, `tools[${index}]`);
  const name = text(tool.name, `tools[${index}].name`);
  if (!TOOL_NAME.test(name))
    fail(`tools[${index}].name ${JSON.stringify(name)} is not a tool name`);
  const inputSchema = record(tool.inputSchema, `tools[${index}].inputSchema`);
  if (inputSchema.type !== 'object') fail(`tools[${index}].inputSchema must describe an object`);
  return {
    name,
    description: text(tool.description, `tools[${index}].description`, { allowEmpty: true }),
    inputSchema,
  };
}

function parseLogFile(value: unknown, index: number): ClawAnythingLogFile {
  const file = record(value, `activityLogs[${index}]`);
  const path = text(file.path, `activityLogs[${index}].path`);
  if (path.startsWith('/') || path.split('/').includes('..')) {
    fail(`activityLogs[${index}].path must stay inside the workspace`);
  }
  return {
    path,
    content: text(file.content, `activityLogs[${index}].content`, { allowEmpty: true }),
  };
}

export function parseClawAnythingTaskSpec(value: unknown): ClawAnythingTaskSpec {
  const spec = record(value, 'spec');
  const executionDate = text(spec.executionDate, 'executionDate');
  if (!DATE.test(executionDate) || Number.isNaN(Date.parse(`${executionDate}T12:00:00Z`))) {
    fail('executionDate must be YYYY-MM-DD');
  }
  const timeoutSeconds = spec.timeoutSeconds;
  if (
    typeof timeoutSeconds !== 'number' ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds <= 0 ||
    timeoutSeconds > MAX_TIMEOUT_SECONDS
  ) {
    fail(`timeoutSeconds must be a whole number of seconds up to ${MAX_TIMEOUT_SECONDS}`);
  }
  const dispatchUrl = text(spec.dispatchUrl, 'dispatchUrl');
  let dispatch: URL;
  try {
    dispatch = new URL(dispatchUrl);
  } catch {
    fail('dispatchUrl is not a URL');
  }
  if (dispatch.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(dispatch.hostname)) {
    fail('dispatchUrl must be a loopback http URL');
  }
  const tools = list(spec.tools, 'tools').map(parseTool);
  if (tools.length === 0) fail('tools must not be empty');
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) fail('tool names repeat');
  return {
    taskId: text(spec.taskId, 'taskId'),
    prompt: text(spec.prompt, 'prompt'),
    executionDate,
    timeoutSeconds,
    tools,
    dispatchUrl,
    activityLogs: list(spec.activityLogs, 'activityLogs').map(parseLogFile),
    instructions: text(spec.instructions, 'instructions', { allowEmpty: true }),
    outPath: text(spec.outPath, 'outPath'),
  };
}

/** The task's "now": noon UTC on its day, as the mock services freeze it. */
export function clawAnythingTaskNow(spec: Pick<ClawAnythingTaskSpec, 'executionDate'>): number {
  return Date.parse(`${spec.executionDate}T12:00:00Z`);
}
