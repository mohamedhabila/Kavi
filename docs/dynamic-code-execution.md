# Dynamic Code Execution Trust Boundaries

Kavi includes a few intentional dynamic JavaScript execution surfaces. They are
developer and tool features, not security sandboxes. Keep them small, documented,
and covered by tests whenever their behavior changes.

## Local JavaScript Utility

- Surface: `src/utils/javascript.ts`
- Dynamic call: `new Function('console', candidate)`
- Why it exists: evaluates explicit JavaScript snippets for local utility and
  terminal-style workflows, including expression fallback and captured console
  output.
- Input: user or tool-provided JavaScript text after fence normalization and
  candidate wrapping.
- Trust boundary: trusted-by-user app runtime code. Standard JavaScript globals
  may be reachable, so callers must not use this for untrusted remote content.
- Guards and limits: only a fake `console` binding is injected; errors are
  propagated when no console output was produced. This is not process, network,
  or filesystem isolation.
- Tests: `__tests__/utils/javascript-console.test.ts` covers console capture,
  expression execution, fenced code, error propagation, circular formatting, and
  the intentional availability of standard JavaScript globals.

## Workspace JavaScript Bridge

- Surface: `src/utils/jsBridgeExecution.ts`
- Dynamic call: `new Function('runtime', ...)`
- Why it exists: runs JavaScript against the conversation workspace file cache
  with CommonJS-style modules, JSON modules, scoped `fs`, data helpers, and
  explicit environment values.
- Input: inline workspace JavaScript or a workspace entry file selected by the
  caller.
- Trust boundary: trusted-by-user workspace automation code. The bridge limits
  `require` and `fs` to bridge-provided APIs and the in-memory workspace cache,
  but it is not a hostile-code sandbox.
- Guards and limits: workspace paths are normalized and path traversal out of
  the workspace is rejected; unsupported Node modules are not resolved unless
  they are bridge builtins; `process.env` is copied from explicit context only.
- Tests: `__tests__/utils/jsBridge.test.ts` covers file-cache reads/writes,
  module resolution, path traversal rejection, unsupported module rejection, and
  explicit environment scoping.

## Productivity Calculator

- Surface: `src/services/integrations/productivity/skill.ts`
- Dynamic call: `new Function('"use strict"; return (...)')`
- Why it exists: evaluates compact arithmetic expressions for the built-in
  productivity calculator.
- Input: the `calculate` tool's `expression` argument.
- Trust boundary: arithmetic-only tool input. It must not become a general
  JavaScript execution surface.
- Guards and limits: expressions are allowlist-filtered before execution, known
  math function names are mapped to `Math.*`, unsupported characters are
  rejected, and non-finite results are rejected.
- Tests: `__tests__/services/service-skills-new.test.ts` covers normal
  arithmetic, math helpers, invalid expressions, unsupported character
  rejection, and finite-result enforcement.

## Canvas WebView Eval

- Surface: `src/components/canvas/CanvasSurfacePresenter.tsx`
- Dynamic call: `Function(__candidates[__i])()` inside injected WebView script
- Why it exists: lets canvas tools inspect or compute against the currently
  loaded interactive canvas document.
- Input: canvas eval script routed through the canvas event handler and encoded
  into candidate snippets with `buildJavaScriptCandidates`.
- Trust boundary: the active canvas WebView document. Eval runs in the canvas
  page context and can observe page globals; it must only be used for canvases
  the user has opened or generated.
- Guards and limits: the script is JSON-encoded before injection, execution is
  tied to the active WebView, result/error messages are returned through
  `window.ReactNativeWebView.postMessage`, and pending eval work is associated
  with a surface id. WebView eval is not a sandbox for untrusted pages.
- Tests: `__tests__/components/canvas/CanvasSurfacePresenter.test.tsx` covers
  hardened WebView file settings, event handler registration, and eval injection
  through JSON-encoded candidates.
