const ON_DEVICE_SCENARIOS = [
  {
    id: 'local-model-availability',
    label: 'Model availability',
    description: 'Confirm the selected local model is visible to the app before inference starts.',
    required: true,
  },
  {
    id: 'local-model-warmup',
    label: 'Model load and warmup',
    description: 'Load the model and capture warmup latency and memory telemetry.',
    required: true,
  },
  {
    id: 'single-turn-streaming',
    label: 'Single-turn streaming response',
    description: 'Send one normal chat turn and capture TTFT, decode rate, tokens, and backend.',
    required: true,
  },
  {
    id: 'cancel-mid-stream',
    label: 'Cancellation mid-stream',
    description:
      'Start streaming, cancel mid-response, and verify native processing stops cleanly.',
    required: true,
  },
  {
    id: 'twenty-turn-conversation',
    label: '20-turn same-conversation run',
    description: 'Run a same-conversation sequence to baseline crash-free long-run behavior.',
    required: true,
  },
  {
    id: 'fifty-turn-conversation',
    label: '50-turn same-conversation run',
    description: 'Run a longer same-conversation sequence to measure sustained local stability.',
    required: true,
  },
  {
    id: 'multi-turn-memory-recall',
    label: 'Multi-turn memory recall',
    description: 'Store and recall a conversation nonce after intervening turns.',
    required: true,
  },
  {
    id: 'context-pressure-conversation',
    label: 'Context pressure conversation',
    description: 'Run a long same-conversation sequence with progressively larger inputs.',
    required: true,
  },
  {
    id: 'error-recovery-after-cancel',
    label: 'Recovery after cancellation',
    description: 'Cancel a live generation and verify a fresh local turn succeeds afterward.',
    required: true,
  },
  {
    id: 'background-foreground-interruption',
    label: 'Background/foreground interruption',
    description: 'Move through a mobile lifecycle interruption and verify local inference resumes.',
    required: true,
  },
  {
    id: 'backend-fallback',
    label: 'Backend fallback',
    description: 'Exercise backend fallback when the configured device/backend can trigger it.',
    required: false,
  },
  {
    id: 'native-tool-call',
    label: 'Native structured tool call',
    description: 'Run a model-supported native tool-call round trip without tool preselection.',
    required: false,
  },
];

function parseScenarioSelection(rawValue) {
  if (!rawValue?.trim()) {
    return ON_DEVICE_SCENARIOS;
  }

  const requestedIds = Array.from(
    new Set(
      rawValue
        .split(/[,\s]+/u)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  if (requestedIds.some((id) => id.toLowerCase() === 'all')) {
    return ON_DEVICE_SCENARIOS;
  }

  return requestedIds.map((id) => {
    const scenario = ON_DEVICE_SCENARIOS.find((candidate) => candidate.id === id);
    if (!scenario) {
      throw new Error(`Unknown on-device benchmark scenario: ${id}`);
    }
    return scenario;
  });
}

function buildScenarioPlan(config) {
  return {
    version: config.version,
    generatedAt: config.generatedAt,
    platform: config.platform,
    device: config.device,
    app: {
      appId: config.appId,
    },
    model: {
      modelId: config.modelId,
      modelPath: config.modelPath,
      runtime: config.runtime,
      backend: config.backend,
      capabilities: {
        tools: config.modelCapabilities?.tools === true,
      },
    },
    defaults: {
      conversationTurns: config.conversationTurns,
    },
    scenarios: config.scenarios.map((scenario) => ({ ...scenario })),
  };
}

module.exports = {
  ON_DEVICE_SCENARIOS,
  buildScenarioPlan,
  parseScenarioSelection,
};
