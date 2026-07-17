import fs from 'fs';
import os from 'os';
import path from 'path';

export type PrivateEvaluationCliProject = Readonly<{
  projectRoot: string;
  privateRoot: string;
  scriptPath: (scriptName: string) => string;
  spawnEnv: NodeJS.ProcessEnv;
  cleanup: () => void;
}>;

export function createPrivateEvaluationCliProject(
  sourceProjectRoot: string,
): PrivateEvaluationCliProject {
  const projectRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'kavi-private-eval-cli-')),
  );
  fs.cpSync(path.join(sourceProjectRoot, 'scripts'), path.join(projectRoot, 'scripts'), {
    recursive: true,
  });
  fs.cpSync(path.join(sourceProjectRoot, 'evaluation'), path.join(projectRoot, 'evaluation'), {
    recursive: true,
  });
  const privateRoot = path.join(projectRoot, '.private', 'evals');
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });

  return {
    projectRoot,
    privateRoot,
    scriptPath: (scriptName) => path.join(projectRoot, 'scripts', scriptName),
    spawnEnv: {
      ...process.env,
      NODE_PATH: path.join(sourceProjectRoot, 'node_modules'),
    },
    cleanup: () => {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}
