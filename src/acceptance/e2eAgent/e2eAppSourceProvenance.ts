import { execFileSync } from 'child_process';

export type E2EAppSourceRevision = Readonly<{
  commitSha: string;
  dirty: boolean;
}>;

const EXACT_GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export function validateE2EAppSourceRevision(
  source: E2EAppSourceRevision,
  label = 'app source',
): void {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`${label} must be an object.`);
  }
  const keys = Object.keys(source).sort();
  if (keys.length !== 2 || keys[0] !== 'commitSha' || keys[1] !== 'dirty') {
    throw new Error(`${label} has an unsupported schema.`);
  }
  if (!EXACT_GIT_SHA_PATTERN.test(source.commitSha)) {
    throw new Error(`${label}.commitSha must be an exact 40-character Git SHA.`);
  }
  if (typeof source.dirty !== 'boolean') {
    throw new Error(`${label}.dirty must be a boolean.`);
  }
}

export function sameE2EAppSourceRevision(
  left: E2EAppSourceRevision,
  right: E2EAppSourceRevision,
): boolean {
  validateE2EAppSourceRevision(left, 'left app source');
  validateE2EAppSourceRevision(right, 'right app source');
  return left.commitSha === right.commitSha && left.dirty === right.dirty;
}

export function captureE2EAppSourceRevision(cwd = process.cwd()): E2EAppSourceRevision {
  const commitSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const status = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=normal'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const source = { commitSha, dirty: status.length > 0 };
  validateE2EAppSourceRevision(source);
  return source;
}
