import { githubApi } from '../../github/api';
import { buildGitHubPath } from './normalize';
import { getGitHubToken } from './repository';

function decodeGitHubContent(content: string): string {
  const sanitized = content.replace(/\n/g, '');
  const bufferCtor = (
    globalThis as {
      Buffer?: { from(data: string, encoding: string): { toString(encoding: string): string } };
    }
  ).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(sanitized, 'base64').toString('utf8');
  }

  const atobFn = (globalThis as { atob?: (data: string) => string }).atob;
  if (typeof atobFn === 'function') {
    const binary = atobFn(sanitized);
    const percentEncoded = Array.from(binary)
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join('');
    return decodeURIComponent(percentEncoded);
  }

  throw new Error('Base64 decoding is not supported in this runtime');
}

export async function listGitHubFiles(
  repo: string,
  path: string,
  ref?: string,
): Promise<Array<Record<string, unknown>>> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const data = await githubApi<any>(
    `/repos/${repo}/contents${buildGitHubPath(path)}${query}`,
    await getGitHubToken(),
  );
  const entries = Array.isArray(data) ? data : [data];
  return entries.map((entry: any) => ({
    name: entry.name,
    path: entry.path,
    type: entry.type,
    sha: entry.sha,
    size: entry.size,
    url: entry.html_url,
  }));
}

export async function readGitHubFile(
  repo: string,
  path: string,
  ref?: string,
): Promise<Record<string, unknown>> {
  const token = await getGitHubToken();
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const contentsPath = `/repos/${repo}/contents${buildGitHubPath(path)}${query}`;
  const data = await githubApi<any>(contentsPath, token);

  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`GitHub path ${path} is not a file`);
  }

  let content: string | undefined;
  if (data.encoding === 'base64' && typeof data.content === 'string') {
    content = decodeGitHubContent(data.content);
  } else {
    content = await githubApi<string>(
      contentsPath,
      token,
      {
        headers: {
          Accept: 'application/vnd.github.raw+json',
        },
      },
      { responseType: 'text' },
    );
  }

  return {
    path: data.path,
    sha: data.sha,
    size: data.size,
    ref: ref || null,
    content,
    url: data.html_url,
  };
}
