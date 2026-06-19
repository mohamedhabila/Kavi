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

import {
  listClawHubSkills,
  getFeaturedSkills,
  searchClawHub,
} from '../../src/services/clawhub/apiClient';
import { __resetClawHubConvexDiscoveryForTests } from '../../src/services/clawhub/convexClient';
import {
  installSkillFromHub,
  installSkillFromUrl,
  updateSkillFromHub,
} from '../../src/services/clawhub/installWorkflow';
import { zipSync } from 'fflate';

const TEST_CLAWHUB_CONVEX_URL = 'https://clawhub-convex.example.invalid';

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function mockClawHubBrowseDiscovery(): void {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      text: async () => '<html><link rel="modulepreload" href="/assets/main-test.js"></html>',
    })
    .mockResolvedValueOnce({
      ok: true,
      text: async () => `globalThis.env = { VITE_CONVEX_URL: "${TEST_CLAWHUB_CONVEX_URL}" };`,
    });
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

  it('maps the documented v1 search response shape with a single request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            score: 0.9,
            slug: 'memory-tiering',
            displayName: 'Memory Tiering',
            summary: 'Automated memory management.',
            version: null,
            updatedAt: 1,
          },
        ],
      }),
    });

    const result = await searchClawHub('memory');

    expect(result.skills).toEqual([
      expect.objectContaining({
        id: 'memory-tiering',
        name: 'Memory Tiering',
        description: 'Automated memory management.',
        version: '',
        downloads: 0,
        rating: 0,
        installUrl: 'https://clawhub.ai/api/v1/skills/memory-tiering/file?path=SKILL.md',
      }),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/search?q=memory&limit=20'),
      expect.any(Object),
    );
  });

  it('returns the v1 search version when the endpoint provides one', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          {
            slug: 'memory-hygiene',
            displayName: 'Memory Hygiene',
            summary: 'Fallback result.',
            version: '1.5.2',
            updatedAt: 1,
          },
        ],
      }),
    });

    const result = await searchClawHub('memory');

    expect(result.skills).toEqual([
      expect.objectContaining({
        id: 'memory-hygiene',
        version: '1.5.2',
        downloads: 0,
      }),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/search?q=memory&limit=20'),
      expect.any(Object),
    );
  });

  it('maps featured skills from the live list endpoint', async () => {
    const payload = {
      status: 'success',
      value: {
        hasMore: false,
        nextCursor: null,
        page: [
          {
            skill: {
              slug: 'self-improving-agent',
              displayName: 'Self Improving Agent',
              summary: 'Captures learnings.',
              tags: { latest: '3.0.2' },
              stats: { downloads: 12, stars: 4 },
            },
            latestVersion: { version: '3.0.2' },
            ownerHandle: 'steipete',
          },
        ],
      },
    };

    mockClawHubBrowseDiscovery();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    });

    const skills = await getFeaturedSkills();

    expect(skills[0]).toEqual(
      expect.objectContaining({
        id: 'self-improving-agent',
        version: '3.0.2',
        downloads: 12,
        rating: 4,
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      'https://clawhub.ai/skills?nonSuspicious=true',
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://clawhub.ai/assets/main-test.js',
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      `${TEST_CLAWHUB_CONVEX_URL}/api/query`,
      expect.any(Object),
    );
  });

  it('returns a cursor when listing skills from the live list endpoint', async () => {
    mockClawHubBrowseDiscovery();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        value: {
          hasMore: true,
          nextCursor: 'cursor-2',
          page: [
            {
              skill: {
                slug: 'find-skills',
                displayName: 'Find Skills',
                summary: 'Browse the registry.',
                stats: { downloads: 120 },
              },
              latestVersion: { version: '0.1.0' },
              ownerHandle: 'builder',
            },
            {
              skill: {
                slug: 'less-popular-skill',
                displayName: 'Less Popular Skill',
                summary: 'Lower downloads.',
                stats: { downloads: 12 },
              },
              latestVersion: { version: '0.0.9' },
              ownerHandle: 'builder',
            },
          ],
        },
      }),
    });

    const result = await listClawHubSkills({ limit: 1, sort: 'downloads' });

    expect(result).toEqual({
      skills: [
        expect.objectContaining({
          id: 'find-skills',
          name: 'Find Skills',
          downloads: 120,
        }),
        expect.objectContaining({
          id: 'less-popular-skill',
          downloads: 12,
        }),
      ],
      nextCursor: 'cursor-2',
    });

    const [url, init] = mockFetch.mock.calls[2];
    expect(url).toBe(`${TEST_CLAWHUB_CONVEX_URL}/api/query`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      path: 'skills:listPublicPageV4',
      args: {
        numItems: 1,
        sort: 'downloads',
        dir: 'desc',
        nonSuspiciousOnly: true,
      },
    });
  });

  it('uses an explicit ClawHub Convex URL when configured', async () => {
    process.env.EXPO_PUBLIC_CLAWHUB_CONVEX_URL = TEST_CLAWHUB_CONVEX_URL;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'success',
        value: {
          hasMore: false,
          nextCursor: null,
          page: [
            {
              skill: {
                slug: 'configured-source',
                displayName: 'Configured Source',
                summary: 'Loaded through configured Convex URL.',
              },
              latestVersion: { version: '1.0.0' },
            },
          ],
        },
      }),
    });

    const result = await listClawHubSkills({ limit: 1, sort: 'newest' });

    expect(result.skills[0]).toEqual(
      expect.objectContaining({
        id: 'configured-source',
        name: 'Configured Source',
      }),
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_CLAWHUB_CONVEX_URL}/api/query`,
      expect.any(Object),
    );
  });

  it('installs a skill from a direct URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `---
name: Remote Skill
description: Test install
version: 1.2.3
tools:
  - search_web
---

Prompt body`,
    });

    const result = await installSkillFromUrl('https://example.com/SKILL.md');

    expect(result.success).toBe(true);
    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({
          source: 'url',
          url: 'https://example.com/SKILL.md',
          managedFiles: ['SKILL.md'],
        }),
        metadata: expect.objectContaining({
          name: 'Remote Skill',
          version: '1.2.3',
          tools: ['search_web'],
        }),
      }),
    );
  });

  it('fetches referenced sidecar files when installing a remote skill bundle', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `---
name: Bundle Skill
description: Skill with docs
version: 1.0.0
---

# Bundle Skill

Read [the guide](docs/guide.md).`,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '# Guide\n\nUse the workflow.',
      });

    await installSkillFromUrl('https://example.com/skills/bundle/SKILL.md');

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/skills/bundle/docs/guide.md',
      expect.any(Object),
    );
    expect(mockSaveManagedSkillBundle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        'SKILL.md': expect.stringContaining('Bundle Skill'),
        'docs/guide.md': '# Guide\n\nUse the workflow.',
      }),
      {},
    );
  });

  it('downloads referenced Python sidecars and stores bundled Python analysis on install', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `---
name: Python Bundle Skill
description: Skill with a packaged Python entrypoint
version: 1.0.0
---

Run \`scripts/generate.py\` with \`uv run scripts/generate.py --prompt "hello"\`.`,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          [
            '# /// script',
            '# dependencies = [',
            '#   "httpx",',
            '# ]',
            '# ///',
            'import httpx',
            'print("ok")',
          ].join('\n'),
      });

    const result = await installSkillFromUrl('https://example.com/skills/python/SKILL.md');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/skills/python/scripts/generate.py',
      expect.any(Object),
    );
    expect(mockSaveManagedSkillBundle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        'SKILL.md': expect.stringContaining('Python Bundle Skill'),
        'scripts/generate.py': expect.stringContaining('import httpx'),
      }),
      {},
    );
    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          bundledPython: expect.objectContaining({
            scriptPaths: ['scripts/generate.py'],
            dependencies: ['httpx'],
            pyodideCompatible: false,
          }),
        }),
      }),
    );
  });

  it('detects Python sidecars referenced from shell code blocks when installing generic skill URLs', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `---
name: Ontology Skill
description: Shell example references a Python sidecar
version: 1.0.0
---

Run the script:

\`\`\`bash
python3 scripts/ontology.py validate
\`\`\`
`,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'print("ok")\n',
      });

    const result = await installSkillFromUrl('https://example.com/skills/ontology/SKILL.md');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/skills/ontology/scripts/ontology.py',
      expect.any(Object),
    );
    expect(mockSaveManagedSkillBundle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        'scripts/ontology.py': 'print("ok")\n',
      }),
      {},
    );
  });

  it('installs a ClawHub skill from the documented version manifest and bundle download endpoints', async () => {
    const zipBytes = zipSync({
      'SKILL.md': new TextEncoder().encode(`---
name: Bundle Skill
description: Installed from zip
version: 1.0.0
---

Prompt body`),
      'README.md': new TextEncoder().encode('# Readme\n\nExtra docs.'),
      'bin/tool': new Uint8Array([1, 2, 3]),
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: {
            version: '1.0.0',
            files: [
              { path: 'SKILL.md', contentType: 'text/markdown' },
              { path: 'README.md', contentType: 'text/markdown' },
              { path: 'bin/tool', contentType: 'application/octet-stream' },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () =>
          zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength),
      });

    const result = await installSkillFromHub({
      id: 'bundle-skill',
      name: 'Bundle Skill',
      description: 'Installed from zip',
      version: '1.0.0',
      author: 'Test',
      tags: ['latest'],
      downloads: 10,
      rating: 5,
      installUrl: 'https://clawhub.ai/api/v1/skills/bundle-skill/file?path=SKILL.md',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/skills/bundle-skill/versions/1.0.0'),
      expect.any(Object),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/download?slug=bundle-skill&version=1.0.0'),
      expect.any(Object),
    );
    expect(mockSaveManagedSkillBundle).toHaveBeenCalledWith(
      expect.any(Object),
      {
        'SKILL.md': expect.stringContaining('Prompt body'),
        'README.md': '# Readme\n\nExtra docs.',
      },
      {
        'bin/tool': expect.any(Uint8Array),
      },
    );
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
