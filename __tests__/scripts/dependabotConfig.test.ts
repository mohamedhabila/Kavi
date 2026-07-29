const { readFileSync } = require('fs');
const { dirname, join } = require('path');
const yamlNodeEntrypoint = join(dirname(require.resolve('yaml/package.json')), 'dist/index.js');
const { parse } = require(yamlNodeEntrypoint) as typeof import('yaml');

type DependabotGroup = {
  'update-types': string[];
};

type DependabotUpdate = {
  'package-ecosystem': string;
  directory: string;
  schedule: {
    interval: string;
    day: string;
    time: string;
    timezone: string;
  };
  'open-pull-requests-limit': number;
  labels: string[];
  'commit-message': {
    prefix: string;
    include: string;
  };
  groups: Record<string, DependabotGroup>;
};

type DependabotConfig = {
  version: number;
  updates: DependabotUpdate[];
};

function readDependabotConfig(): DependabotConfig {
  const configPath = join(__dirname, '../../.github/dependabot.yml');
  return parse(readFileSync(configPath, 'utf8')) as DependabotConfig;
}

function requireUpdate(config: DependabotConfig, ecosystem: string): DependabotUpdate {
  const update = config.updates.find((candidate) => candidate['package-ecosystem'] === ecosystem);
  if (!update) throw new Error(`Missing Dependabot update for ${ecosystem}`);
  return update;
}

type ExpectedUpdate = {
  ecosystem: string;
  day: string;
  pullRequestLimit: number;
  groupName: string;
};

const expectedUpdates: ExpectedUpdate[] = [
  {
    ecosystem: 'npm',
    day: 'monday',
    pullRequestLimit: 5,
    groupName: 'npm-minor-and-patch',
  },
  {
    ecosystem: 'github-actions',
    day: 'tuesday',
    pullRequestLimit: 3,
    groupName: 'github-actions-minor-and-patch',
  },
];

function expectDependabotUpdate(update: DependabotUpdate, expected: ExpectedUpdate): void {
  expect(update).toMatchObject({
    directory: '/',
    schedule: {
      interval: 'weekly',
      day: expected.day,
      time: '07:00',
      timezone: 'Etc/UTC',
    },
    'open-pull-requests-limit': expected.pullRequestLimit,
    labels: expect.arrayContaining(['dependencies']),
    'commit-message': {
      prefix: 'deps',
      include: 'scope',
    },
  });

  const updateTypes = update.groups[expected.groupName]?.['update-types'];
  expect(updateTypes).toEqual(expect.arrayContaining(['minor', 'patch']));
  expect(updateTypes).not.toContain('major');
}

describe('Dependabot config', () => {
  it('covers npm and GitHub Actions with exact weekly update policies', () => {
    const config = readDependabotConfig();

    expect(config.version).toBe(2);
    expect(config.updates.map((update) => update['package-ecosystem']).sort()).toEqual(
      expectedUpdates.map((update) => update.ecosystem).sort(),
    );

    for (const expected of expectedUpdates) {
      expectDependabotUpdate(requireUpdate(config, expected.ecosystem), expected);
    }
  });
});
