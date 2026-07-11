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
  const embeddingsStub = path.join(__dirname, 'runtimeSimpleEmbeddingsStub.ts');
  const memoryPolicyStub = path.join(__dirname, 'runtimeMemoryPolicyStub.ts');
  const secureStorageStub = path.join(__dirname, 'runtimeSecureStorageStub.ts');
  const reactNativeStub = path.join(__dirname, 'runtimeReactNativeStub.ts');
  const expoFileSystemStub = path.join(__dirname, 'runtimeExpoFileSystemStub.ts');
  const expoFetchStub = path.join(__dirname, 'runtimeExpoFetchStub.ts');
  const expoCryptoStub = path.join(__dirname, 'runtimeExpoCryptoStub.ts');

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'kavi_memory_runtime.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: ['node22'],
    format: 'cjs',
    define: { __DEV__: 'false' },
    external: ['better-sqlite3'],
    sourcemap: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'kavi-benchmark-aliases',
        setup(build) {
          build.onResolve({ filter: /^expo-sqlite$/ }, () => ({ path: expoSqliteShim }));
          build.onResolve({ filter: /^expo\/fetch$/ }, () => ({ path: expoFetchStub }));
          build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: expoCryptoStub }));
          build.onResolve({ filter: /^expo-file-system$/ }, () => ({
            path: expoFileSystemStub,
          }));
          build.onResolve({ filter: /^react-native$/ }, () => ({ path: reactNativeStub }));
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
          build.onResolve({ filter: /SecureStorage$/ }, () => ({
            path: secureStorageStub,
          }));
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
