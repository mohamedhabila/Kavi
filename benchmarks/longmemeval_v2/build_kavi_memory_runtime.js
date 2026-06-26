#!/usr/bin/env node

const path = require('node:path');
const esbuild = require('esbuild');

function parseArgs(argv) {
  const args = { out: null };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const args = parseArgs(process.argv);
  const outfile =
    args.out || path.join(repoRoot, '.private', 'evals', 'runtime', 'kavi_memory_runtime.cjs');
  const expoSqliteShim = path.join(__dirname, 'nodeExpoSqlite.ts');
  const embeddingsStub = path.join(__dirname, 'runtimeEmbeddingsStub.ts');
  const memoryStoreStub = path.join(__dirname, 'runtimeMemoryStoreStub.ts');
  const memoryPolicyStub = path.join(__dirname, 'runtimeMemoryPolicyStub.ts');

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'kavi_memory_runtime.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: ['node22'],
    format: 'cjs',
    external: ['better-sqlite3', 'react-native'],
    sourcemap: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'kavi-benchmark-aliases',
        setup(build) {
          build.onResolve({ filter: /^expo-sqlite$/ }, () => ({ path: expoSqliteShim }));
          build.onResolve({ filter: /^\.\/embeddings$/ }, (args) => {
            if (args.importer.includes(path.join('src', 'services', 'memory'))) {
              return { path: embeddingsStub };
            }
            return null;
          });
          build.onResolve({ filter: /^\.\/policy$/ }, (args) => {
            if (args.importer.includes(path.join('src', 'services', 'memory'))) {
              return { path: memoryPolicyStub };
            }
            return null;
          });
          build.onResolve({ filter: /^\.\/store$/ }, (args) => {
            if (args.importer.endsWith(path.join('src', 'services', 'memory', 'sqlite-store.ts'))) {
              return { path: memoryStoreStub };
            }
            return null;
          });
        },
      },
    ],
  });

  console.log(JSON.stringify({ runtime_bundle: outfile }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
