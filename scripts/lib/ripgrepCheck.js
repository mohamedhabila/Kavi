const { execFileSync } = require('child_process');

function isNoMatchesError(error) {
  return error && typeof error === 'object' && 'status' in error && error.status === 1;
}

function splitLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fail(label, message) {
  console.error(`[${label}] ${message}`);
  process.exitCode = 1;
}

function runRipgrep(projectRoot, args, errorMessage) {
  try {
    return execFileSync('rg', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (isNoMatchesError(error)) {
      return '';
    }
    throw new Error(errorMessage || 'Unable to run ripgrep. Install ripgrep (rg) and retry.');
  }
}

function findRipgrepFiles(projectRoot, pattern, paths, options = {}) {
  return splitLines(
    runRipgrep(
      projectRoot,
      ['-l', ...(options.extraArgs || []), pattern, ...paths],
      options.errorMessage,
    ),
  );
}

function findRipgrepLines(projectRoot, pattern, paths, options = {}) {
  return splitLines(
    runRipgrep(
      projectRoot,
      ['-n', ...(options.extraArgs || []), pattern, ...paths],
      options.errorMessage,
    ),
  );
}

function finishCheck(label, failures, successMessage) {
  if (failures.length > 0) {
    for (const failure of failures) {
      fail(label, failure);
    }
    return;
  }

  console.log(`[${label}] ${successMessage}`);
}

module.exports = {
  fail,
  findRipgrepFiles,
  findRipgrepLines,
  finishCheck,
};
