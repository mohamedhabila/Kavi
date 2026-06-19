import {
  auditE2EBenchmarkManifests,
  E2E_BENCHMARK_MANIFEST_VERSION,
  E2E_BENCHMARK_SOURCE_REFRESH_DATE,
  listE2EBenchmarkManifests,
  listE2EBenchmarkRequirements,
} from '../../src/acceptance/e2eAgent/e2eBenchmarkManifest';
import {
  DELEGATION_E2E_SCENARIOS,
  E2E_AGENT_SCENARIOS,
} from '../../src/acceptance/e2eAgent/scenarios';
import { E2E_BENCHMARK_SCENARIOS } from '../../src/acceptance/e2eAgent/benchmarkScenarios';
import { listE2EBenchmarkRequirements as listRequirementCatalog } from '../../src/acceptance/e2eAgent/e2eBenchmarkRequirements';

describe('e2eBenchmarkManifest', () => {
  it('keeps the benchmark scenario catalog order stable across implementation modules', () => {
    expect(E2E_BENCHMARK_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'bench-gaia-file-hop-chain',
      'bench-session-tool-cache',
      'bench-prompt-cache-long-horizon',
      'bench-prompt-cache-convergence-long-run',
      'bench-tool-describe-then-use',
      'bench-memory-state-3turn-recall',
      'bench-goal-json-field-criterion',
      'bench-scoped-recall-goal-switch',
      'bench-bootstrap-first-turn-goals',
      'bench-tau-native-json-outcome',
      'bench-tau-calendar-events-chain',
      'bench-agentbench-tool-chain',
      'bench-bfcl-parallel-file-read',
      'bench-bfcl-sequential-memory-chain',
      'bench-bfcl-multi-turn-state-carry',
      'bench-bfcl-passive-no-tools',
      'bench-longmem-delayed-recall',
      'bench-longmem-dual-fact-recall',
      'bench-longmem-knowledge-update-recall',
      'bench-longmem-abstention-empty-recall',
      'bench-androidworld-calendar-mutation',
      'bench-androidworld-permission-denial',
      'bench-mobileagent-contact-message-draft',
      'bench-mobileworld-discover-contact-message',
      'bench-knowu-personalized-contact-memory',
      'bench-androidworld-clipboard-share-notify',
      'bench-mobileagent-media-state',
    ]);
  });

  it('keeps the extracted requirement catalog available through the manifest API', () => {
    expect(listE2EBenchmarkRequirements()).toEqual(listRequirementCatalog());
  });

  it('generates complete versioned manifests for every live E2E scenario', () => {
    const scenarioIds = [
      ...E2E_AGENT_SCENARIOS.map((scenario) => scenario.id),
      ...DELEGATION_E2E_SCENARIOS.map((scenario) => scenario.id),
    ].sort();
    const manifests = listE2EBenchmarkManifests();

    expect(manifests.map((manifest) => manifest.scenarioId).sort()).toEqual(scenarioIds);

    for (const manifest of manifests) {
      expect(manifest.version).toBe(E2E_BENCHMARK_MANIFEST_VERSION);
      expect(manifest.sourceRefreshDate).toBe(E2E_BENCHMARK_SOURCE_REFRESH_DATE);
      expect(manifest.seed).toMatch(/^[a-f0-9]{16}$/);
      expect(manifest.hiddenGroundTruth).toMatchObject({
        visibleToAgent: false,
        fingerprintAlgorithm: 'stable-fnv1a-256',
      });
      expect(manifest.hiddenGroundTruth.fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.benchmarkFamilies.length).toBeGreaterThan(0);
      expect(manifest.assessmentDimensions.length).toBeGreaterThan(0);
      expect(manifest.finalStateEvaluators.length).toBeGreaterThan(0);
      expect(manifest.resourceBudgetEvaluators.length).toBeGreaterThan(0);
      expect(manifest.reset.required).toBe(true);
      expect(manifest.reset.procedure.length).toBeGreaterThan(0);
      expect(manifest.traceRequirements).toMatchObject({
        modelProviderAndVersion: true,
        promptSectionsAndTokenBuckets: true,
        toolSurfacePerTurn: true,
        toolCallsAndResults: true,
        graphStateHoldsAndResolutions: true,
        cacheEligibilityAndEvents: true,
      });
      expect(manifest.providerMatrix.map((entry) => entry.providerFamily).sort()).toEqual([
        'anthropic',
        'gemini',
        'local_mock',
        'openai',
        'openai_compatible',
      ]);
    }
  });

  it('derives mobile fixture evaluators and external runner requirements from scenario taxonomy', () => {
    const manifests = listE2EBenchmarkManifests();
    const calendarMutation = manifests.find(
      (manifest) => manifest.scenarioId === 'bench-androidworld-calendar-mutation',
    );
    const mediaState = manifests.find(
      (manifest) => manifest.scenarioId === 'bench-mobileagent-media-state',
    );

    expect(calendarMutation).toBeDefined();
    expect(calendarMutation?.environmentKind).toBe('native_fixture');
    expect(calendarMutation?.finalStateEvaluators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rubricKind: 'native_fixture_state',
          evidenceKind: 'native_fixture_state',
        }),
      ]),
    );
    expect(calendarMutation).not.toHaveProperty('permissions');
    expect(calendarMutation).not.toHaveProperty('expectedSideEffects');
    expect(calendarMutation).not.toHaveProperty('expectedToolEvidence');
    expect(calendarMutation?.externalRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentKind: 'android_emulator',
        }),
      ]),
    );

    expect(mediaState).toBeDefined();
    expect(mediaState?.traceRequirements.nativePermissionState).toBe(true);
    expect(mediaState?.traceRequirements.uiTreeAndScreenshots).toBe(true);
    expect(
      mediaState?.externalRequirements.map((requirement) => requirement.environmentKind),
    ).toEqual(expect.arrayContaining(['android_emulator', 'mobile_gui']));
  });

  it('keeps direct benchmark shards distinct from full external runners', () => {
    const manifests = listE2EBenchmarkManifests();
    const agentDojo = manifests.find(
      (manifest) => manifest.scenarioId === 'direct-agentdojo-untrusted-workspace-note',
    );
    const mobileWorld = manifests.find(
      (manifest) => manifest.scenarioId === 'direct-mobileworld-cross-app-contact-message',
    );
    const longMem = manifests.find(
      (manifest) => manifest.scenarioId === 'direct-longmemeval-v2-mobile-preference-update',
    );

    expect(agentDojo).toBeDefined();
    expect(agentDojo?.benchmarkFamilies).toContain('agentdojo-direct');
    expect(agentDojo?.environmentKind).toBe('node_fixture');
    expect(agentDojo?.finalStateEvaluators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rubricKind: 'workspace_file_absent',
          evidenceKind: 'workspace_artifact',
        }),
      ]),
    );
    expect(agentDojo?.externalRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentKind: 'security_fixture',
        }),
      ]),
    );

    expect(mobileWorld).toBeDefined();
    expect(mobileWorld?.benchmarkFamilies).toContain('mobileworld-direct');
    expect(mobileWorld?.environmentKind).toBe('native_fixture');
    expect(mobileWorld?.traceRequirements.uiTreeAndScreenshots).toBe(true);
    expect(mobileWorld?.externalRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentKind: 'mobile_gui',
        }),
      ]),
    );

    expect(longMem).toBeDefined();
    expect(longMem?.benchmarkFamilies).toContain('longmemeval-v2-direct');
    expect(longMem?.finalStateEvaluators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rubricKind: 'memory_fact_absent',
          evidenceKind: 'memory_store',
        }),
      ]),
    );
    expect(longMem?.externalRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentKind: 'provider_matrix',
        }),
      ]),
    );
  });

  it('registers long-run memory shards with structural final-state scoring and external parity requirements', () => {
    const manifests = listE2EBenchmarkManifests();
    const locomo = manifests.find(
      (manifest) => manifest.scenarioId === 'direct-locomo-temporal-conversation-memory',
    );
    const beam = manifests.find(
      (manifest) => manifest.scenarioId === 'direct-beam-long-dialogue-multi-probe',
    );
    const experience = manifests.find(
      (manifest) => manifest.scenarioId === 'direct-longmemeval-v2-experience-runbook',
    );
    const mobileLong = manifests.find(
      (manifest) => manifest.scenarioId === 'direct-mobileworld-long-horizon-personalization',
    );

    expect(locomo).toBeDefined();
    expect(locomo?.benchmarkFamilies).toEqual(
      expect.arrayContaining(['locomo-direct', 'longmemeval-v2-direct']),
    );
    expect(locomo?.initialState.userTurnCount).toBeGreaterThanOrEqual(7);
    expect(locomo?.finalStateEvaluators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rubricKind: 'memory_fact_absent',
          evidenceKind: 'memory_store',
        }),
        expect.objectContaining({
          rubricKind: 'workspace_file',
          evidenceKind: 'workspace_artifact',
        }),
      ]),
    );
    expect(locomo?.externalRequirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          environmentKind: 'provider_matrix',
        }),
      ]),
    );

    expect(beam).toBeDefined();
    expect(beam?.benchmarkFamilies).toContain('beam-direct');
    expect(beam?.initialState.userTurnCount).toBeGreaterThanOrEqual(9);
    expect(beam?.finalStateEvaluators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rubricKind: 'memory_fact_absent',
          evidenceKind: 'memory_store',
        }),
        expect.objectContaining({
          rubricKind: 'workspace_file',
          evidenceKind: 'workspace_artifact',
        }),
      ]),
    );

    expect(experience).toBeDefined();
    expect(experience?.benchmarkFamilies).toContain('longmemeval-v2-direct');
    expect(experience?.finalStateEvaluators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rubricKind: 'memory_fact',
          evidenceKind: 'memory_store',
        }),
        expect.objectContaining({
          rubricKind: 'workspace_file',
          evidenceKind: 'workspace_artifact',
        }),
      ]),
    );

    expect(mobileLong).toBeDefined();
    expect(mobileLong?.environmentKind).toBe('native_fixture');
    expect(mobileLong?.benchmarkFamilies).toEqual(
      expect.arrayContaining(['mobileworld-direct', 'locomo-direct', 'longmemeval-v2-direct']),
    );
    expect(mobileLong?.finalStateEvaluators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rubricKind: 'native_fixture_state',
          evidenceKind: 'native_fixture_state',
        }),
        expect.objectContaining({
          rubricKind: 'memory_fact_absent',
          evidenceKind: 'memory_store',
        }),
      ]),
    );
  });

  it('audits benchmark requirements without treating external runners as hidden passes', () => {
    const requirements = listE2EBenchmarkRequirements();
    const audit = auditE2EBenchmarkManifests();

    expect(audit).toMatchObject({
      passing: true,
      sourceRefreshDate: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
    });
    expect(audit.manifestCount).toBe(E2E_AGENT_SCENARIOS.length + DELEGATION_E2E_SCENARIOS.length);
    expect(audit.implementedRequirementCount).toBeGreaterThan(0);
    expect(audit.externalRequirementCount).toBeGreaterThan(0);
    expect(audit.issues).toEqual([]);

    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'androidworld-device-runner',
          coverageStatus: 'external_required',
          environmentKinds: ['android_emulator'],
        }),
        expect.objectContaining({
          id: 'agentdojo-prompt-injection',
          coverageStatus: 'external_required',
          environmentKinds: ['security_fixture'],
        }),
        expect.objectContaining({
          id: 'agentdojo-direct-untrusted-workspace-shard',
          coverageStatus: 'implemented',
          scenarioIds: ['direct-agentdojo-untrusted-workspace-note'],
        }),
        expect.objectContaining({
          id: 'provider-model-matrix',
          coverageStatus: 'implemented',
          environmentKinds: ['provider_matrix'],
        }),
        expect.objectContaining({
          id: 'locomo-direct-temporal-memory-shard',
          coverageStatus: 'implemented',
          scenarioIds: expect.arrayContaining(['direct-locomo-temporal-conversation-memory']),
        }),
        expect.objectContaining({
          id: 'beam-direct-long-dialogue-shard',
          coverageStatus: 'implemented',
          scenarioIds: ['direct-beam-long-dialogue-multi-probe'],
        }),
        expect.objectContaining({
          id: 'locomo-full-long-conversation-runner',
          coverageStatus: 'external_required',
          environmentKinds: ['provider_matrix'],
        }),
        expect.objectContaining({
          id: 'beam-full-long-dialogue-runner',
          coverageStatus: 'external_required',
          environmentKinds: ['provider_matrix'],
        }),
      ]),
    );
  });
});
