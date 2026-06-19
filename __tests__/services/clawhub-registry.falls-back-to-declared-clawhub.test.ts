const mockAddEntry = jest.fn();
const mockUpdateEntry = jest.fn();
const mockFetch = jest.fn();
const mockSaveManagedSkillBundle = jest.fn(async (entry, files, binaryFiles = {}) => ({
  ...entry,
  source: {
    ...entry.source,
    managedDir: `${entry.metadata.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${entry.source.id || entry.id}`,
    managedFiles: Array.from(new Set([...Object.keys(files), ...Object.keys(binaryFiles)])).sort(),
    managedBinaryFiles:
      Object.keys(binaryFiles).length > 0 ? Object.keys(binaryFiles).sort() : undefined,
  },
}));
jest.mock('../../src/services/skills/manager', () => ({
  useSkillsStore: {
    getState: () => ({
      addEntry: mockAddEntry,
      updateEntry: mockUpdateEntry,
    }),
  },
}));
jest.mock('../../src/services/skills/storage', () => ({
  normalizeSkillRelativePath: (value: string) =>
    value.replace(/^\.\//, '').replace(/^\/+/, '').includes('..')
      ? null
      : value.replace(/^\.\//, '').replace(/^\/+/, ''),
  saveManagedSkillBundle: (...args: any[]) => mockSaveManagedSkillBundle(...args),
}));
(global as any).fetch = mockFetch;
import { __resetClawHubConvexDiscoveryForTests } from '../../src/services/clawhub/convexClient';
import { installSkillFromHub, installSkillFromUrl, updateSkillFromHub } from '../../src/services/clawhub/installWorkflow';
import { zipSync } from 'fflate';
function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('ClawHub registry client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockAddEntry.mockReset();
    mockUpdateEntry.mockReset();
    mockSaveManagedSkillBundle.mockClear();
    __resetClawHubConvexDiscoveryForTests();
    delete process.env.EXPO_PUBLIC_CLAWHUB_CONVEX_URL;
  });
  it('falls back to the declared ClawHub file list when the bundle download cannot be unzipped', async () => {
    const invalidZip = new TextEncoder().encode('not-a-zip');
    const iconBytes = new Uint8Array([1, 2, 3, 4]);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: {
            version: '1.0.0',
            files: [
              { path: 'SKILL.md', contentType: 'text/markdown' },
              { path: 'scripts/ontology.py', contentType: 'text/x-python-script' },
              { path: 'assets/icon.png', contentType: 'image/png' },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => toExactArrayBuffer(invalidZip),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `---
name: Ontology Skill
description: Installed from declared files
version: 1.0.0
---

Run scripts/ontology.py`,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'print("ontology")\n',
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => toExactArrayBuffer(iconBytes),
      });

    const result = await installSkillFromHub({
      id: 'ontology',
      name: 'Ontology Skill',
      description: 'Installed from declared files',
      version: '1.0.0',
      author: 'Test',
      tags: [],
      downloads: 0,
      rating: 0,
      installUrl: 'https://clawhub.ai/api/v1/skills/ontology/file?path=SKILL.md',
    });

    expect(result.success).toBe(true);
    expect(mockSaveManagedSkillBundle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        'SKILL.md': expect.stringContaining('Ontology Skill'),
        'scripts/ontology.py': 'print("ontology")\n',
      }),
      {
        'assets/icon.png': iconBytes,
      },
    );
  });
  it('treats direct ClawHub file URLs as full bundle installs, not single-file installs', async () => {
    const zipBytes = zipSync({
      'SKILL.md': new TextEncoder().encode(`---
name: Direct URL Skill
description: Installed from a ClawHub file URL
version: 1.0.0
---

Run scripts/run.py`),
      'scripts/run.py': new TextEncoder().encode('print("hi")\n'),
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skill: {
            slug: 'direct-url-skill',
            displayName: 'Direct URL Skill',
            summary: 'Installed from a file URL',
            stats: { downloads: 5, stars: 1 },
          },
          latestVersion: { version: '1.0.0' },
          owner: { handle: 'builder', displayName: 'builder' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: {
            version: '1.0.0',
            files: [
              { path: 'SKILL.md', contentType: 'text/markdown' },
              { path: 'scripts/run.py', contentType: 'text/x-python-script' },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => toExactArrayBuffer(new Uint8Array(zipBytes)),
      });

    const result = await installSkillFromUrl(
      'https://clawhub.ai/api/v1/skills/direct-url-skill/file?path=SKILL.md&version=1.0.0',
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/skills/direct-url-skill'),
      expect.any(Object),
    );
    expect(mockSaveManagedSkillBundle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        'SKILL.md': expect.stringContaining('Direct URL Skill'),
        'scripts/run.py': 'print("hi")\n',
      }),
      {},
    );
  });
  it('resolves the real published version before installing search results that only expose internal tag ids', async () => {
    const zipBytes = zipSync({
      'SKILL.md': new TextEncoder().encode(`---
name: Search Result Skill
description: Installed after version resolution
version: 1.0.4
---

Prompt body`),
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          skill: {
            slug: 'ontology',
            displayName: 'ontology',
            summary: 'Typed knowledge graph',
            tags: { latest: '1.0.4' },
            stats: { downloads: 10, stars: 5 },
          },
          latestVersion: { version: '1.0.4' },
          owner: { handle: 'oswalpalash', displayName: 'oswalpalash' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: {
            version: '1.0.4',
            files: [{ path: 'SKILL.md', contentType: 'text/markdown' }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength),
      });

    const result = await installSkillFromHub({
      id: 'ontology',
      name: 'ontology',
      description: 'Typed knowledge graph',
      version: 'k97ffze3zez06e1m81k7nrwn2182qtgz',
      author: 'oswalpalash',
      tags: [],
      downloads: 113398,
      rating: 315,
      installUrl: 'https://clawhub.ai/api/v1/skills/ontology/file?path=SKILL.md',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/skills/ontology'),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/skills/ontology/versions/1.0.4'),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('/download?slug=ontology&version=1.0.4'),
      expect.any(Object),
    );
  });
  it('updates a ClawHub skill from the bundle download path and persists the new version', async () => {
    const zipBytes = zipSync({
      'SKILL.md': new TextEncoder().encode(`---
name: Bundle Skill
description: Updated from zip
version: 2.0.0
---

Updated prompt body`),
      'README.md': new TextEncoder().encode('# Updated\n'),
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: {
            version: '2.0.0',
            files: [
              { path: 'SKILL.md', contentType: 'text/markdown' },
              { path: 'README.md', contentType: 'text/markdown' },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength),
      });

    const result = await updateSkillFromHub(
      {
        id: 'entry-1',
        enabled: true,
        installedAt: 1,
        metadata: {
          name: 'Bundle Skill',
          description: 'Old description',
          version: '1.0.0',
        },
        source: {
          source: 'clawhub',
          id: 'bundle-skill',
          version: '1.0.0',
          url: 'https://clawhub.ai/api/v1/skills/bundle-skill/file?path=SKILL.md',
        },
        systemPrompt: 'Old prompt',
      },
      '2.0.0',
    );

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/skills/bundle-skill/versions/2.0.0'),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/download?slug=bundle-skill&version=2.0.0'),
      expect.any(Object),
    );
    expect(mockUpdateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ version: '2.0.0', description: 'Updated from zip' }),
        source: expect.objectContaining({ version: '2.0.0' }),
        systemPrompt: 'Updated prompt body',
      }),
    );
  });
  it('preserves Kavi setup metadata when installing a skill', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `---
name: GitHub Skill
description: Test install
version: 1.2.3
metadata:
  kavi:
    skillKey: github
    primaryEnv: GITHUB_TOKEN
    requires:
      env:
        - GITHUB_TOKEN
tools:
  - repos
---

Prompt body`,
    });

    await installSkillFromUrl('https://example.com/SKILL.md');

    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          skillKey: 'github',
          primaryEnv: 'GITHUB_TOKEN',
          requiredSecrets: ['GITHUB_TOKEN'],
        }),
      }),
    );
  });
});
