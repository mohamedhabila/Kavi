const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIVATE_EVALUATION_DIRECTORY = path.join('.private', 'evals');
const MAX_PRIVATE_EVALUATION_FILE_BYTES = 32 * 1024 * 1024;

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
  const stat = fs.lstatSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`${label}: must be a regular file`);
  }
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
  PRIVATE_EVALUATION_DIRECTORY,
  isContainedPath,
  readPrivateJsonFile,
  resolvePrivateEvaluationFile,
};
