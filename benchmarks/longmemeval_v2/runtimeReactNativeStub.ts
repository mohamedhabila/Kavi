const emptySubscription = {
  remove: () => {},
};

export const Platform = {
  OS: 'node',
  select<T>(values: Record<string, T> | undefined): T | undefined {
    return values?.node ?? values?.default;
  },
};

export const NativeModules = {};

export const TurboModuleRegistry = {
  get: () => null,
  getEnforcing: () => ({}),
};

export class NativeEventEmitter {
  addListener(): typeof emptySubscription {
    return emptySubscription;
  }

  removeAllListeners(): void {}

  removeSubscription(): void {}
}

export const DeviceEventEmitter = {
  addListener: () => emptySubscription,
  removeAllListeners: () => {},
};

export const AppState = {
  currentState: 'active',
  addEventListener: () => emptySubscription,
};

export const Linking = {
  canOpenURL: async () => false,
  openURL: async () => {},
};

export const InteractionManager = {
  runAfterInteractions: (callback: () => void) => {
    callback();
    return { cancel: () => {} };
  },
};

export function processColor(value: unknown): unknown {
  return value;
}

export default {
  AppState,
  DeviceEventEmitter,
  InteractionManager,
  Linking,
  NativeEventEmitter,
  NativeModules,
  Platform,
  TurboModuleRegistry,
  processColor,
};
