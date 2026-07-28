#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { applyEnvFile } = require('./load-local-env');
const {
  applyProjectLocalEnv,
  exitWithStatus,
  fail,
  requireE2eAgentEvalEnv,
  resolveProjectRoot,
  runJest,
} = require('./lib/harness');
const { readFirstEnvValue, resolveE2eProviderSpec } = require('./e2eReport/provider');

const label = 'long-task-actual-work-pilot';
const projectRoot = resolveProjectRoot();

applyProjectLocalEnv(projectRoot);
applyEnvFile(path.join(projectRoot, '.env'));
process.env.RUN_E2E_AGENT_EVAL = '1';
process.env.RUN_LONG_TASK_ACTUAL_WORK_PILOT = '1';

function writeInfrastructureInvalidEvidence(evidencePath, details) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        infrastructureValidity: 'invalid',
        provider: 'openrouter',
        model: process.env.E2E_OPENROUTER_MODEL,
        observedAt: new Date().toISOString(),
        ...details,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function checkProviderConnectivity(providerSpec, evidencePath) {
  const baseUrl =
    readFirstEnvValue(process.env, providerSpec.baseUrlEnv) || providerSpec.defaultBaseUrl;
  const apiKey = readFirstEnvValue(process.env, providerSpec.apiKeyEnv);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/u, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    await response.body?.cancel();
    if (!response.ok) {
      writeInfrastructureInvalidEvidence(evidencePath, {
        failureClass: 'provider_connectivity_http',
        httpStatus: response.status,
      });
      return false;
    }
    return true;
  } catch (error) {
    writeInfrastructureInvalidEvidence(evidencePath, {
      failureClass: 'provider_connectivity_network',
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode:
        error && typeof error === 'object' && error.cause && typeof error.cause === 'object'
          ? error.cause.code
          : undefined,
    });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const providerSpec = resolveE2eProviderSpec(process.env);
  if (providerSpec.key !== 'openrouter') {
    exitWithStatus(
      fail(
        label,
        `This pilot is intentionally pinned to OpenRouter; resolved E2E_PROVIDER=${providerSpec.key}.`,
      ),
    );
  }

  const environmentStatus = requireE2eAgentEvalEnv(label);
  if (environmentStatus !== 0) exitWithStatus(environmentStatus);

  const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const evidencePath =
    process.env.LONG_TASK_ACTUAL_WORK_EVIDENCE_PATH?.trim() ||
    path.join(projectRoot, '.private', 'evals', 'long-task-actual-work', `${runStamp}.json`);
  process.env.LONG_TASK_ACTUAL_WORK_EVIDENCE_PATH = evidencePath;

  console.log(
    `[${label}] provider=openrouter model=${process.env.E2E_OPENROUTER_MODEL} evidence=${evidencePath}`,
  );
  if (!(await checkProviderConnectivity(providerSpec, evidencePath))) {
    exitWithStatus(
      fail(
        label,
        `Provider connectivity preflight failed; infrastructure-invalid evidence remains at ${evidencePath}.`,
      ),
    );
  }
  console.log(
    `[${label}] Target: 14-25 active worker minutes from source inspection, checkpointing, adversarial verification, and remediation planning; worker wait tools are forbidden and progress evidence is durable.`,
  );

  const status = runJest({
    projectRoot,
    testPaths: ['__tests__/acceptance/longTaskActualWorkLivePilot.test.ts'],
  });

  if (status !== 0) {
    exitWithStatus(
      fail(label, `Substantive long-task validation failed. Evidence remains at ${evidencePath}.`),
    );
  }

  console.log(`[${label}] Substantive long-task validation passed. Evidence: ${evidencePath}`);
  exitWithStatus(0);
}

void main().catch((error) => {
  exitWithStatus(fail(label, error instanceof Error ? error.message : String(error)));
});
