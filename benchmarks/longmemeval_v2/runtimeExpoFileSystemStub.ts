import { basename, dirname, join } from 'node:path';

export const Paths = {
  cache: '/tmp',
  document: '/tmp',
  bundle: process.cwd(),
  basename,
  dirname,
  join,
};

export class File {
  uri: string;

  constructor(...parts: string[]) {
    this.uri = join(...parts.filter(Boolean));
  }

  get name(): string {
    return basename(this.uri);
  }

  exists(): boolean {
    return false;
  }
}

export class Directory {
  uri: string;

  constructor(...parts: string[]) {
    this.uri = join(...parts.filter(Boolean));
  }

  get name(): string {
    return basename(this.uri);
  }

  exists(): boolean {
    return false;
  }
}
