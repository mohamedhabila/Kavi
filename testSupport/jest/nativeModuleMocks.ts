jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(true),
  getStringAsync: jest.fn().mockResolvedValue(''),
}));

jest.mock('expo/fetch', () => ({
  fetch: (input: RequestInfo | URL, init?: RequestInit) => global.fetch(input, init),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn().mockResolvedValue({ type: 'cancel' }),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn().mockResolvedValue('QUFBQQ=='),
  releaseCapture: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverAuthorizationServerMetadata: jest.fn(),
  discoverOAuthProtectedResourceMetadata: jest.fn(),
  exchangeAuthorization: jest.fn(),
  refreshAuthorization: jest.fn(),
  registerClient: jest.fn(),
  startAuthorization: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('notification-id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationResponseReceivedListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
  DEFAULT_ACTION_IDENTIFIER: 'expo.notifications.actions.DEFAULT',
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
}));

jest.mock('expo-audio', () => {
  const mockPlayer = {
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    remove: jest.fn(),
  };

  const defaultStatus = {
    currentTime: 0,
    didJustFinish: false,
    duration: 0,
    isBuffering: false,
    isLoaded: true,
    playing: false,
  };

  let currentStatus = { ...defaultStatus };

  return {
    useAudioPlayer: jest.fn(() => mockPlayer),
    useAudioPlayerStatus: jest.fn(() => currentStatus),
    createAudioPlayer: jest.fn(() => ({
      ...mockPlayer,
      addListener: jest.fn(),
    })),
    AudioModule: {
      AudioRecorder: jest.fn().mockImplementation(() => ({
        prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
        record: jest.fn(),
        stop: jest.fn().mockResolvedValue(undefined),
        getStatus: jest.fn().mockReturnValue({
          canRecord: true,
          isRecording: true,
          durationMillis: 0,
          mediaServicesDidReset: false,
          metering: -18,
          url: 'file:///mock/cache/recording.m4a',
        }),
        uri: 'file:///mock/cache/recording.m4a',
      })),
      requestRecordingPermissionsAsync: jest
        .fn()
        .mockResolvedValue({ granted: true, status: 'granted' }),
    },
    RecordingPresets: {
      HIGH_QUALITY: {},
    },
    requestRecordingPermissionsAsync: jest
      .fn()
      .mockResolvedValue({ granted: true, status: 'granted' }),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    useAudioRecorder: jest.fn(),
    useAudioRecorderState: jest.fn(),
    __setAudioStatus: (nextStatus: Record<string, unknown>) => {
      currentStatus = { ...currentStatus, ...nextStatus };
    },
    __resetAudioMocks: () => {
      currentStatus = { ...defaultStatus };
      mockPlayer.play.mockReset();
      mockPlayer.pause.mockReset();
      mockPlayer.seekTo.mockReset();
      mockPlayer.remove.mockReset();
    },
  };
});
