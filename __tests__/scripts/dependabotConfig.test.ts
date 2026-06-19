const { readFileSync } = require('fs');
const { join } = require('path');

function readDependabotConfig(): string {
  const configPath = join(__dirname, '../../.github/dependabot.yml');
  return readFileSync(configPath, 'utf8');
}

function extractUpdateBlock(config: string, ecosystem: string): string {
  const marker = `  - package-ecosystem: ${ecosystem}`;
  const start = config.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing Dependabot update for ${ecosystem}`);
  }
  const next = config.indexOf('\n  - package-ecosystem: ', start + marker.length);
  return config.slice(start, next === -1 ? undefined : next);
}

function extractOpenPullRequestLimit(updateBlock: string): number {
  const match = updateBlock.match(/open-pull-requests-limit:\s*(\d+)/);
  if (!match) {
    throw new Error('Missing open-pull-requests-limit');
  }
  return Number(match[1]);
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

function expectDependabotUpdateBlock(updateBlock: string, expected: ExpectedUpdate): void {
  expect(updateBlock).toContain('directory: /');
  expect(updateBlock).toContain('interval: weekly');
  expect(updateBlock).toContain(`day: ${expected.day}`);
  expect(updateBlock).toContain('time: "07:00"');
  expect(updateBlock).toContain('timezone: Etc/UTC');
  expect(extractOpenPullRequestLimit(updateBlock)).toBe(expected.pullRequestLimit);
  expect(updateBlock).toContain('- dependencies');
  expect(updateBlock).toContain('commit-message:');
  expect(updateBlock).toContain('prefix: deps');
  expect(updateBlock).toContain('include: scope');
  expect(updateBlock).toContain(`${expected.groupName}:`);
  expect(updateBlock).toContain('- minor');
  expect(updateBlock).toContain('- patch');
}

describe('Dependabot config', () => {
  it('covers npm and GitHub Actions with exact weekly update policies', () => {
    const config = readDependabotConfig();
    const ecosystems = Array.from(config.matchAll(/^\s+- package-ecosystem:\s*(\S+)$/gm)).map(
      (match) => match[1],
    );

    expect(config).toContain('version: 2');
    expect(ecosystems.sort()).toEqual(expectedUpdates.map((update) => update.ecosystem).sort());

    for (const expected of expectedUpdates) {
      const updateBlock = extractUpdateBlock(config, expected.ecosystem);
      expectDependabotUpdateBlock(updateBlock, expected);
    }
  });

  it('groups routine minor and patch updates while leaving majors explicit', () => {
    const config = readDependabotConfig();
    const npmUpdate = extractUpdateBlock(config, 'npm');
    const actionsUpdate = extractUpdateBlock(config, 'github-actions');

    expect(npmUpdate).toContain('npm-minor-and-patch:');
    expect(npmUpdate).toContain('- minor');
    expect(npmUpdate).toContain('- patch');
    expect(npmUpdate).not.toContain('- major');
    expect(actionsUpdate).toContain('github-actions-minor-and-patch:');
    expect(actionsUpdate).toContain('- minor');
    expect(actionsUpdate).toContain('- patch');
    expect(actionsUpdate).not.toContain('- major');
  });
});
