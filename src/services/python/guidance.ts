// ---------------------------------------------------------------------------
// Kavi — Shared Python Capability Guidance
// ---------------------------------------------------------------------------

export const PYTHON_EXTENSION_WHEN_NEEDED =
  'When a built-in tool stops short of the needed artifact or transformation, treat python as a capability-extension tool before declaring the task impossible.';

export const PYTHON_EXTENSION_EXAMPLES =
  'Python can bridge gaps with Pyodide-compatible scripts for custom exports or conversions such as DOCX/XLSX/HTML/SVG/CSV generation, structured report assembly, batch transforms, and bespoke parsing or validation.';

export const PYTHON_EXTENSION_POLICY =
  'Prefer dedicated first-class tools when they directly fit, but use python as the capability bridge when no direct tool exactly matches the task.';
