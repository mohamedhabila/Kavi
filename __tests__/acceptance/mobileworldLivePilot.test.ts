jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import { spawn, spawnSync } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import path from 'path';

import { buildE2EProvider } from '../../src/acceptance/e2eAgent/providerConfig';
import { runForegroundScenario } from '../../src/acceptance/e2eAgent/foregroundScenarioDriver';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { Message } from '../../src/types/message';

type JsonObject = Record<string, unknown>;

type BridgeSession = {
  instruction: string;
  messages: Message[];
  rootConversationId: string;
  turns: number;
  repairs: number;
};

type ProcessResult = {
  code: number;
  durationMs: number;
  output: string;
};

const describeLivePilot = process.env.RUN_MOBILEWORLD_PILOT === '1' ? describe : describe.skip;
const MAX_BRIDGE_REQUEST_BYTES = 12_000_000;
const RETAINED_PRIOR_SCREENSHOTS = 2;
const OMITTED_SCREEN_MARKER = '[Earlier mobile screenshot omitted after observation.]';

function sendJson(response: ServerResponse, status: number, body: JsonObject): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BRIDGE_REQUEST_BYTES) throw new Error('bridge_request_too_large');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('bridge_request_must_be_object');
  }
  return parsed as JsonObject;
}

function requirePayloadText(payload: JsonObject, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`bridge_${field}_invalid`);
  return value.trim();
}

function requirePayloadInteger(payload: JsonObject, field: string): number {
  const value = payload[field];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`bridge_${field}_invalid`);
  }
  return Number(value);
}

function requirePayloadNonnegativeInteger(payload: JsonObject, field: string): number {
  const value = payload[field];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`bridge_${field}_invalid`);
  }
  return Number(value);
}

function readPayloadBoolean(payload: JsonObject, field: string): boolean {
  const value = payload[field];
  if (typeof value !== 'boolean') throw new Error(`bridge_${field}_invalid`);
  return value;
}

function readPreviousAction(payload: JsonObject): JsonObject | null {
  const value = payload.previous_action;
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('bridge_previous_action_invalid');
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 4_000) throw new Error('bridge_previous_action_too_large');
  return value as JsonObject;
}

function decodePng(payload: JsonObject): { base64: string; bytes: number } {
  const base64 = requirePayloadText(payload, 'screenshot_base64');
  const decoded = Buffer.from(base64, 'base64');
  if (
    decoded.length === 0 ||
    decoded.length > 8_000_000 ||
    !decoded.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error('bridge_screenshot_invalid');
  }
  return { base64, bytes: decoded.length };
}

function cloneMessages(messages: ReadonlyArray<Message>): Message[] {
  return JSON.parse(JSON.stringify(messages)) as Message[];
}

function compactScreenshotHistory(messages: ReadonlyArray<Message>): Message[] {
  const clone = cloneMessages(messages);
  const imageMessageIndexes = clone.flatMap((message, index) =>
    message.attachments?.some((attachment) => attachment.name.startsWith('mobileworld-screen-'))
      ? [index]
      : [],
  );
  const remove = new Set(
    imageMessageIndexes.slice(
      0,
      Math.max(0, imageMessageIndexes.length - RETAINED_PRIOR_SCREENSHOTS),
    ),
  );
  for (const index of remove) {
    const message = clone[index];
    if (!message) continue;
    message.attachments = message.attachments?.filter(
      (attachment) => !attachment.name.startsWith('mobileworld-screen-'),
    );
    if (message.attachments?.length === 0) delete message.attachments;
    if (!message.content.includes(OMITTED_SCREEN_MARKER)) {
      message.content = `${message.content}\n${OMITTED_SCREEN_MARKER}`;
    }
  }
  return clone;
}

function buildPolicyPrompt(params: {
  attempt: number;
  height: number;
  instruction: string;
  isRepair: boolean;
  scaleFactor: number;
  stepIndex: number;
  previousAction: JsonObject | null;
  unchangedObservationCount: number;
  visualStateUnchanged: boolean;
  width: number;
}): string {
  return `You are operating the Android device shown in the attached current screenshot.

User objective: ${params.instruction}
Environment step: ${params.stepIndex}; policy attempt: ${params.attempt}.
Screenshot dimensions: ${params.width} x ${params.height} pixels.
Previous executed action: ${params.previousAction ? JSON.stringify(params.previousAction) : 'none'}.
Exact visible-screen match with the preceding observation: ${params.visualStateUnchanged ? 'unchanged' : 'changed or first observation'}.
Consecutive exact unchanged observations: ${params.unchangedObservationCount}.
${params.isRepair ? 'The previous response failed the typed action contract. Recover by returning one valid action for the unchanged current screen.' : ''}

The JSON Action is your device-control interface: MobileWorld will execute it after this response even though Kavi's ordinary product tools are disabled. Operate the device yourself. Do not ask the user to perform the steps. For a state-changing objective, an instructional answer is not completion; continue with a device action. Use answer only when the original objective requests information that you have obtained from the device.

Choose the next single action that makes progress. Reassess the screenshot after every action. An exact unchanged observation is structural evidence that the preceding action made no visible progress; choose a materially different action unless repetition is deliberately required. If an action was mistaken or ineffective, try a materially different route; do not stop merely because one attempt failed. Mark completion only when the visible device state supports it.

Maintain a compact semantic completion ledger for the full user objective. Before acting, identify which still-unmet requirement the action advances. Before answer or status complete, reread the objective and verify every requirement separately against the current screen and previously confirmed state. If any requirement is absent, only partially satisfied, ambiguous, or contradicted, continue instead of terminating.

Coordinates are normalized integers in [0, ${params.scaleFactor}] from the screenshot's top-left corner. Return exactly these two fields and no Markdown fence:
Thought: concise decision rationale
Action: one JSON object

Valid JSON forms:
{"action_type":"click","coordinate":[x,y]}
{"action_type":"double_tap","coordinate":[x,y]}
{"action_type":"long_press","coordinate":[x,y]}
{"action_type":"drag","start_coordinate":[x1,y1],"end_coordinate":[x2,y2]}
{"action_type":"input_text","text":"text"}
{"action_type":"keyboard_enter"}
{"action_type":"navigate_home"}
{"action_type":"navigate_back"}
{"action_type":"open_app","app_name":"app"}
{"action_type":"scroll","direction":"up|down|left|right"}
{"action_type":"wait"}
{"action_type":"ask_user","text":"question"}
{"action_type":"answer","text":"answer"}
{"action_type":"status","goal_status":"complete|infeasible"}

For scroll, direction names the content movement and MobileWorld performs the inverse finger swipe. Use drag, not scroll, when the finger-gesture direction itself matters.`;
}

function requireCompletedTurn(result: Awaited<ReturnType<typeof runForegroundScenario>>) {
  const turn = result.turns[0];
  if (
    !turn ||
    turn.error ||
    turn.timedOut ||
    !turn.completion.executionCompleted ||
    !turn.completion.finalResponseCompleted ||
    turn.finalAssistant?.completionStatus !== 'complete' ||
    !turn.finalAssistant.text.trim()
  ) {
    throw new Error(`foreground_chat_incomplete:${turn?.error ?? 'missing_final'}`);
  }
  return turn;
}

function usagePayload(turn: ReturnType<typeof requireCompletedTurn>) {
  return {
    input_tokens: turn.usage?.totalInput ?? 0,
    output_tokens: turn.usage?.totalOutput ?? 0,
    total_tokens: turn.usage?.totalTokens ?? 0,
  };
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bridge_address_unavailable');
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runAdb(device: string, args: string[]): string {
  const result = spawnSync('adb', ['-s', device, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`adb_failed:${[...args].join(' ')}:${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function runSqlite(device: string, database: string, sql: string, args: string[] = []): string {
  if (sql.includes("'")) throw new Error('sqlite_query_contains_unsupported_quote');
  return runAdb(device, ['shell', 'sqlite3', ...args, database, `'${sql}'`]);
}

async function prepareAlarmState(device: string, database: string): Promise<void> {
  spawnSync('adb', ['root'], { encoding: 'utf8' });
  spawnSync('adb', ['wait-for-device'], { encoding: 'utf8' });
  runAdb(device, [
    'shell',
    'am',
    'start',
    '-n',
    'com.google.android.deskclock/com.android.deskclock.DeskClock',
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  runAdb(device, ['shell', 'am', 'force-stop', 'com.google.android.deskclock']);
  runSqlite(device, database, 'DELETE FROM alarm_instances;');
  runSqlite(device, database, 'DELETE FROM alarm_templates;');
  runAdb(device, [
    'shell',
    'am',
    'start',
    '-n',
    'com.google.android.deskclock/com.android.deskclock.DeskClock',
  ]);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function prepareLocalTaskSnapshot(device: string): Promise<void> {
  spawnSync('adb', ['root'], { encoding: 'utf8' });
  spawnSync('adb', ['wait-for-device'], { encoding: 'utf8' });
  runAdb(device, ['shell', 'am', 'force-stop', 'com.google.android.deskclock']);
  runAdb(device, ['shell', 'pm', 'clear', 'com.google.android.deskclock']);
  runAdb(device, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
  spawnSync('adb', ['-s', device, 'emu', 'avd', 'snapshot', 'delete', 'init_state'], {
    encoding: 'utf8',
  });
  runAdb(device, ['emu', 'avd', 'snapshot', 'save', 'init_state']);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

function verifyAlarmState(
  device: string,
  database: string,
  hour: number,
  minute: number,
): string[] {
  const output = runSqlite(
    device,
    database,
    `SELECT hour,minutes,enabled,label FROM alarm_templates WHERE hour=${hour} AND minutes=${minute} AND enabled=1;`,
  );
  return output.split('\n').filter(Boolean);
}

async function ensureAdbKeyboard(upstreamDir: string, device: string): Promise<void> {
  const python = path.join(upstreamDir, '.venv/bin/python');
  const source = [
    'import sys',
    'from mobile_world.core.user_task_runner.prerequisite import _check_adb_keyboard_installed, _install_adb_keyboard',
    'device = sys.argv[1]',
    'raise SystemExit(0 if _check_adb_keyboard_installed(device) or _install_adb_keyboard(device) else 1)',
  ].join('; ');
  const result = spawnSync(python, ['-c', source, device], {
    cwd: upstreamDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`adb_keyboard_setup_failed:${result.stderr.trim()}`);
}

async function runPilotProcess(params: {
  bridgeToken: string;
  bridgeUrl: string;
  device: string;
  goal: string;
  outputDir: string;
  taskName: string | null;
  upstreamDir: string;
}): Promise<ProcessResult> {
  const projectRoot = path.resolve(__dirname, '../..');
  const uv = process.env.MOBILEWORLD_UV?.trim() || 'uv';
  const benchmarkArgs = params.taskName
    ? ['eval', '--task', params.taskName, '--auto-retry', '0']
    : ['test', params.goal];
  const child = spawn(
    uv,
    [
      'run',
      'mobile-world',
      ...benchmarkArgs,
      '--agent-type',
      path.join(projectRoot, 'benchmarks/mobileworld/kavi_agent.py'),
      '--model-name',
      'kavi-foreground-chat',
      '--llm-base-url',
      'http://127.0.0.1/unused',
      '--api-key',
      'empty',
      '--log-file-root',
      params.outputDir,
      '--max-step',
      process.env.MOBILEWORLD_PILOT_MAX_STEPS?.trim() || '12',
      '--aw-host',
      process.env.MOBILEWORLD_AW_HOST?.trim() || 'http://127.0.0.1:6800',
      '--device',
      params.device,
      '--step-wait-time',
      '0.5',
    ],
    {
      cwd: params.upstreamDir,
      env: {
        ...process.env,
        KAVI_MOBILEWORLD_BRIDGE_TOKEN: params.bridgeToken,
        KAVI_MOBILEWORLD_BRIDGE_URL: params.bridgeUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const startedAt = Date.now();
  let output = '';
  const append = (chunk: Buffer, destination: NodeJS.WriteStream) => {
    destination.write(chunk);
    if (output.length < 2_000_000) output += chunk.toString('utf8');
  };
  child.stdout.on('data', (chunk: Buffer) => append(chunk, process.stdout));
  child.stderr.on('data', (chunk: Buffer) => append(chunk, process.stderr));

  return await new Promise<ProcessResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error('MobileWorld pilot exceeded its 20 minute deadline.'));
      },
      20 * 60 * 1_000,
    );
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code: code ?? 1, durationMs: Date.now() - startedAt, output });
    });
  });
}

function gitValue(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

describeLivePilot('MobileWorld — exact foreground-chat device pilot', () => {
  jest.setTimeout(21 * 60 * 1_000);

  afterAll(() => {
    teardownE2EMemorySandbox();
  });

  it('creates the requested alarm and verifies the device database state', async () => {
    resetE2EMemorySandbox();
    await useSettingsStore.persist.rehydrate();
    const provider = buildE2EProvider();
    const systemPrompt = useSettingsStore.getState().systemPrompt;
    const projectRoot = path.resolve(__dirname, '../..');
    const upstreamDir = requirePayloadText(process.env as JsonObject, 'MOBILEWORLD_UPSTREAM_DIR');
    const outputDir = requirePayloadText(process.env as JsonObject, 'MOBILEWORLD_OUTPUT_DIR');
    const device = process.env.MOBILEWORLD_DEVICE?.trim() || 'emulator-5554';
    const hour = 8;
    const minute = 17;
    const goal = 'Create and enable an alarm for 8:17 AM.';
    const taskName = process.env.MOBILEWORLD_TASK?.trim() || null;
    const alarmDatabase = '/data/user_de/0/com.google.android.deskclock/databases/alarms.db';
    const bridgeToken = randomBytes(32).toString('hex');
    const sessions = new Map<string, BridgeSession>();

    await ensureAdbKeyboard(upstreamDir, device);
    if (taskName) {
      await prepareLocalTaskSnapshot(device);
    } else {
      await prepareAlarmState(device, alarmDatabase);
    }

    const server = createServer((request, response) => {
      void (async () => {
        try {
          if (
            request.method !== 'POST' ||
            request.socket.remoteAddress !== '127.0.0.1' ||
            request.headers.authorization !== `Bearer ${bridgeToken}`
          ) {
            sendJson(response, 403, { ok: false, error: 'bridge_access_denied' });
            return;
          }
          const payload = await readJsonBody(request);
          const action = requirePayloadText(payload, 'action');
          const sessionId = requirePayloadText(payload, 'session_id');
          if (!/^[A-Za-z0-9._-]{1,100}$/u.test(sessionId)) {
            throw new Error('bridge_session_id_invalid');
          }
          if (action === 'reset') {
            sessions.set(sessionId, {
              instruction: requirePayloadText(payload, 'instruction'),
              messages: [],
              rootConversationId: `mobileworld-${randomUUID()}`,
              turns: 0,
              repairs: 0,
            });
            sendJson(response, 200, {
              ok: true,
              metadata: {
                provider: { family: provider.providerFamily, model: provider.model },
              },
            });
            return;
          }
          if (action !== 'act' && action !== 'repair') throw new Error('bridge_action_invalid');
          const session = sessions.get(sessionId);
          if (!session) throw new Error('bridge_session_unavailable');
          const screenshot = decodePng(payload);
          const stepIndex = requirePayloadInteger(payload, 'step_index');
          const attempt = requirePayloadInteger(payload, 'attempt');
          const width = requirePayloadInteger(payload, 'screenshot_width');
          const height = requirePayloadInteger(payload, 'screenshot_height');
          const previousAction = readPreviousAction(payload);
          const visualStateUnchanged = readPayloadBoolean(payload, 'visual_state_unchanged');
          const unchangedObservationCount = requirePayloadNonnegativeInteger(
            payload,
            'unchanged_observation_count',
          );
          const scaleFactor = 1000;
          const result = await runForegroundScenario({
            provider,
            conversationId: session.rootConversationId,
            conversationTitle: 'MobileWorld device pilot',
            systemPrompt,
            initialMessages: session.messages,
            defaultMode: 'chitchat',
            scenarioTimeoutMs: 300_000,
            timeoutMs: 240_000,
            maxTokens: 1_024,
            disableLongTermMemory: true,
            disableTools: true,
            enableCompaction: false,
            turns: [
              {
                content: buildPolicyPrompt({
                  attempt,
                  height,
                  instruction: session.instruction,
                  isRepair: action === 'repair',
                  previousAction,
                  scaleFactor,
                  stepIndex,
                  unchangedObservationCount,
                  visualStateUnchanged,
                  width,
                }),
                attachments: [
                  {
                    id: `mobileworld-screen-${stepIndex}-${attempt}`,
                    type: 'image',
                    uri: `inline://mobileworld-screen-${stepIndex}-${attempt}.png`,
                    name: `mobileworld-screen-${stepIndex}-${attempt}.png`,
                    mimeType: 'image/png',
                    size: screenshot.bytes,
                    base64: screenshot.base64,
                  },
                ],
                route: 'forced_chitchat',
              },
            ],
          });
          const turn = requireCompletedTurn(result);
          session.messages = compactScreenshotHistory(result.finalConversation.messages);
          session.turns += 1;
          if (action === 'repair') session.repairs += 1;
          sendJson(response, 200, {
            ok: true,
            response: turn.finalAssistant!.text,
            usage: usagePayload(turn),
            diagnostics: {
              graph_status: turn.completion.graphStatus,
              route: turn.route.mode,
            },
          });
        } catch (error) {
          sendJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });

    const bridgePort = await listenOnLoopback(server);
    let processResult: ProcessResult;
    try {
      processResult = await runPilotProcess({
        bridgeToken,
        bridgeUrl: `http://127.0.0.1:${bridgePort}`,
        device,
        goal,
        outputDir,
        taskName,
        upstreamDir,
      });
    } finally {
      await closeServer(server);
    }

    const resultPath = taskName ? path.join(outputDir, taskName, 'result.txt') : null;
    const officialResult =
      resultPath && fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : '';
    const scoreMatch = officialResult.match(/^score:\s*([0-9.]+)$/mu);
    const officialScore = scoreMatch ? Number(scoreMatch[1]) : null;
    const verifiedRows = taskName ? [] : verifyAlarmState(device, alarmDatabase, hour, minute);
    const stateVerified = taskName ? officialScore === 1 : verifiedRows.length > 0;
    const session = [...sessions.values()][0];
    const appStatus = gitValue(['-C', projectRoot, 'status', '--porcelain']);
    const upstreamStatus = gitValue(['-C', upstreamDir, 'status', '--porcelain']);
    const summary = {
      kind: 'kavi_mobileworld_device_pilot_result',
      schema_version: 1,
      created_at: new Date().toISOString(),
      claim_status: taskName
        ? 'local_official_task_diagnostic_custom_avd'
        : 'non_official_ad_hoc_device_pilot',
      claim_eligible: processResult.code === 0 && stateVerified && !appStatus,
      app: {
        commit: gitValue(['-C', projectRoot, 'rev-parse', 'HEAD']),
        worktree_clean: !appStatus,
      },
      upstream: {
        repository: 'https://github.com/Tongyi-MAI/MobileWorld',
        commit: gitValue(['-C', upstreamDir, 'rev-parse', 'HEAD']),
        worktree_clean: !upstreamStatus,
      },
      provider: {
        family: provider.providerFamily,
        model: provider.model,
        base_url: provider.baseUrl,
      },
      protocol: {
        exact_foreground_chat: true,
        foreground_mode: 'chitchat',
        internal_agentic_control_graph: false,
        benchmark_owned_action_loop: true,
        upstream_action_parser: true,
        upstream_device_controller: true,
        official_task_initialization: Boolean(taskName),
        official_task_scorer: Boolean(taskName),
        official_environment_image: false,
      },
      device: {
        id: device,
        model: runAdb(device, ['shell', 'getprop', 'ro.product.model']),
        sdk: runAdb(device, ['shell', 'getprop', 'ro.build.version.sdk']),
      },
      task: {
        name: taskName,
        goal: session?.instruction ?? goal,
        max_steps: Number(process.env.MOBILEWORLD_PILOT_MAX_STEPS || 12),
      },
      result: {
        process_exit_code: processResult.code,
        duration_ms: processResult.durationMs,
        bridge_turns: session?.turns ?? 0,
        repair_turns: session?.repairs ?? 0,
        official_score: officialScore,
        state_verified: stateVerified,
        verified_rows: verifiedRows,
      },
    };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'pilot-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    );

    expect(processResult.code).toBe(0);
    if (taskName) {
      expect(officialScore).toBe(1);
    } else {
      expect(verifiedRows).toContain(`${hour}|${minute}|1|`);
    }
    expect(session?.turns).toBeGreaterThan(0);
  });
});
