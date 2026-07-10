const path = require('path');

const { atomicWriteFileSync } = require('./e2eReport/fileTransaction');
const { aggregatePrivateIntentFrameFile } = require('./lib/intentFrameEvaluation');

const projectRoot = path.resolve(__dirname, '..');
const defaultOutputPath = path.join('.artifacts', 'intent-frame-report.json');

function parseArguments(argv) {
  const values = {};
  const failures = [];
  const fields = { '--input': 'inputPath', '--output': 'outputPath' };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const field = fields[option];
    const value = argv[index + 1];
    if (!field) {
      failures.push(`arguments: unknown option ${option ?? '<missing>'}`);
      continue;
    }
    if (typeof value !== 'string' || value.startsWith('--')) {
      failures.push(`arguments: ${option} requires one value`);
      index -= 1;
      continue;
    }
    if (Object.hasOwn(values, field)) failures.push(`arguments: ${option} must be provided once`);
    values[field] = value;
  }
  if (!values.inputPath) failures.push('arguments: --input is required');
  return {
    failures,
    inputPath: values.inputPath,
    outputPath: values.outputPath ?? defaultOutputPath,
  };
}

function resolveOutputPath(requestedPath) {
  if (path.isAbsolute(requestedPath)) {
    throw new Error('intent-frame.output: must be a relative .artifacts path');
  }
  const artifactRoot = path.resolve(projectRoot, '.artifacts');
  const outputPath = path.resolve(projectRoot, requestedPath);
  const relative = path.relative(artifactRoot, outputPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('intent-frame.output: must resolve inside .artifacts');
  }
  return outputPath;
}

const args = parseArguments(process.argv.slice(2));
if (args.failures.length > 0) {
  for (const failure of args.failures) console.error(`[intent-frame] ${failure}`);
  process.exitCode = 1;
} else {
  try {
    const result = aggregatePrivateIntentFrameFile(projectRoot, args.inputPath);
    if (result.reportFailures.length > 0) {
      throw new Error(`aggregate report contract failed: ${result.reportFailures.join('; ')}`);
    }
    atomicWriteFileSync(
      resolveOutputPath(args.outputPath),
      `${JSON.stringify(result.report, null, 2)}\n`,
      'utf8',
    );
    for (const failure of result.contractFailures) console.error(`[intent-frame] ${failure}`);
    console.log(
      `[intent-frame] claimEligible=${result.report.claimEligible} cases=${result.report.counts.cases} macroF1=${result.report.macroF1}`,
    );
    if (!result.report.claimEligible) process.exitCode = 1;
  } catch (error) {
    console.error(`[intent-frame] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
