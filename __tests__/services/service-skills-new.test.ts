// ---------------------------------------------------------------------------
// Tests for new built-in service skills:
// Productivity, Communication, Media, Knowledge
// ---------------------------------------------------------------------------

import { createCommunicationSkill } from '../../src/services/integrations/communication/skill';
import { createKnowledgeSkill } from '../../src/services/integrations/knowledge/skill';
import { createMediaSkill } from '../../src/services/integrations/media/skill';
import { createProductivitySkill } from '../../src/services/integrations/productivity/skill';

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
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('timer_set');
      expect(parsed.seconds).toBe(60);
      expect(parsed.label).toBe('Focus');
      expect(parsed.expiresAt).toBeDefined();
    });

    it('caps timer at 3600 seconds', async () => {
      const timer = skill.tools.find((t) => t.name === 'timer')!;
      const result = await timer.handler!({ seconds: 99999 });
      const parsed = JSON.parse(result);
      expect(parsed.seconds).toBe(3600);
    });
  });

  describe('unit_convert tool', () => {
    it('converts km to miles', async () => {
      const convert = skill.tools.find((t) => t.name === 'unit_convert')!;
      const result = await convert.handler!({ value: 10, from: 'km', to: 'mi' });
      const parsed = JSON.parse(result);
      expect(parsed.result).toBeCloseTo(6.21371, 2);
    });

    it('converts Celsius to Fahrenheit', async () => {
      const convert = skill.tools.find((t) => t.name === 'unit_convert')!;
      const result = await convert.handler!({ value: 100, from: '°C', to: '°F' });
      const parsed = JSON.parse(result);
      expect(parsed.result).toBe(212);
    });

    it('returns error for unsupported conversion', async () => {
      const convert = skill.tools.find((t) => t.name === 'unit_convert')!;
      const result = await convert.handler!({ value: 1, from: 'parsec', to: 'lightyear' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Unsupported');
    });
  });

  describe('calculate tool', () => {
    it('evaluates simple expression', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: '2 + 3 * 4' });
      const parsed = JSON.parse(result);
      expect(parsed.result).toBe(14);
    });

    it('evaluates expression with sqrt', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: 'sqrt(144)' });
      const parsed = JSON.parse(result);
      expect(parsed.result).toBe(12);
    });

    it('handles invalid expression', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: 'invalid()()' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });

    it('rejects unsupported characters before expression evaluation', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: '<script>alert(1)</script>' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('Expression contains unsupported characters');
    });

    it('rejects non-finite calculation results', async () => {
      const calc = skill.tools.find((t) => t.name === 'calculate')!;
      const result = await calc.handler!({ expression: '1 / 0' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBe('Expression did not produce a finite number');
    });
  });
});

describe('Communication Skill', () => {
  const skill = createCommunicationSkill();

  it('has correct id and tools', () => {
    expect(skill.id).toBe('communication');
    const toolNames = skill.tools.map((t) => t.name);
    expect(toolNames).toContain('draft_email');
    expect(toolNames).toContain('translate');
  });

  it('has a system prompt', () => {
    expect(skill.systemPrompt).toBeDefined();
    expect(skill.systemPrompt!.length).toBeGreaterThan(0);
  });

  describe('draft_email tool', () => {
    it('returns draft context', async () => {
      const draft = skill.tools.find((t) => t.name === 'draft_email')!;
      const result = await draft.handler!({
        to: 'John',
        subject: 'Meeting',
        context: 'Reschedule to Friday',
        tone: 'casual',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('draft_generated');
      expect(parsed.subject).toBe('Meeting');
      expect(parsed.tone).toBe('casual');
    });
  });

  describe('translate tool', () => {
    it('returns translation request', async () => {
      const translate = skill.tools.find((t) => t.name === 'translate')!;
      const result = await translate.handler!({ text: 'Hello', to: 'Spanish' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('translate_request');
      expect(parsed.to).toBe('Spanish');
    });
  });
});

describe('Media Skill', () => {
  const skill = createMediaSkill();

  it('has correct id and tools', () => {
    expect(skill.id).toBe('media');
    const toolNames = skill.tools.map((t) => t.name);
    expect(toolNames).toContain('describe_image');
    expect(toolNames).toContain('generate_qr');
    expect(toolNames).toContain('color_palette');
  });

  describe('generate_qr tool', () => {
    it('generates QR code URL', async () => {
      const qr = skill.tools.find((t) => t.name === 'generate_qr')!;
      const result = await qr.handler!({ data: 'https://example.com', size: 512 });
      const parsed = JSON.parse(result);
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
      const parsed = JSON.parse(result);
      expect(parsed.title).toBe('JavaScript');
      expect(parsed.extract).toContain('programming language');
    });

    it('handles API error', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 });

      const wiki = skill.tools.find((t) => t.name === 'wikipedia_summary')!;
      const result = await wiki.handler!({ topic: 'nonexistent_topic_xyzzy' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('404');
    });

    it('handles fetch failure', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));

      const wiki = skill.tools.find((t) => t.name === 'wikipedia_summary')!;
      const result = await wiki.handler!({ topic: 'test' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Network error');
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
      const parsed = JSON.parse(result);
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
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('not found');
    });

    it('handles API error', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 404 });

      const define = skill.tools.find((t) => t.name === 'define_word')!;
      const result = await define.handler!({ word: 'xyzzy' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('404');
    });

    it('handles fetch failure', async () => {
      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network failed'));

      const define = skill.tools.find((t) => t.name === 'define_word')!;
      const result = await define.handler!({ word: 'test' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Network failed');
    });
  });
});

describe('Media Skill — additional tests', () => {
  const skill = createMediaSkill();

  describe('describe_image tool', () => {
    it('returns describe request with default detail', async () => {
      const describe = skill.tools.find((t) => t.name === 'describe_image')!;
      const result = await describe.handler!({ url: 'https://example.com/img.png' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('describe_request');
      expect(parsed.detail).toBe('brief');
    });
  });

  describe('color_palette tool', () => {
    it('returns palette request with defaults', async () => {
      const palette = skill.tools.find((t) => t.name === 'color_palette')!;
      const result = await palette.handler!({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('palette_request');
      expect(parsed.count).toBe(5);
      expect(parsed.theme).toBe('harmonious');
    });

    it('accepts custom count and theme', async () => {
      const palette = skill.tools.find((t) => t.name === 'color_palette')!;
      const result = await palette.handler!({ count: 8, theme: 'ocean' });
      const parsed = JSON.parse(result);
      expect(parsed.count).toBe(8);
      expect(parsed.theme).toBe('ocean');
    });
  });
});

describe('Communication Skill — additional tests', () => {
  const skill = createCommunicationSkill();

  describe('draft_email tool', () => {
    it('uses default tone when not specified', async () => {
      const draft = skill.tools.find((t) => t.name === 'draft_email')!;
      const result = await draft.handler!({ subject: 'Hi', context: 'Greetings' });
      const parsed = JSON.parse(result);
      expect(parsed.tone).toBe('formal');
      expect(parsed.to).toBe('(recipient)');
    });
  });

  describe('translate tool', () => {
    it('auto-detects source language by default', async () => {
      const translate = skill.tools.find((t) => t.name === 'translate')!;
      const result = await translate.handler!({ text: 'Bonjour', to: 'English' });
      const parsed = JSON.parse(result);
      expect(parsed.from).toBe('auto');
    });
  });
});
