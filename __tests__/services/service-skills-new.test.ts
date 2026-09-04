// ---------------------------------------------------------------------------
// Tests for new built-in service skills:
// Productivity, Communication, Media, Knowledge
// ---------------------------------------------------------------------------

import { createCommunicationSkill } from '../../src/services/integrations/communication/skill';
import { createKnowledgeSkill } from '../../src/services/integrations/knowledge/skill';
import { createMediaSkill } from '../../src/services/integrations/media/skill';
import { createProductivitySkill } from '../../src/services/integrations/productivity/skill';
import { failedToolContent, parseCompletedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('Productivity Skill', () => {
  const skill = createProductivitySkill();

  it('has correct id and name', () => {
    expect(skill.id).toBe('productivity');
    expect(skill.name).toBe('Productivity');
  });

  it('has timer, unit_convert, and calculate tools', () => {
    const toolNames = skill.tools.map((t) => t.name);
    expect(toolNames).toContain('timer');
    expect(toolNames).toContain('unit_convert');
    expect(toolNames).toContain('calculate');
  });

  describe('timer tool', () => {
    it('sets a timer with valid seconds', async () => {
      const timer = skill.tools.find((t) => t.name === 'timer')!;
      const result = await timer.handler!({ seconds: 60, label: 'Focus' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('timer_set');
      expect(parsed.seconds).toBe(60);
      expect(parsed.label).toBe('Focus');
      expect(parsed.expiresAt).toBeDefined();
    });

    it('caps timer at 3600 seconds', async () => {
      const timer = skill.tools.find((t) => t.name === 'timer')!;
      const result = await timer.handler!({ seconds: 99999 });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.seconds).toBe(3600);
    });
  });

  describe('unit_convert tool', () => {
    it('converts km to miles', async () => {
      const convert = skill.tools.find((t) => t.name === 'unit_convert')!;
      const result = await convert.handler!({ value: 10, from: 'km', to: 'mi' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.result).toBeCloseTo(6.21371, 2);
    });

    it('converts Celsius to Fahrenheit', async () => {
      const convert = skill.tools.find((t) => t.name === 'unit_convert')!;
      const result = await convert.handler!({ value: 100, from: '°C', to: '°F' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.result).toBe(212);
    });

    it('returns error for unsupported conversion', async () => {
      const convert = skill.tools.find((t) => t.name === 'unit_convert')!;
      const result = await convert.handler!({ value: 1, from: 'parsec', to: 'lightyear' });
      expect(failedToolContent(result)).toContain('Unsupported');
    });
  });

  describe('calculate tool', () => {
    it('evaluates simple expression', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: '2 + 3 * 4' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.result).toBe(14);
    });

    it('evaluates expression with sqrt', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: 'sqrt(144)' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.result).toBe(12);
    });

    it('handles invalid expression', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: 'invalid()()' });
      expect(failedToolContent(result)).toContain('Invalid expression');
    });

    it('rejects unsupported characters before expression evaluation', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: '<script>alert(1)</script>' });
      expect(failedToolContent(result)).toContain('Expression contains unsupported characters');
    });

    it('rejects non-finite calculation results', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: '1 / 0' });
      expect(failedToolContent(result)).toContain('Expression did not produce a finite number');
    });
  });
});

describe('Communication Skill', () => {
  const skill = createCommunicationSkill();

  it('has correct id and no legacy stub tools', () => {
    expect(skill.id).toBe('communication');
    expect(skill.tools).toHaveLength(0);
  });
});

describe('Media Skill', () => {
  const skill = createMediaSkill();

  it('has correct id and tools', () => {
    expect(skill.id).toBe('media');
    const toolNames = skill.tools.map((t) => t.name);
    expect(toolNames).toContain('generate_qr');
    expect(toolNames).toHaveLength(1);
  });

  describe('generate_qr tool', () => {
    it('generates QR code URL', async () => {
      const qr = skill.tools.find((t) => t.name === 'generate_qr')!;
      const result = await qr.handler!({ data: 'https://example.com', size: 512 });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.status).toBe('generated');
      expect(parsed.url).toContain('qrserver.com');
      expect(parsed.url).toContain('512x512');
      expect(parsed.data).toBe('https://example.com');
    });
  });
});

describe('Knowledge Skill', () => {
  const skill = createKnowledgeSkill();

  it('has correct id and tools', () => {
    expect(skill.id).toBe('knowledge');
    const toolNames = skill.tools.map((t) => t.name);
    expect(toolNames).toContain('wikipedia_summary');
    expect(toolNames).toContain('define_word');
  });

  describe('wikipedia_summary tool', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns Wikipedia summary on success', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            title: 'JavaScript',
            extract: 'JavaScript is a programming language.',
            thumbnail: { source: 'https://img.example.com/js.png' },
            content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/JavaScript' } },
          }),
      });

      const wiki = skill.tools.find((t) => t.name === 'wikipedia_summary')!;
      const result = await wiki.handler!({ topic: 'JavaScript' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.title).toBe('JavaScript');
      expect(parsed.extract).toContain('programming language');
    });

    it('handles API error', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 });

      const wiki = skill.tools.find((t) => t.name === 'wikipedia_summary')!;
      const result = await wiki.handler!({ topic: 'nonexistent_topic_xyzzy' });
      expect(failedToolContent(result)).toContain('404');
    });

    it('handles fetch failure', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

      const wiki = skill.tools.find((t) => t.name === 'wikipedia_summary')!;
      const result = await wiki.handler!({ topic: 'test' });
      expect(failedToolContent(result)).toContain('Network error');
    });
  });

  describe('define_word tool', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns word definition on success', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              word: 'example',
              phonetic: '/ɪɡˈzæm.pəl/',
              meanings: [
                {
                  partOfSpeech: 'noun',
                  definitions: [{ definition: 'A representative form or pattern.' }],
                },
              ],
            },
          ]),
      });

      const define = skill.tools.find((t) => t.name === 'define_word')!;
      const result = await define.handler!({ word: 'example' });
      const parsed = parseCompletedToolOutcome(result);
      expect(parsed.word).toBe('example');
      expect(parsed.meanings[0].partOfSpeech).toBe('noun');
    });

    it('handles word not found', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const define = skill.tools.find((t) => t.name === 'define_word')!;
      const result = await define.handler!({ word: 'xyzzy' });
      expect(failedToolContent(result)).toContain('not found');
    });

    it('handles API error', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 });

      const define = skill.tools.find((t) => t.name === 'define_word')!;
      const result = await define.handler!({ word: 'xyzzy' });
      expect(failedToolContent(result)).toContain('404');
    });

    it('handles fetch failure', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network failed'));

      const define = skill.tools.find((t) => t.name === 'define_word')!;
      const result = await define.handler!({ word: 'test' });
      expect(failedToolContent(result)).toContain('Network failed');
    });
  });
});
