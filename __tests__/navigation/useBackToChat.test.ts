import { act, renderHook } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import { useBackToChat } from '../../src/navigation/useBackToChat';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockCanGoBack = jest.fn();
let mockCurrentRouteName = 'Voice';
let mockCapturedFocusEffect: (() => void | (() => void)) | undefined;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: mockCanGoBack,
  }),
  useRoute: () => ({ name: mockCurrentRouteName }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockCapturedFocusEffect = callback;
  },
}));

describe('useBackToChat', () => {
  let removeListener: jest.Mock;
  let backHandlerCallback: (() => boolean) | undefined;

  beforeEach(() => {
    mockNavigate.mockReset();
    mockGoBack.mockReset();
    mockCanGoBack.mockReset();
    mockCurrentRouteName = 'Voice';
    mockCapturedFocusEffect = undefined;
    removeListener = jest.fn();

    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback: any) => {
      backHandlerCallback = callback;
      return { remove: removeListener } as any;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('navigates to chat when invoked from another screen', () => {
    const { result } = renderHook(() => useBackToChat());

    act(() => {
      result.current();
    });

    expect(mockNavigate).toHaveBeenCalledWith('Chat');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('goes back when already on chat and navigation can go back', () => {
    mockCurrentRouteName = 'Chat';
    mockCanGoBack.mockReturnValue(true);

    const { result } = renderHook(() => useBackToChat());

    act(() => {
      result.current();
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('subscribes to hardware back events and redirects non-chat screens to chat', () => {
    renderHook(() => useBackToChat());

    let cleanup: void | (() => void);
    act(() => {
      cleanup = mockCapturedFocusEffect?.();
    });

    expect(backHandlerCallback?.()).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('Chat');

    act(() => {
      cleanup?.();
    });

    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it('lets the native back handler continue when already on chat', () => {
    mockCurrentRouteName = 'Chat';

    renderHook(() => useBackToChat());

    act(() => {
      mockCapturedFocusEffect?.();
    });

    expect(backHandlerCallback?.()).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('lets callers intercept navigation before leaving', () => {
    const beforeNavigate = jest.fn((continueNavigation: () => void) => continueNavigation());
    const { result } = renderHook(() => useBackToChat({ beforeNavigate }));

    act(() => {
      result.current();
    });

    expect(beforeNavigate).toHaveBeenCalledWith(expect.any(Function));
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('navigates to an explicit target route before falling back to chat', () => {
    const { result } = renderHook(() =>
      useBackToChat({
        targetRoute: {
          name: 'ConversationFiles',
          params: { conversationId: 'conv-1', initialDirectoryPath: 'src' },
        },
      }),
    );

    act(() => {
      result.current();
    });

    expect(mockNavigate).toHaveBeenCalledWith('ConversationFiles', {
      conversationId: 'conv-1',
      initialDirectoryPath: 'src',
    });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('uses the navigation interceptor for hardware back presses too', () => {
    const beforeNavigate = jest.fn((continueNavigation: () => void) => continueNavigation());

    renderHook(() => useBackToChat({ beforeNavigate }));

    act(() => {
      mockCapturedFocusEffect?.();
    });

    expect(backHandlerCallback?.()).toBe(true);
    expect(beforeNavigate).toHaveBeenCalledWith(expect.any(Function));
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('routes hardware back presses to the explicit target route too', () => {
    renderHook(() =>
      useBackToChat({
        targetRoute: {
          name: 'ConversationFiles',
          params: { conversationId: 'conv-1' },
        },
      }),
    );

    act(() => {
      mockCapturedFocusEffect?.();
    });

    expect(backHandlerCallback?.()).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('ConversationFiles', { conversationId: 'conv-1' });
  });
});
