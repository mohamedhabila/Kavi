// ---------------------------------------------------------------------------
// Tests — Media Understanding: Formatting
// ---------------------------------------------------------------------------

import { formatMediaUnderstandingBody, stripMediaContext } from '../../src/services/media/format';
import type { MediaUnderstandingOutput } from '../../src/services/media/types';

describe('formatMediaUnderstandingBody', () => {
  const originalBody = 'Describe the attached files.';

  it('returns original body when outputs array is empty', () => {
    const result = formatMediaUnderstandingBody(originalBody, []);
    expect(result).toBe(originalBody);
  });

  it('returns original body when all outputs have errors', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'image.description', attachmentIndex: 0, text: '', error: 'Failed' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result).toBe(originalBody);
  });

  it('wraps image description in media_context tags', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'image.description', attachmentIndex: 0, text: 'A cat sitting on a desk.' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result).toContain('<media_context>');
    expect(result).toContain('</media_context>');
    expect(result).toContain('[Image Attachment #1]');
    expect(result).toContain('Description:');
    expect(result).toContain('A cat sitting on a desk.');
  });

  it('wraps audio transcription in media_context tags', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'audio.transcription', attachmentIndex: 0, text: 'Hello world.' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result).toContain('[Audio Attachment #1]');
    expect(result).toContain('Transcript:');
    expect(result).toContain('Hello world.');
  });

  it('wraps document extraction in media_context tags', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'document.extraction', attachmentIndex: 0, text: 'Document text content.' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result).toContain('[Document Attachment #1]');
    expect(result).toContain('Content:');
    expect(result).toContain('Document text content.');
  });

  it('uses 1-based attachment numbering', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'image.description', attachmentIndex: 2, text: 'Third attachment.' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result).toContain('[Image Attachment #3]');
  });

  it('separates multiple outputs with dividers', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'image.description', attachmentIndex: 0, text: 'Image desc.' },
      { kind: 'audio.transcription', attachmentIndex: 1, text: 'Audio text.' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result).toContain('---');
    expect(result).toContain('Image desc.');
    expect(result).toContain('Audio text.');
  });

  it('only includes successful outputs', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'image.description', attachmentIndex: 0, text: '', error: 'No vision model' },
      { kind: 'audio.transcription', attachmentIndex: 1, text: 'Good transcript.' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result).not.toContain('No vision model');
    expect(result).toContain('Good transcript.');
  });

  it('preserves original body as prefix', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'image.description', attachmentIndex: 0, text: 'Desc.' },
    ];
    const result = formatMediaUnderstandingBody(originalBody, outputs);
    expect(result.startsWith(originalBody)).toBe(true);
  });

  it('replaces an existing media_context block instead of appending another one', () => {
    const outputs: MediaUnderstandingOutput[] = [
      { kind: 'image.description', attachmentIndex: 0, text: 'Fresh description.' },
    ];
    const result = formatMediaUnderstandingBody(
      'Describe the attached files.\n\n<media_context>\nOld description\n</media_context>',
      outputs,
    );

    expect(result.match(/<media_context>/g)).toHaveLength(1);
    expect(result).toContain('Fresh description.');
    expect(result).not.toContain('Old description');
  });
});

describe('stripMediaContext', () => {
  it('removes media_context tags from body', () => {
    const body =
      'Hello\n\n<media_context>\n[Image Attachment #1]\nDescription:\nA cat.\n</media_context>';
    const result = stripMediaContext(body);
    expect(result).toBe('Hello');
  });

  it('returns unchanged body when no tags present', () => {
    const body = 'No media context here';
    const result = stripMediaContext(body);
    expect(result).toBe('No media context here');
  });

  it('handles multiple media_context blocks', () => {
    const body =
      'Start\n\n<media_context>\nA\n</media_context>\n\nMiddle\n\n<media_context>\nB\n</media_context>';
    const result = stripMediaContext(body);
    expect(result).not.toContain('<media_context>');
    expect(result).toContain('Middle');
  });
});
