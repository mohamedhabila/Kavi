function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWait(args: { ms?: number; reason?: string }): Promise<string> {
  const requestedMs = Number.isFinite(args.ms) ? Number(args.ms) : 1000;
  const ms = Math.max(100, Math.min(requestedMs, 60000));
  await sleepAsync(ms);
  return JSON.stringify({
    status: 'waited',
    waitedMs: ms,
    reason: args.reason,
  });
}

export async function executePdfRead(args: { path: string; pages?: string }): Promise<string> {
  if (args.path.startsWith('http://') || args.path.startsWith('https://')) {
    try {
      const url = new URL(args.path);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return JSON.stringify({ error: 'Only http/https URLs are supported' });
      }

      const htmlRes = await fetch(args.path, {
        headers: { Accept: 'text/html, application/xhtml+xml, */*' },
      });

      if (htmlRes.ok) {
        const contentType = htmlRes.headers.get('content-type') || '';

        if (contentType.includes('text/html') || contentType.includes('xhtml')) {
          const html = await htmlRes.text();
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text.length > 100) {
            return JSON.stringify({
              status: 'extracted',
              url: args.path,
              content: text.slice(0, 50000),
              charCount: Math.min(text.length, 50000),
              method: 'html_rendition',
            });
          }
        }

        if (contentType.includes('application/pdf')) {
          const size = Number(htmlRes.headers.get('content-length') || 0);
          return JSON.stringify({
            status: 'fetched_but_not_parsed',
            url: args.path,
            contentType: 'application/pdf',
            sizeBytes: size || undefined,
            suggestion:
              'Mobile PDF text extraction is limited. Alternatives: ' +
              '(1) Use web_fetch on the same URL for a readable version. ' +
              '(2) Upload the PDF as an attachment for vision-capable models. ' +
              '(3) Look for an HTML version of this document.',
          });
        }

        const text = await htmlRes.text();
        return JSON.stringify({
          status: 'extracted',
          url: args.path,
          content: text.slice(0, 50000),
          charCount: Math.min(text.length, 50000),
          method: 'direct_text',
        });
      }
      return JSON.stringify({ error: `HTTP ${htmlRes.status} fetching PDF URL` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: message });
    }
  }

  return JSON.stringify({
    status: 'unsupported',
    path: args.path,
    suggestion:
      'Local PDF text extraction requires a native PDF library. ' +
      'Attach the PDF to your message for vision-capable models, or provide a URL instead.',
  });
}