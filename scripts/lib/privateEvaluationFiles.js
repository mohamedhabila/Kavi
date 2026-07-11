const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIVATE_EVALUATION_DIRECTORY = path.join('.private', 'evals');
const MAX_PRIVATE_EVALUATION_FILE_BYTES = 32 * 1024 * 1024;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const POSIX_CUSTODY_CHECKS_SUPPORTED = process.platform !== 'win32';

function isContainedPath(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function assertNoSymlinkComponents(projectRoot, targetPath, label) {
  const relative = path.relative(projectRoot, targetPath);
  if (!isContainedPath(projectRoot, targetPath)) {
    throw new Error(`${label}: must resolve inside the project`);
  }

  let current = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      const detail =
        error && typeof error === 'object' && error.code === 'ENOENT'
          ? 'does not exist'
          : 'cannot be read';
      throw new Error(`${label}: ${detail}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label}: symlink components are prohibited`);
    }
  }
}

function assertOwnedByCurrentUser(stat, label, kind) {
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`${label}: private ${kind} must be owned by the current user`);
  }
}

function assertPrivateDirectoryCustody(privateRoot, targetPath, label) {
  if (!POSIX_CUSTODY_CHECKS_SUPPORTED) return;
  const parent = path.dirname(targetPath);
  const relative = path.relative(privateRoot, parent);
  let current = privateRoot;
  const directories = [current];
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  for (const directory of directories) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory()) {
      throw new Error(`${label}: private path parent must be a directory`);
    }
    if ((stat.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
      throw new Error(`${label}: private directory mode must be 0700`);
    }
    assertOwnedByCurrentUser(stat, label, 'directory');
  }
}

function assertPrivateFileCustody(stat, label) {
  if (!POSIX_CUSTODY_CHECKS_SUPPORTED) return;
  if ((stat.mode & 0o777) !== PRIVATE_FILE_MODE) {
    throw new Error(`${label}: private file mode must be 0600`);
  }
  assertOwnedByCurrentUser(stat, label, 'file');
}

function resolvePrivateEvaluationFile(
  projectRoot,
  requestedPath,
  label,
  baseDirectory = projectRoot,
) {
  if (typeof requestedPath !== 'string' || requestedPath.length === 0) {
    throw new Error(`${label}: is required`);
  }
  if (requestedPath.replace(/\\/gu, '/').split('/').includes('..')) {
    throw new Error(`${label}: path traversal is prohibited`);
  }
  const privateRoot = path.resolve(projectRoot, PRIVATE_EVALUATION_DIRECTORY);
  const resolvedPath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(baseDirectory, requestedPath);
  if (!isContainedPath(privateRoot, resolvedPath)) {
    throw new Error(`${label}: must resolve inside ${PRIVATE_EVALUATION_DIRECTORY}`);
  }

  assertNoSymlinkComponents(projectRoot, privateRoot, label);
  assertNoSymlinkComponents(projectRoot, resolvedPath, label);
  assertPrivateDirectoryCustody(privateRoot, resolvedPath, label);
  const stat = fs.lstatSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`${label}: must be a regular file`);
  }
  assertPrivateFileCustody(stat, label);
  if (stat.size > MAX_PRIVATE_EVALUATION_FILE_BYTES) {
    throw new Error(
      `${label}: exceeds the ${MAX_PRIVATE_EVALUATION_FILE_BYTES}-byte private artifact limit`,
    );
  }
  return resolvedPath;
}

function readPrivateJsonFile(projectRoot, requestedPath, label, baseDirectory = projectRoot) {
  const resolvedPath = resolvePrivateEvaluationFile(
    projectRoot,
    requestedPath,
    label,
    baseDirectory,
  );
  const bytes = fs.readFileSync(resolvedPath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label}: must contain valid JSON`);
  }
  return {
    bytes,
    resolvedPath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    value,
  };
}

module.exports = {
  MAX_PRIVATE_EVALUATION_FILE_BYTES,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_EVALUATION_DIRECTORY,
  PRIVATE_FILE_MODE,
  isContainedPath,
  readPrivateJsonFile,
  resolvePrivateEvaluationFile,
};
