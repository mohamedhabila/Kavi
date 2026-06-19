import { fireEvent, render } from '@testing-library/react-native';
import { AudioAttachmentCard } from '../../src/components/chat/AudioAttachmentCard';
import type { Attachment } from '../../src/types/attachment';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      subtleBorder: '#333',
      codeBackground: '#111',
      surfaceAlt: '#222',
      text: '#fff',
      textSecondary: '#aaa',
      primary: '#0f0',
      onPrimary: '#fff',
      border: '#444',
    },
  }),
  AppPalette: {},
}));

const expoAudio = jest.requireMock('expo-audio') as {
  useAudioPlayer: jest.Mock;
  __setAudioStatus: (nextStatus: Record<string, unknown>) => void;
  __resetAudioMocks: () => void;
};

const makeAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'audio-1',
  type: 'audio',
  uri: 'file:///voice-note.m4a',
  name: 'voice-note.m4a',
  mimeType: 'audio/mp4',
  size: 4096,
  durationMs: 4500,
  transcript: 'Ship the release candidate tonight.',
  waveformLevels: [0.18, 0.36, 0.6, 0.44],
  ...overrides,
});

describe('AudioAttachmentCard', () => {
  beforeEach(() => {
    expoAudio.__resetAudioMocks();
  });

  it('renders the transcript and falls back to attachment duration metadata', () => {
    const { getByText } = render(<AudioAttachmentCard attachment={makeAttachment()} />);

    expect(getByText('voice-note.m4a')).toBeTruthy();
    expect(getByText('Ship the release candidate tonight.')).toBeTruthy();
    expect(getByText('0:05')).toBeTruthy();
  });

  it('plays audio when toggled from the paused state', () => {
    const { getByTestId } = render(<AudioAttachmentCard attachment={makeAttachment()} />);
    const player = expoAudio.useAudioPlayer.mock.results[0]?.value;

    fireEvent.press(getByTestId('audio-attachment-toggle-audio-1'));

    expect(player.play).toHaveBeenCalled();
  });

  it('pauses audio when toggled from the playing state', () => {
    expoAudio.__setAudioStatus({ playing: true, duration: 8, currentTime: 2.5 });

    const { getByTestId } = render(<AudioAttachmentCard attachment={makeAttachment()} />);
    const player = expoAudio.useAudioPlayer.mock.results[0]?.value;

    fireEvent.press(getByTestId('audio-attachment-toggle-audio-1'));

    expect(player.pause).toHaveBeenCalled();
  });
});
