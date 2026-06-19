import { buildPyodideHtml } from './bootstrap/environment';
import { buildPyodideWorkerSource } from './bootstrap/worker';

let pyodideHtmlCache: string | null = null;

export function getPyodideWorkerSource(): string {
  return buildPyodideWorkerSource();
}

export function getPyodideHtml(): string {
  if (!pyodideHtmlCache) {
    pyodideHtmlCache = buildPyodideHtml(getPyodideWorkerSource());
  }

  return pyodideHtmlCache;
}
