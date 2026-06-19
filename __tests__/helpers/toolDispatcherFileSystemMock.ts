jest.mock('expo-file-system', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const store: Record<string, Uint8Array> = {};
  const dirs = new Set<string>();

  const normalizeUri = (value: string): string => value.replace(/\/+$/g, '');

  const joinUri = (...parts: string[]): string => {
    if (parts.length === 0) return '';
    let result = parts[0] || '';
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index] || '';
      result = `${normalizeUri(result)}/${part.replace(/^\/+/, '')}`;
    }
    return normalizeUri(result);
  };

  const ensureParents = (uri: string) => {
    const normalized = normalizeUri(uri);
    const pieces = normalized.split('/');
    for (let index = 3; index < pieces.length; index += 1) {
      const dirUri = pieces.slice(0, index).join('/');
      if (dirUri) {
        dirs.add(dirUri);
      }
    }
  };

  class MockFile {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }
      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get exists() {
      return this.uri in store;
    }

    text() {
      return decoder.decode(store[this.uri] || new Uint8Array());
    }

    bytes() {
      return store[this.uri] || new Uint8Array();
    }

    write(content: string | Uint8Array | ArrayBuffer) {
      ensureParents(this.uri);
      if (typeof content === 'string') {
        store[this.uri] = encoder.encode(content);
        return;
      }
      if (content instanceof Uint8Array) {
        store[this.uri] = content;
        return;
      }
      store[this.uri] = new Uint8Array(content);
    }

    delete() {
      delete store[this.uri];
    }
  }

  class MockDirectory {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const part of parts) {
        if (typeof part === 'string') {
          pathParts.push(part);
        } else if (part && typeof part.uri === 'string') {
          pathParts.push(part.uri);
        }
      }
      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }

    get exists() {
      return dirs.has(this.uri);
    }

    create() {
      ensureParents(this.uri);
      dirs.add(this.uri);
    }

    list() {
      const prefix = this.uri.endsWith('/') ? this.uri : `${this.uri}/`;
      const results: any[] = [];
      const seen = new Set<string>();

      for (const dir of Array.from(dirs)) {
        if (!dir.startsWith(prefix) || dir === this.uri) {
          continue;
        }
        const rest = dir.slice(prefix.length);
        const firstPart = rest.split('/')[0];
        if (!firstPart || seen.has(firstPart)) {
          continue;
        }
        seen.add(firstPart);
        results.push(new MockDirectory(this, firstPart));
      }

      for (const uri of Object.keys(store)) {
        if (!uri.startsWith(prefix)) {
          continue;
        }
        const rest = uri.slice(prefix.length);
        const firstPart = rest.split('/')[0];
        if (!firstPart || seen.has(firstPart)) {
          continue;
        }
        seen.add(firstPart);
        if (rest.includes('/')) {
          results.push(new MockDirectory(this, firstPart));
        } else {
          results.push(new MockFile(this, firstPart));
        }
      }

      return results;
    }
  }

  const documentRoot = 'file:///mock/documents';
  const cacheRoot = 'file:///mock/cache';
  dirs.add(documentRoot);
  dirs.add(cacheRoot);

  return {
    Paths: {
      get document() {
        return new MockDirectory(documentRoot);
      },
      get cache() {
        return new MockDirectory(cacheRoot);
      },
    },
    File: MockFile,
    Directory: MockDirectory,
    __resetStore: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
      dirs.clear();
      dirs.add(documentRoot);
      dirs.add(cacheRoot);
    },
  };
});
