import {
  buildToolEffectReceipt as buildReceiptWithExecutionIdentity,
  verifyToolEffectReceiptIntegrity,
} from '../../src/engine/toolExecution/toolEffectReceipt';
import {
  buildCodeOwnedToolContractIdentity,
  buildRuntimeExternalToolContractIdentity,
  matchesCurrentCodeOwnedToolContractIdentity,
  type RuntimeExternalToolEvidence,
} from '../../src/engine/toolExecution/toolContractIdentity';
import * as effectContracts from '../../src/engine/toolExecution/toolEffectReceiptContracts';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';

const EXECUTION_RUN_ID = 'execution-run-1';

function buildToolEffectReceipt(
  params: Omit<Parameters<typeof buildReceiptWithExecutionIdentity>[0], 'executionRunId'>,
) {
  return buildReceiptWithExecutionIdentity({ executionRunId: EXECUTION_RUN_ID, ...params });
}

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MCP_EVIDENCE: RuntimeExternalToolEvidence = {
  declaration: {
    name: 'mcp__calendar__create_event',
    description: '[Calendar] Create event',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
  provenance: {
    source: 'mcp',
    namespace: 'calendar',
    connectionGeneration: 7,
    toolRegistryGeneration: 19,
    runtimeProcessEpoch: 'process-epoch-a',
    targetIdentity: 'https://calendar.example/mcp',
    transport: 'streamable-http',
    trustSource: 'manual',
  },
};
const SKILL_EVIDENCE: RuntimeExternalToolEvidence = {
  declaration: {
    name: 'skill__acme__deploy',
    description: '[Acme] Deploy',
    input_schema: { type: 'object', properties: {} },
  },
  provenance: {
    source: 'skill',
    namespace: 'acme',
    registrationGeneration: 11,
    runtimeProcessEpoch: 'process-epoch-a',
    name: 'Acme',
    version: '1.2.3',
    author: 'Acme',
  },
};

describe('code-owned tool contract identity', () => {
  it('seals all five actual first-party contract registries with canonical SHA-256', async () => {
    const identity = await buildCodeOwnedToolContractIdentity('write_file');

    expect(identity).toEqual({
      kind: 'code_owned',
      version: 1,
      toolName: 'write_file',
      schemaDigest: expect.stringMatching(SHA256_PATTERN),
      capabilityContractDigest: expect.stringMatching(SHA256_PATTERN),
      workflowContractDigest: expect.stringMatching(SHA256_PATTERN),
      effectContractDigest: expect.stringMatching(SHA256_PATTERN),
      executionPolicyDigest: expect.stringMatching(SHA256_PATTERN),
    });
    expect(Object.isFrozen(identity)).toBe(true);
    await expect(matchesCurrentCodeOwnedToolContractIdentity(identity!)).resolves.toBe(true);
  });

  it('normalizes registered aliases and keeps read and mutation calendar tools eligible', async () => {
    const [listIdentity, createIdentity, aliasReceipt] = await Promise.all([
      buildCodeOwnedToolContractIdentity('calendar_list'),
      buildCodeOwnedToolContractIdentity('calendar_create_event'),
      buildToolEffectReceipt({
        toolCallId: 'tc-calendar-alias',
        toolName: 'provider:calendar_list',
        argumentsText: '{}',
        resultText: '[]',
        transportState: 'returned',
        recordedAt: 1,
      }),
    ]);

    expect(listIdentity?.toolName).toBe('calendar_list');
    expect(createIdentity?.toolName).toBe('calendar_create_event');
    expect(aliasReceipt.toolName).toBe('calendar_list');
    expect(aliasReceipt.contractIdentity.toolName).toBe(aliasReceipt.toolName);
  });

  it('changes only the corresponding identities when registry contracts drift', async () => {
    const tool = TOOL_DEFINITIONS.find((candidate) => candidate.name === 'write_file');
    if (!tool?.contract) throw new Error('write_file registry fixture missing');
    const originalSchema = tool.input_schema;
    const originalContract = tool.contract;
    const baseline = (await buildCodeOwnedToolContractIdentity(tool.name))!;

    try {
      tool.input_schema = {
        ...originalSchema,
        properties: {
          ...originalSchema.properties,
          identityProbe: { type: 'string' },
        },
      };
      const schemaDrift = (await buildCodeOwnedToolContractIdentity(tool.name))!;
      expect(schemaDrift.schemaDigest).not.toBe(baseline.schemaDigest);
      expect(schemaDrift.capabilityContractDigest).toBe(baseline.capabilityContractDigest);

      tool.input_schema = originalSchema;
      tool.contract = {
        ...originalContract,
        capabilities: [...(originalContract.capabilities ?? []), 'compute'],
      };
      const capabilityDrift = (await buildCodeOwnedToolContractIdentity(tool.name))!;
      expect(capabilityDrift.capabilityContractDigest).not.toBe(baseline.capabilityContractDigest);
      expect(capabilityDrift.workflowContractDigest).toBe(baseline.workflowContractDigest);

      tool.contract = {
        ...originalContract,
        produces: [{ kind: 'identity_probe' }],
      };
      const workflowDrift = (await buildCodeOwnedToolContractIdentity(tool.name))!;
      expect(workflowDrift.workflowContractDigest).not.toBe(baseline.workflowContractDigest);
      expect(workflowDrift.executionPolicyDigest).toBe(baseline.executionPolicyDigest);

      tool.contract = { ...originalContract, sideEffects: ['destructive'] };
      const executionPolicyDrift = (await buildCodeOwnedToolContractIdentity(tool.name))!;
      expect(executionPolicyDrift.executionPolicyDigest).not.toBe(baseline.executionPolicyDigest);
      expect(executionPolicyDrift.effectContractDigest).toBe(baseline.effectContractDigest);
    } finally {
      tool.input_schema = originalSchema;
      tool.contract = originalContract;
    }
  });

  it('seals effect-registry drift independently from provider declarations', async () => {
    const baseline = (await buildCodeOwnedToolContractIdentity('write_file'))!;
    const originalGetter = effectContracts.getCodeOwnedToolEffectContract;
    const originalContract = originalGetter('write_file');
    if (!originalContract) throw new Error('write_file effect contract fixture missing');
    const getter = jest
      .spyOn(effectContracts, 'getCodeOwnedToolEffectContract')
      .mockImplementation((toolName) =>
        toolName === 'write_file'
          ? { ...originalContract, effectKind: 'artifact.delete' }
          : originalGetter(toolName),
      );

    try {
      const drifted = (await buildCodeOwnedToolContractIdentity('write_file'))!;
      expect(drifted.effectContractDigest).not.toBe(baseline.effectContractDigest);
      expect(drifted.schemaDigest).toBe(baseline.schemaDigest);
      expect(drifted.executionPolicyDigest).toBe(baseline.executionPolicyDigest);
    } finally {
      getter.mockRestore();
    }
  });

  it('detects validly-shaped receipt and contract tampering', async () => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: 'tc-v2-integrity',
      toolName: 'write_file',
      argumentsText: '{"content":"done","path":"report.md"}',
      resultText: JSON.stringify({
        status: 'written',
        path: 'report.md',
        sha256: 'a'.repeat(64),
      }),
      transportState: 'returned',
      recordedAt: 100,
    });

    await expect(verifyToolEffectReceiptIntegrity(receipt)).resolves.toBe(true);
    await expect(
      verifyToolEffectReceiptIntegrity({
        ...receipt,
        contractIdentity: {
          ...receipt.contractIdentity,
          schemaDigest: `sha256:${'f'.repeat(64)}`,
        },
      }),
    ).resolves.toBe(false);
    await expect(
      verifyToolEffectReceiptIntegrity({
        ...receipt,
        resultDigest: `sha256:${'e'.repeat(64)}`,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyToolEffectReceiptIntegrity({
        ...receipt,
        recordedAt: receipt.recordedAt + 1,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyToolEffectReceiptIntegrity({
        ...receipt,
        executionRunId: 'execution-run-tampered',
      }),
    ).resolves.toBe(false);
    await expect(
      verifyToolEffectReceiptIntegrity({
        ...receipt,
        dispatchRunId: 'effect-run-tampered',
      }),
    ).resolves.toBe(false);
  });

  it.each([
    ['MCP', 'mcp__calendar__create_event', MCP_EVIDENCE, 'mcp', 'calendar'],
    ['skill', 'skill__acme__deploy', SKILL_EVIDENCE, 'skill', 'acme'],
  ] as const)(
    'seals the exact %s declaration and captured execution generation',
    async (_label, toolName, evidence, source, namespace) => {
      const identity = await buildRuntimeExternalToolContractIdentity(toolName, evidence);

      expect(identity).toEqual({
        kind: 'runtime_external',
        version: 1,
        toolName,
        source,
        namespace,
        declarationDigest: expect.stringMatching(SHA256_PATTERN),
        executionBindingDigest: expect.stringMatching(SHA256_PATTERN),
      });
      expect(Object.isFrozen(identity)).toBe(true);
      expect(identity?.kind).not.toBe('code_owned');
    },
  );

  it('changes declaration and execution-binding digests independently', async () => {
    const baseline = (await buildRuntimeExternalToolContractIdentity(
      MCP_EVIDENCE.declaration.name,
      MCP_EVIDENCE,
    ))!;
    const declarationDrift = (await buildRuntimeExternalToolContractIdentity(
      MCP_EVIDENCE.declaration.name,
      {
        ...MCP_EVIDENCE,
        declaration: {
          ...MCP_EVIDENCE.declaration,
          description: '[Calendar] Create a calendar event',
        },
      },
    ))!;
    const bindingDrift = (await buildRuntimeExternalToolContractIdentity(
      MCP_EVIDENCE.declaration.name,
      {
        ...MCP_EVIDENCE,
        provenance: { ...MCP_EVIDENCE.provenance, connectionGeneration: 8 },
      },
    ))!;
    const processDrift = (await buildRuntimeExternalToolContractIdentity(
      MCP_EVIDENCE.declaration.name,
      {
        ...MCP_EVIDENCE,
        provenance: { ...MCP_EVIDENCE.provenance, runtimeProcessEpoch: 'process-epoch-b' },
      },
    ))!;

    expect(declarationDrift.declarationDigest).not.toBe(baseline.declarationDigest);
    expect(declarationDrift.executionBindingDigest).toBe(baseline.executionBindingDigest);
    expect(bindingDrift.declarationDigest).toBe(baseline.declarationDigest);
    expect(bindingDrift.executionBindingDigest).not.toBe(baseline.executionBindingDigest);
    expect(processDrift.declarationDigest).toBe(baseline.declarationDigest);
    expect(processDrift.executionBindingDigest).not.toBe(baseline.executionBindingDigest);
  });

  it('seals multiline declaration documentation without relaxing provenance identities', async () => {
    const evidence: RuntimeExternalToolEvidence = {
      ...MCP_EVIDENCE,
      declaration: {
        ...MCP_EVIDENCE.declaration,
        description: '[Calendar]\nCreate an event after checking:\n\t- title\n\t- start time',
      },
    };

    await expect(
      buildRuntimeExternalToolContractIdentity(evidence.declaration.name, evidence),
    ).resolves.toEqual(expect.objectContaining({ kind: 'runtime_external' }));
    await expect(
      buildRuntimeExternalToolContractIdentity(evidence.declaration.name, {
        ...evidence,
        provenance: { ...evidence.provenance, namespace: 'calendar\nspoofed' },
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps provider-asserted dynamic success conservative and seals all receipt evidence', async () => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: 'tc-external',
      toolName: MCP_EVIDENCE.declaration.name,
      argumentsText: '{"title":"Private"}',
      resultText: JSON.stringify({
        status: 'completed',
        effectKind: 'calendar.create',
        effectState: 'applied',
        verificationState: 'verified',
        eventId: 'external-event',
      }),
      transportState: 'returned',
      runtimeExternalEvidence: MCP_EVIDENCE,
      recordedAt: 123,
    });

    expect(receipt).toMatchObject({
      effectKind: 'unknown',
      executionState: 'completed',
      effectState: 'unknown',
      verificationState: 'unverified',
      contractIdentity: { kind: 'runtime_external' },
    });
    expect(receipt).not.toHaveProperty('resource');
    expect(receipt).not.toHaveProperty('operationHandle');
    await expect(verifyToolEffectReceiptIntegrity(receipt)).resolves.toBe(true);
    await expect(
      verifyToolEffectReceiptIntegrity({
        ...receipt,
        contractIdentity: {
          ...receipt.contractIdentity,
          declarationDigest: `sha256:${'d'.repeat(64)}`,
        },
      }),
    ).resolves.toBe(false);
    await expect(
      verifyToolEffectReceiptIntegrity({
        ...receipt,
        contractIdentity: {
          ...receipt.contractIdentity,
          executionBindingDigest: `sha256:${'e'.repeat(64)}`,
        },
      }),
    ).resolves.toBe(false);
    await expect(
      verifyToolEffectReceiptIntegrity({ ...receipt, recordedAt: receipt.recordedAt + 1 }),
    ).resolves.toBe(false);
  });

  it('rejects namespace spoofing and malformed execution generations', async () => {
    await expect(
      buildRuntimeExternalToolContractIdentity('mcp__github__create_issue', {
        ...MCP_EVIDENCE,
        declaration: {
          ...MCP_EVIDENCE.declaration,
          name: 'mcp__github__create_issue',
        },
      }),
    ).resolves.toBeUndefined();
    await expect(
      buildRuntimeExternalToolContractIdentity(MCP_EVIDENCE.declaration.name, {
        ...MCP_EVIDENCE,
        provenance: { ...MCP_EVIDENCE.provenance, connectionGeneration: 0 },
      }),
    ).resolves.toBeUndefined();
  });

  it('denies dynamic and unregistered tools while recognizing code-owned service tools', async () => {
    await expect(buildCodeOwnedToolContractIdentity('mcp__calendar__create_event')).resolves.toBe(
      undefined,
    );
    await expect(
      buildCodeOwnedToolContractIdentity('skill__github__commit_files'),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'code_owned',
        toolName: 'skill__github__commit_files',
        version: 1,
      }),
    );
    await expect(buildCodeOwnedToolContractIdentity('shell')).resolves.toBeUndefined();
    await expect(
      buildToolEffectReceipt({
        toolCallId: 'tc-dynamic',
        toolName: 'mcp__calendar__create_event',
        argumentsText: '{}',
        resultText: JSON.stringify({
          status: 'completed',
          effectKind: 'communication.send',
          effectState: 'applied',
          verificationState: 'verified',
        }),
        transportState: 'returned',
        recordedAt: 1,
      }),
    ).rejects.toThrow(/code-owned identity or live runtime-external evidence/u);
  });
});
