type FetchJsonOptions = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  errorPrefix?: string;
};

export async function fetchJson<T>(options: FetchJsonOptions): Promise<T> {
  const response = await fetch(options.url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const prefix = options.errorPrefix || 'API';
    throw new Error(`${prefix} ${response.status}: ${body.slice(0, 500)}`);
  }

  if (typeof response.text !== 'function') {
    if (typeof response.json === 'function') {
      return response.json() as Promise<T>;
    }
    return undefined as T;
  }

  const text = await response.text().catch(() => '');
  if (!text.trim()) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}
