import {
  isSkillCompatible,
  parseSkillManifest,
  resetSkillsManagerTestState,
} from '../helpers/skillsManagerHarness';
import type { SkillMetadata } from '../helpers/skillsManagerHarness';

beforeEach(resetSkillsManagerTestState);

describe('parseSkillManifest', () => {
  it('parses valid SKILL.md frontmatter', () => {
    const content = `---
name: My Skill
description: A cool skill
version: 2.0.0
author: Test Author
tags:
  - utility
  - test
invocationPolicy: manual
---

# My Skill

Instructions here.
`;
    const meta = parseSkillManifest(content);
    expect(meta).not.toBeNull();
    expect(meta!.name).toBe('My Skill');
    expect(meta!.description).toBe('A cool skill');
    expect(meta!.version).toBe('2.0.0');
    expect(meta!.author).toBe('Test Author');
    expect(meta!.tags).toEqual(['utility', 'test']);
    expect(meta!.invocationPolicy).toBe('manual');
  });

  it('returns null if name is missing', () => {
    const content = `---
description: No name skill
---
Content`;
    expect(parseSkillManifest(content)).toBeNull();
  });

  it('uses defaults for optional fields', () => {
    const content = `---
name: Minimal
---`;
    const meta = parseSkillManifest(content);
    expect(meta!.description).toBe('');
    expect(meta!.version).toBe('1.0.0');
    expect(meta!.invocationPolicy).toBe('auto');
  });
});

describe('isSkillCompatible', () => {
  it('returns compatible for a standard skill', () => {
    const meta: SkillMetadata = {
      name: 'Normal',
      description: '',
      version: '1.0',
      tags: ['utility'],
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns incompatible for desktop-only skills', () => {
    const meta: SkillMetadata = {
      name: 'Desktop',
      description: '',
      version: '1.0',
      tags: ['desktop-only'],
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('desktop');
  });

  it('returns compatible with reason for skills needing secrets', () => {
    const meta: SkillMetadata = {
      name: 'Secret',
      description: '',
      version: '1.0',
      tags: [],
      requiredSecrets: ['API_KEY'],
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(true);
    expect(result.reason).toContain('API_KEY');
  });

  it('handles missing tags gracefully', () => {
    const meta: SkillMetadata = {
      name: 'NoTags',
      description: '',
      version: '1.0',
    };
    const result = isSkillCompatible(meta);
    expect(result.compatible).toBe(true);
  });
});
