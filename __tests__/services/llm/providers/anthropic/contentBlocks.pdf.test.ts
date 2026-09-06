// ---------------------------------------------------------------------------
// Tests — Anthropic content blocks: PDF document conversion
// ---------------------------------------------------------------------------

import { normalizeAnthropicUserContent } from '../../../../../src/services/llm/providers/anthropic/contentBlocks';

const PDF_BASE64 = 'JVBERi0xLjQKJcOkw7zDtsO8';

describe('normalizeAnthropicUserContent — PDF documents', () => {
  it('converts a generic file block with a PDF data URI into an Anthropic document block', () => {
    const result = normalizeAnthropicUserContent([
      { type: 'text', text: 'Please review this file.' },
      {
        type: 'file',
        file_data: `data:application/pdf;base64,${PDF_BASE64}`,
        filename: 'contract.pdf',
      },
    ]);

    expect(result).toEqual([
      { type: 'text', text: 'Please review this file.' },
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: PDF_BASE64 },
      },
    ]);
  });

  it('accepts the input_file block type and camelCase fileData', () => {
    const result = normalizeAnthropicUserContent([
      {
        type: 'input_file',
        fileData: `data:application/pdf;base64,${PDF_BASE64}`,
      },
    ]);

    expect(result).toEqual([
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: PDF_BASE64 },
      },
    ]);
  });

  it('drops a non-PDF file block rather than sending an unsupported media type', () => {
    const result = normalizeAnthropicUserContent([
      { type: 'text', text: 'See attached.' },
      {
        type: 'file',
        file_data: 'data:text/plain;base64,aGVsbG8=',
        filename: 'notes.txt',
      },
    ]);

    expect(result).toBe('See attached.');
  });

  it('drops a file block with no data URI (e.g. a bare file_id reference)', () => {
    const result = normalizeAnthropicUserContent([
      { type: 'text', text: 'Reference only.' },
      { type: 'file', file_id: 'file_abc123' },
    ]);

    expect(result).toBe('Reference only.');
  });

  it('strips whitespace from the base64 payload', () => {
    const wrapped = PDF_BASE64.match(/.{1,8}/g)!.join('\n');
    const result = normalizeAnthropicUserContent([
      { type: 'file', file_data: `data:application/pdf;base64,${wrapped}` },
    ]);

    expect(result).toEqual([
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: PDF_BASE64 },
      },
    ]);
  });
});
