#!/usr/bin/env node

const path = require('node:path');
const esbuild = require('esbuild');

function parseArgs(argv) {
  const args = { out: null };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] !== '--out' || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    }
    args.out = argv[index + 1];
    index += 1;
  }
  return args;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const args = parseArgs(process.argv);
  const outfile =
    args.out || path.join(repoRoot, '.private', 'evals', 'runtime', 'kavi_state_bench.cjs');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'kavi_state_bench_runtime.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: ['node20'],
    format: 'cjs',
    sourcemap: false,
    logLevel: 'silent',
  });
  process.stdout.write(`${JSON.stringify({ runtime_bundle: outfile })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
