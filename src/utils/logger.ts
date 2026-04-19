import { isJestRuntime } from './runtime';

type LoggerMethod = (...args: unknown[]) => void;

export interface Logger {
  debug: LoggerMethod;
  devLog: LoggerMethod;
  warn: LoggerMethod;
  devWarn: LoggerMethod;
  error: LoggerMethod;
}

function shouldEmitDevLogs(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ && !isJestRuntime();
}

function emit(method: 'debug' | 'log' | 'warn' | 'error', scope: string, args: unknown[]): void {
  const scopedArgs =
    args.length > 0 && typeof args[0] === 'string'
      ? [`[${scope}] ${args[0]}`, ...args.slice(1)]
      : [`[${scope}]`, ...args];

  switch (method) {
    case 'debug':
      console.debug(...scopedArgs);
      break;
    case 'log':
      console.log(...scopedArgs);
      break;
    case 'warn':
      console.warn(...scopedArgs);
      break;
    case 'error':
      console.error(...scopedArgs);
      break;
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...args: unknown[]) => {
      if (!shouldEmitDevLogs()) {
        return;
      }
      emit('debug', scope, args);
    },
    devLog: (...args: unknown[]) => {
      if (!shouldEmitDevLogs()) {
        return;
      }
      emit('log', scope, args);
    },
    warn: (...args: unknown[]) => {
      emit('warn', scope, args);
    },
    devWarn: (...args: unknown[]) => {
      if (!shouldEmitDevLogs()) {
        return;
      }
      emit('warn', scope, args);
    },
    error: (...args: unknown[]) => {
      emit('error', scope, args);
    },
  };
}
