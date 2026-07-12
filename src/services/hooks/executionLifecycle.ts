const activeHookControllers = new Set<AbortController>();

export function registerHookExecution(parent?: AbortController): {
  controller: AbortController;
  unregister(): void;
} {
  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) controller.abort(parent?.signal.reason);
  };
  if (parent?.signal.aborted) abortFromParent();
  else parent?.signal.addEventListener('abort', abortFromParent, { once: true });
  activeHookControllers.add(controller);
  let registered = true;
  return {
    controller,
    unregister: () => {
      if (!registered) return;
      registered = false;
      activeHookControllers.delete(controller);
      parent?.signal.removeEventListener('abort', abortFromParent);
    },
  };
}

export function abortAllHookExecutions(): number {
  let aborted = 0;
  for (const controller of activeHookControllers) {
    if (controller.signal.aborted) continue;
    controller.abort(new Error('Hook execution stopped because the app entered the background'));
    aborted += 1;
  }
  return aborted;
}
