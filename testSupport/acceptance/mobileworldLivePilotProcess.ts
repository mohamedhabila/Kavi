import { spawn, spawnSync } from 'child_process';
import path from 'path';

const PILOT_PROCESS_TIMEOUT_MS = 20 * 60 * 1_000;

export type MobileWorldPilotProcessResult = {
  code: number;
  durationMs: number;
  output: string;
};

export function runAdb(device: string, args: string[]): string {
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

export async function prepareAlarmState(device: string, database: string): Promise<void> {
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

export async function prepareLocalTaskSnapshot(device: string): Promise<void> {
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

export function verifyAlarmState(
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

export async function ensureAdbKeyboard(upstreamDir: string, device: string): Promise<void> {
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

  const expectedInputMethod = 'com.android.adbkeyboard/.AdbIME';
  let observedInputMethod = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    runAdb(device, ['shell', 'ime', 'enable', expectedInputMethod]);
    runAdb(device, ['shell', 'ime', 'set', expectedInputMethod]);
    observedInputMethod = runAdb(device, [
      'shell',
      'settings',
      'get',
      'secure',
      'default_input_method',
    ]);
    if (observedInputMethod === expectedInputMethod) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`adb_keyboard_activation_failed:${observedInputMethod || 'unavailable'}`);
}

export async function runPilotProcess(params: {
  bridgeToken: string;
  bridgeUrl: string;
  device: string;
  goal: string;
  outputDir: string;
  taskName: string | null;
  upstreamDir: string;
}): Promise<MobileWorldPilotProcessResult> {
  const projectRoot = path.resolve(__dirname, '../..');
  const uv = process.env.MOBILEWORLD_UV?.trim() || 'uv';
  const maxSteps =
    process.env.MOBILEWORLD_PILOT_MAX_STEPS?.trim() || (params.taskName ? '50' : '12');
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
      maxSteps,
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

  return await new Promise<MobileWorldPilotProcessResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('MobileWorld pilot exceeded its 20 minute deadline.'));
    }, PILOT_PROCESS_TIMEOUT_MS);
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

export function gitValue(args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}
