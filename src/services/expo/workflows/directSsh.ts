import type { ExpoAccountConfig, ExpoProjectConfig } from '../../../types/remote';
import {
  getExpoProjectDisplayOwner,
  getExpoProjectSlug,
  requireExpoProjectPath,
  shellQuote,
} from '../projectState';
import { getDefaultPlatforms } from '../workflowStatus';
function buildDirectCommand(
  project: ExpoProjectConfig,
  account: ExpoAccountConfig,
  action: 'build' | 'update' | 'submit' | 'deploy-web',
  args: {
    platform?: 'android' | 'ios' | 'all';
    profile?: string;
    branch?: string;
    message?: string;
    alias?: string;
  },
  token: string,
): string {
  const owner = getExpoProjectDisplayOwner(project, account);
  const cwd = shellQuote(requireExpoProjectPath(project));
  const profile = args.profile || project.defaultBuildProfile || 'production';
  const branch = args.branch || project.defaultUpdateBranch || 'production';
  const platform = args.platform || 'android';
  const message = args.message?.trim() || `Triggered from Kavi for ${project.name}`;
  const slug = getExpoProjectSlug(project) || 'unknown-project';

  const parts = [
    `export EXPO_TOKEN=${shellQuote(token)}`,
    `export EXPO_NO_TELEMETRY=1`,
    `cd ${cwd}`,
    `npx --yes eas-cli@latest whoami --non-interactive`,
  ];

  if (action === 'build') {
    parts.push(
      `npx --yes eas-cli@latest build --platform ${platform} --profile ${shellQuote(profile)} --non-interactive`,
    );
  } else if (action === 'submit') {
    parts.push(
      `npx --yes eas-cli@latest submit --platform ${platform} --profile ${shellQuote(profile)} --latest --non-interactive`,
    );
  } else if (action === 'update') {
    parts.push(
      `npx --yes eas-cli@latest update --branch ${shellQuote(branch)} --message ${shellQuote(message)} --non-interactive`,
    );
  } else {
    parts.push(`npx --yes eas-cli@latest deploy --prod --non-interactive`);
  }

  parts.push(
    `printf '\nOwner: ${owner}\nSlug: ${slug}\nPlatforms: ${getDefaultPlatforms(project).join(', ')}\n'`,
  );
  return parts.join(' && ');
}

export { buildDirectCommand };
