// ---------------------------------------------------------------------------
// Kavi — ID Generator
// ---------------------------------------------------------------------------

let counter = 0;

export function generateId(): string {
  counter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${ts}_${rand}_${counter}`;
}
