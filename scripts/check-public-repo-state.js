const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const gitDir = path.join(projectRoot, '.git');
const privatePaths = ['_research'];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function hasGitCheckout() {
  return fs.existsSync(gitDir);
}

function listTrackedEntries(targetPath) {
  const output = git(['ls-files', '--', targetPath]);
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isIgnored(targetPath) {
  try {
    git(['check-ignore', '-q', targetPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`[check-public-repo-state] ${message}`);
  process.exitCode = 1;
}

function main() {
  if (!hasGitCheckout()) {
    console.log(
      '[check-public-repo-state] Skipping tracked-history checks because no .git directory is present.',
    );
    return;
  }

  const failures = [];

  for (const targetPath of privatePaths) {
    const trackedEntries = listTrackedEntries(targetPath);
    if (trackedEntries.length > 0) {
      failures.push(
        `${targetPath} is tracked by git and must stay out of the public repository history.`,
      );
    }
    if (!isIgnored(targetPath)) {
      failures.push(`${targetPath} is not ignored by git. Add it to .gitignore before publishing.`);
    }
  }

  if (failures.length > 0) {
    failures.forEach(fail);
    return;
  }

  console.log('[check-public-repo-state] Private working material is ignored and not tracked.');
}

main();
