export function fetchWithoutCookies(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: init.credentials ?? 'omit',
  });
}
