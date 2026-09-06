// ---------------------------------------------------------------------------
// Tests — PDF document content part conversion: Gemini & OpenAI Responses
// ---------------------------------------------------------------------------
// `orchestratorMessageFormatting.ts` builds a generic
// `{ type: 'file', file_data: <data URI>, filename }` content part for a PDF
// attachment (mirroring the `image_url` part already used for images). The
// Gemini and OpenAI Responses adapters already understood this generic shape
// before this change — these are regression tests pinning that behavior, so a
// future refactor of either adapter can't silently drop document support.

import { normalizeGeminiContentParts } from '../../../../src/services/llm/providers/gemini/contentParts';
import { toOpenAIResponsesMessageContent } from '../../../../src/services/llm/providers/openaiResponses/content';

const PDF_DATA_URI = 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsO8';

describe('normalizeGeminiContentParts — PDF documents', () => {
  it('converts a generic file block into Gemini inlineData', () => {
    const parts = normalizeGeminiContentParts([
      { type: 'text', text: 'Please review this file.' },
      { type: 'file', file_data: PDF_DATA_URI, filename: 'contract.pdf' },
    ]);

    expect(parts).toEqual([
      { text: 'Please review this file.' },
      { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjQKJcOkw7zDtsO8' } },
    ]);
  });

  it('accepts the input_file block type', () => {
    const parts = normalizeGeminiContentParts([{ type: 'input_file', file_data: PDF_DATA_URI }]);

    expect(parts).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'JVBERi0xLjQKJcOkw7zDtsO8' } },
    ]);
  });

  it('drops a file block with no data URI rather than emitting a malformed part', () => {
    const parts = normalizeGeminiContentParts([
      { type: 'text', text: 'Reference only.' },
      { type: 'file', file_id: 'file_abc123' },
    ]);

    expect(parts).toEqual([{ text: 'Reference only.' }]);
  });
});

describe('toOpenAIResponsesMessageContent — PDF documents', () => {
  it('converts a generic file block into an OpenAI Responses input_file part', () => {
    const content = toOpenAIResponsesMessageContent([
      { type: 'text', text: 'Please review this file.' },
      { type: 'file', file_data: PDF_DATA_URI, filename: 'contract.pdf' },
    ]);

    expect(content).toEqual([
      { type: 'input_text', text: 'Please review this file.' },
      { type: 'input_file', file_data: PDF_DATA_URI, filename: 'contract.pdf' },
    ]);
  });

  it('accepts the input_file block type directly', () => {
    const content = toOpenAIResponsesMessageContent([
      { type: 'input_file', file_data: PDF_DATA_URI, filename: 'contract.pdf' },
    ]);

    expect(content).toEqual([
      { type: 'input_file', file_data: PDF_DATA_URI, filename: 'contract.pdf' },
    ]);
  });

  it('drops a file block with neither file_id nor file_data', () => {
    const content = toOpenAIResponsesMessageContent([
      { type: 'text', text: 'Reference only.' },
      { type: 'file', filename: 'contract.pdf' },
    ]);

    expect(content).toBe('Reference only.');
  });
});
