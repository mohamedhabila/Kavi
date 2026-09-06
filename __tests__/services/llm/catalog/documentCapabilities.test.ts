// ---------------------------------------------------------------------------
// Tests — PDF document-input capability gating and size-limit decisions
// ---------------------------------------------------------------------------

import {
  ANTHROPIC_DOCUMENT_MAX_BYTES,
  GEMINI_DOCUMENT_MAX_BYTES,
  OPENAI_RESPONSES_DOCUMENT_MAX_BYTES,
  formatDocumentSizeLimitMB,
  resolveDocumentInputDecision,
} from '../../../../src/services/llm/catalog/documentCapabilities';
import { supportsDocumentInput } from '../../../../src/services/llm/catalog/providerCapabilities';
import type { LlmProviderConfig } from '../../../../src/types/provider';

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'test',
    name: 'Test Provider',
    baseUrl: 'https://api.test.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    enabled: true,
    ...overrides,
  };
}

describe('supportsDocumentInput', () => {
  it('is false when the model has no fileInput capability', () => {
    const provider = makeProvider({
      protocol: 'anthropic-messages',
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: false } },
    });
    expect(supportsDocumentInput(provider, 'test-model')) .toBe(false);
  });

  it('is false when the model has no capability entry at all', () => {
    const provider = makeProvider({ protocol: 'anthropic-messages' });
    expect(supportsDocumentInput(provider, 'test-model')).toBe(false);
  });

  it.each([
    ['anthropic-messages' as const],
    ['gemini-native' as const],
    ['openai-responses' as const],
  ])('is true for %s transports when fileInput is true', (protocol) => {
    const provider = makeProvider({
      protocol,
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });
    expect(supportsDocumentInput(provider, 'test-model')).toBe(true);
  });

  it('is false for OpenAI Chat Completions even when fileInput is true', () => {
    const provider = makeProvider({
      protocol: 'openai-chat',
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });
    expect(supportsDocumentInput(provider, 'test-model')).toBe(false);
  });

  it('is false for an on-device (local) model even when fileInput is true', () => {
    const provider = makeProvider({
      kind: 'on-device',
      local: { runtime: 'litert-lm' },
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });
    expect(supportsDocumentInput(provider, 'test-model')).toBe(false);
  });
});

describe('resolveDocumentInputDecision', () => {
  it('refuses with unsupported_provider when the transport has no document block', () => {
    const provider = makeProvider({
      protocol: 'openai-chat',
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });

    const decision = resolveDocumentInputDecision({
      provider,
      model: 'test-model',
      sizeBytes: 1024,
    });

    expect(decision).toEqual({ supported: false, refusalReason: 'unsupported_provider' });
  });

  it('refuses with unsupported_provider when fileInput is not declared', () => {
    const provider = makeProvider({ protocol: 'anthropic-messages' });

    const decision = resolveDocumentInputDecision({
      provider,
      model: 'test-model',
      sizeBytes: 1024,
    });

    expect(decision).toEqual({ supported: false, refusalReason: 'unsupported_provider' });
  });

  it.each([
    ['anthropic-messages' as const, ANTHROPIC_DOCUMENT_MAX_BYTES],
    ['gemini-native' as const, GEMINI_DOCUMENT_MAX_BYTES],
    ['openai-responses' as const, OPENAI_RESPONSES_DOCUMENT_MAX_BYTES],
  ])('supports a small document on %s, echoing that provider limit', (protocol, maxBytes) => {
    const provider = makeProvider({
      protocol,
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });

    const decision = resolveDocumentInputDecision({
      provider,
      model: 'test-model',
      sizeBytes: 1024,
    });

    expect(decision).toEqual({ supported: true, maxBytes });
  });

  it('refuses a document over the provider size limit with the max bytes attached', () => {
    const provider = makeProvider({
      protocol: 'anthropic-messages',
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });
    // Raw size that would base64-encode to more than the 32 MB Anthropic ceiling.
    const oversizedRawBytes = Math.ceil((ANTHROPIC_DOCUMENT_MAX_BYTES / (4 / 3)) + 1);

    const decision = resolveDocumentInputDecision({
      provider,
      model: 'test-model',
      sizeBytes: oversizedRawBytes,
    });

    expect(decision).toEqual({
      supported: false,
      refusalReason: 'exceeds_size_limit',
      maxBytes: ANTHROPIC_DOCUMENT_MAX_BYTES,
    });
  });

  it('accepts a document exactly at the raw-size ceiling', () => {
    const provider = makeProvider({
      protocol: 'anthropic-messages',
      modelCapabilities: { 'test-model': { vision: true, tools: true, fileInput: true } },
    });
    const maxRawBytes = Math.floor(ANTHROPIC_DOCUMENT_MAX_BYTES / (4 / 3));

    const decision = resolveDocumentInputDecision({
      provider,
      model: 'test-model',
      sizeBytes: maxRawBytes,
    });

    expect(decision.supported).toBe(true);
  });
});

describe('formatDocumentSizeLimitMB', () => {
  it('formats whole megabyte values without decimals', () => {
    expect(formatDocumentSizeLimitMB(32 * 1024 * 1024)).toBe('32 MB');
    expect(formatDocumentSizeLimitMB(50 * 1024 * 1024)).toBe('50 MB');
  });

  it('formats fractional megabyte values to one decimal place', () => {
    expect(formatDocumentSizeLimitMB(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});
