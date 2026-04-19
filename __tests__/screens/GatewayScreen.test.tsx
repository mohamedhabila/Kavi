// ---------------------------------------------------------------------------
// Tests — GatewayScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { GatewayScreen } from '../../src/screens/GatewayScreen';

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock navigation
const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate }),
  useRoute: () => ({ name: 'Gateway' }),
  useFocusEffect: jest.fn(),
}));

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      success: '#0f0',
    },
  }),
  AppPalette: {},
}));

// Mock gateway client
const mockConnect = jest.fn();
const mockOnStateChange = jest.fn();
const mockRequestPairingCode = jest.fn();
const mockListNodes = jest.fn();
const mockDisconnect = jest.fn();
const mockClient = {
  connect: mockConnect,
  onStateChange: mockOnStateChange,
  requestPairingCode: mockRequestPairingCode,
  listNodes: mockListNodes,
  disconnect: mockDisconnect,
};

const mockGetGatewayClient = jest.fn();
const mockCreateGatewayClient = jest.fn();
const mockDisconnectGateway = jest.fn();
const mockSetClipboard = jest.fn();
const mockEmitGatewayEvent = jest.fn();
let gatewayStateChangeCallback: ((state: string) => void) | null = null;

jest.mock('../../src/services/gateway/client', () => ({
  getGatewayClient: (...args: any[]) => mockGetGatewayClient(...args),
  createGatewayClient: (...args: any[]) => mockCreateGatewayClient(...args),
  disconnectGateway: (...args: any[]) => mockDisconnectGateway(...args),
}));

// Mock expo-clipboard
jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: any[]) => mockSetClipboard(...args),
}));

// Mock event bus
jest.mock('../../src/services/events/bus', () => ({
  emitGatewayEvent: (...args: any[]) => mockEmitGatewayEvent(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockOnStateChange.mockReset().mockReturnValue(jest.fn());
  mockRequestPairingCode.mockReset().mockResolvedValue('ABC-123');
  mockListNodes
    .mockReset()
    .mockResolvedValue([{ id: 'n1', name: 'DesktopNode', status: 'online' }]);
  mockDisconnect.mockReset();
  mockGetGatewayClient.mockReset().mockReturnValue(null);
  mockCreateGatewayClient.mockReset().mockImplementation(() => ({
    ...mockClient,
    onStateChange: jest.fn().mockReturnValue(jest.fn()),
  }));
  mockDisconnectGateway.mockReset();
  mockSetClipboard.mockReset().mockResolvedValue(undefined);
  mockEmitGatewayEvent.mockReset().mockResolvedValue(undefined);
});

describe('GatewayScreen', () => {
  it('renders header with title', () => {
    const { getByText } = render(<GatewayScreen />);
    expect(getByText('Gateway')).toBeTruthy();
  });

  it('shows disconnected state initially', () => {
    const { getByText } = render(<GatewayScreen />);
    expect(getByText('Disconnected')).toBeTruthy();
  });

  it('shows gateway URL input when disconnected', () => {
    const { getByPlaceholderText } = render(<GatewayScreen />);
    expect(getByPlaceholderText('wss://gateway.kavi.dev')).toBeTruthy();
  });

  it('shows connect button when disconnected', () => {
    const { getByText } = render(<GatewayScreen />);
    expect(getByText('Connect')).toBeTruthy();
  });

  it('navigates back on back button press', () => {
    const { UNSAFE_getAllByType } = render(<GatewayScreen />);
    const touchables = UNSAFE_getAllByType(require('react-native').TouchableOpacity);
    fireEvent.press(touchables[0]); // Back button
    expect(mockNavigate).toHaveBeenCalledWith('Chat');
  });

  it('allows entering gateway URL', () => {
    const { getByPlaceholderText } = render(<GatewayScreen />);
    const input = getByPlaceholderText('wss://gateway.kavi.dev');
    fireEvent.changeText(input, 'wss://my-gateway.example.com');
    // Just verifying no crash
  });

  it('shows Gateway URL label', () => {
    const { getByText } = render(<GatewayScreen />);
    expect(getByText('Gateway URL')).toBeTruthy();
  });

  it('calls createGatewayClient on connect press', () => {
    const { getByText, getByPlaceholderText } = render(<GatewayScreen />);
    const input = getByPlaceholderText('wss://gateway.kavi.dev');
    fireEvent.changeText(input, 'wss://test.example.com');
    fireEvent.press(getByText('Connect'));
    expect(mockCreateGatewayClient).toHaveBeenCalled();
  });

  it('passes the trimmed URL and latest token to createGatewayClient', () => {
    const { getByText, getByPlaceholderText } = render(<GatewayScreen />);

    fireEvent.changeText(
      getByPlaceholderText('wss://gateway.kavi.dev'),
      '  wss://test.example.com  ',
    );
    fireEvent.changeText(getByPlaceholderText('Gateway authentication token'), 'fresh-token');
    fireEvent.press(getByText('Connect'));

    expect(mockCreateGatewayClient).toHaveBeenCalledWith({
      url: 'wss://test.example.com',
      token: 'fresh-token',
    });
    expect(mockEmitGatewayEvent).toHaveBeenCalledWith('connected', {
      gatewayUrl: 'wss://test.example.com',
    });
  });

  it('shows alert when connecting with empty URL', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert');
    const { getByText } = render(<GatewayScreen />);
    fireEvent.press(getByText('Connect'));
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Please enter a gateway URL');
    alertSpy.mockRestore();
  });

  it('shows an alert when creating the gateway client fails', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockCreateGatewayClient.mockImplementationOnce(() => {
      throw new Error('gateway boom');
    });

    const { getByText, getByPlaceholderText } = render(<GatewayScreen />);
    fireEvent.changeText(getByPlaceholderText('wss://gateway.kavi.dev'), 'wss://test.example.com');
    fireEvent.press(getByText('Connect'));

    expect(mockEmitGatewayEvent).toHaveBeenCalledWith('error', {
      gatewayUrl: 'wss://test.example.com',
      error: 'gateway boom',
    });
    expect(alertSpy).toHaveBeenCalledWith('Connection Failed', 'gateway boom');
    alertSpy.mockRestore();
  });

  describe('connected state', () => {
    const renderConnectedScreen = () => {
      const rendered = render(<GatewayScreen />);
      act(() => {
        gatewayStateChangeCallback?.('connected');
      });
      return rendered;
    };

    beforeEach(() => {
      mockGetGatewayClient.mockReturnValue(mockClient);
      mockOnStateChange.mockImplementation((cb: any) => {
        gatewayStateChangeCallback = cb;
        return jest.fn();
      });
    });

    it('shows connected status label', () => {
      const { getByText } = renderConnectedScreen();
      expect(getByText('Connected')).toBeTruthy();
    });

    it('shows pairing section with request button', () => {
      const { getByText } = renderConnectedScreen();
      expect(getByText('Pairing')).toBeTruthy();
      expect(getByText('Request Pairing Code')).toBeTruthy();
    });

    it('shows disconnect button when connected', () => {
      const { getByText } = renderConnectedScreen();
      expect(getByText('Disconnect')).toBeTruthy();
    });

    it('handles disconnect press', () => {
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
        const destructive = buttons?.find((b: any) => b.style === 'destructive');
        destructive?.onPress?.();
      });
      const { getByText } = renderConnectedScreen();
      const btn = getByText('Disconnect');
      fireEvent.press(btn);
      expect(Alert.alert).toHaveBeenCalledWith('Disconnect', expect.any(String), expect.any(Array));
      expect(mockDisconnectGateway).toHaveBeenCalled();
    });

    it('cancels disconnect when cancel is pressed', () => {
      jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const { getByText } = renderConnectedScreen();
      const btn = getByText('Disconnect');
      fireEvent.press(btn);
      expect(Alert.alert).toHaveBeenCalled();
      expect(mockDisconnectGateway).not.toHaveBeenCalled();
    });

    it('requests pairing code', async () => {
      const { getByText } = renderConnectedScreen();
      await act(async () => {
        fireEvent.press(getByText('Request Pairing Code'));
      });
      expect(mockRequestPairingCode).toHaveBeenCalled();
    });

    it('renders and copies the returned pairing code', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const { getByText, getByLabelText } = renderConnectedScreen();

      await act(async () => {
        fireEvent.press(getByText('Request Pairing Code'));
      });

      expect(getByText('ABC-123')).toBeTruthy();
      fireEvent.press(getByLabelText('Copy pairing code'));

      await waitFor(() => expect(mockSetClipboard).toHaveBeenCalledWith('ABC-123'));
      expect(alertSpy).toHaveBeenCalledWith('Copied', 'Pairing code copied to clipboard');
      alertSpy.mockRestore();
    });

    it('shows an alert when requesting a pairing code fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockRequestPairingCode.mockRejectedValueOnce(new Error('pairing boom'));

      const { getByText } = renderConnectedScreen();
      await act(async () => {
        fireEvent.press(getByText('Request Pairing Code'));
      });

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Pairing Failed', 'pairing boom'));
      expect(mockEmitGatewayEvent).toHaveBeenCalledWith('error', { error: 'pairing boom' });
      alertSpy.mockRestore();
    });

    it('shows nodes section header', () => {
      const { getByText } = renderConnectedScreen();
      expect(getByText('Nodes')).toBeTruthy();
    });

    it('shows no nodes discovered initially', () => {
      const { getByText } = renderConnectedScreen();
      expect(getByText('No nodes discovered')).toBeTruthy();
    });

    it('lists nodes and emits registration events', async () => {
      const { getByLabelText, getByText } = renderConnectedScreen();

      await act(async () => {
        fireEvent.press(getByLabelText('Refresh nodes list'));
      });

      expect(getByText('DesktopNode')).toBeTruthy();
      expect(getByText('online')).toBeTruthy();
      expect(mockEmitGatewayEvent).toHaveBeenCalledWith('node_registered', { nodeId: 'n1' });
    });

    it('shows an alert when listing nodes fails', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockListNodes.mockRejectedValueOnce(new Error('nodes boom'));

      const { getByLabelText } = renderConnectedScreen();
      await act(async () => {
        fireEvent.press(getByLabelText('Refresh nodes list'));
      });

      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error', 'nodes boom'));
      alertSpy.mockRestore();
    });
  });
});
