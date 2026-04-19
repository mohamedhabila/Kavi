// ---------------------------------------------------------------------------
// Tests — SecureStorage Service
// ---------------------------------------------------------------------------

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveSecure,
  getSecure,
  deleteSecure,
  saveProviderApiKey,
  getProviderApiKey,
  deleteProviderApiKey,
  saveMcpToken,
  getMcpToken,
  deleteMcpToken,
  saveMcpOAuthSecret,
  getMcpOAuthSecret,
  deleteMcpOAuthSecret,
  saveMcpOAuthClientSecret,
  getMcpOAuthClientSecret,
  deleteMcpOAuthClientSecret,
} from '../../src/services/storage/SecureStorage';

jest.mock('expo-secure-store');
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

const mockSetItemAsync = SecureStore.setItemAsync as jest.Mock;
const mockGetItemAsync = SecureStore.getItemAsync as jest.Mock;
const mockDeleteItemAsync = SecureStore.deleteItemAsync as jest.Mock;
const mockFallbackSetItem = AsyncStorage.setItem as jest.Mock;
const mockFallbackGetItem = AsyncStorage.getItem as jest.Mock;
const mockFallbackRemoveItem = AsyncStorage.removeItem as jest.Mock;

beforeEach(() => {
  mockSetItemAsync.mockReset();
  mockGetItemAsync.mockReset();
  mockDeleteItemAsync.mockReset();
  mockFallbackSetItem.mockReset();
  mockFallbackGetItem.mockReset();
  mockFallbackRemoveItem.mockReset();
  mockSetItemAsync.mockResolvedValue(undefined);
  mockGetItemAsync.mockResolvedValue(null);
  mockDeleteItemAsync.mockResolvedValue(undefined);
  mockFallbackSetItem.mockResolvedValue(undefined);
  mockFallbackGetItem.mockResolvedValue(null);
  mockFallbackRemoveItem.mockResolvedValue(undefined);
});

describe('SecureStorage', () => {
  describe('saveSecure', () => {
    it('should save with prefixed key', async () => {
      await saveSecure('test_key', 'test_value');
      expect(mockSetItemAsync).toHaveBeenCalledWith('kavi_test_key', 'test_value');
    });

    it('falls back to AsyncStorage when SecureStore is unavailable', async () => {
      mockSetItemAsync.mockRejectedValueOnce(new Error('secure store unavailable'));

      await saveSecure('test_key', 'test_value');

      expect(mockFallbackSetItem).toHaveBeenCalledWith('@kavi_secure_test_key', 'test_value');
    });

    it('throws instead of using AsyncStorage in production', async () => {
      const previousWorkerId = process.env.JEST_WORKER_ID;
      const previousNodeEnv = process.env.NODE_ENV;
      const previousDevFlag = (globalThis as { __DEV__?: boolean }).__DEV__;

      delete process.env.JEST_WORKER_ID;
      process.env.NODE_ENV = 'production';
      (globalThis as { __DEV__?: boolean }).__DEV__ = false;
      mockSetItemAsync.mockRejectedValueOnce(new Error('secure store unavailable'));

      await expect(saveSecure('test_key', 'test_value')).rejects.toThrow(
        'secure store unavailable',
      );
      expect(mockFallbackSetItem).not.toHaveBeenCalled();

      process.env.JEST_WORKER_ID = previousWorkerId;
      process.env.NODE_ENV = previousNodeEnv;
      (globalThis as { __DEV__?: boolean }).__DEV__ = previousDevFlag;
    });
  });

  describe('getSecure', () => {
    it('should get with prefixed key', async () => {
      mockGetItemAsync.mockResolvedValue('stored_value');
      const result = await getSecure('test_key');
      expect(mockGetItemAsync).toHaveBeenCalledWith('kavi_test_key');
      expect(result).toBe('stored_value');
    });

    it('should return null for missing keys', async () => {
      mockGetItemAsync.mockResolvedValue(null);
      const result = await getSecure('missing_key');
      expect(result).toBeNull();
    });

    it('falls back to AsyncStorage when SecureStore throws', async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error('secure store unavailable'));
      mockFallbackGetItem.mockResolvedValueOnce('fallback-value');

      await expect(getSecure('test_key')).resolves.toBe('fallback-value');
      expect(mockFallbackGetItem).toHaveBeenCalledWith('@kavi_secure_test_key');
    });

    it('falls back to AsyncStorage when SecureStore returns null', async () => {
      mockGetItemAsync.mockResolvedValueOnce(null);
      mockFallbackGetItem.mockResolvedValueOnce('fallback-value');

      await expect(getSecure('test_key')).resolves.toBe('fallback-value');
    });

    it('does not read the AsyncStorage fallback in production', async () => {
      const previousWorkerId = process.env.JEST_WORKER_ID;
      const previousNodeEnv = process.env.NODE_ENV;
      const previousDevFlag = (globalThis as { __DEV__?: boolean }).__DEV__;

      delete process.env.JEST_WORKER_ID;
      process.env.NODE_ENV = 'production';
      (globalThis as { __DEV__?: boolean }).__DEV__ = false;
      mockGetItemAsync.mockResolvedValueOnce(null);
      mockFallbackGetItem.mockResolvedValueOnce('fallback-value');

      await expect(getSecure('test_key')).resolves.toBeNull();
      expect(mockFallbackGetItem).not.toHaveBeenCalled();

      process.env.JEST_WORKER_ID = previousWorkerId;
      process.env.NODE_ENV = previousNodeEnv;
      (globalThis as { __DEV__?: boolean }).__DEV__ = previousDevFlag;
    });

    it('returns null when both SecureStore and fallback storage fail', async () => {
      mockGetItemAsync.mockRejectedValueOnce(new Error('secure store unavailable'));
      mockFallbackGetItem.mockRejectedValueOnce(new Error('fallback unavailable'));

      await expect(getSecure('test_key')).resolves.toBeNull();
    });
  });

  describe('deleteSecure', () => {
    it('should delete with prefixed key', async () => {
      await deleteSecure('test_key');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('kavi_test_key');
    });

    it('always clears the fallback key even when SecureStore delete fails', async () => {
      mockDeleteItemAsync.mockRejectedValueOnce(new Error('secure store unavailable'));

      await deleteSecure('test_key');

      expect(mockFallbackRemoveItem).toHaveBeenCalledWith('@kavi_secure_test_key');
    });
  });

  describe('Provider API Key helpers', () => {
    it('saveProviderApiKey should save with correct key pattern', async () => {
      await saveProviderApiKey('provider1', 'sk-xxx');
      expect(mockSetItemAsync).toHaveBeenCalledWith('kavi_provider_key_provider1', 'sk-xxx');
    });

    it('getProviderApiKey should get with correct key pattern', async () => {
      mockGetItemAsync.mockResolvedValue('sk-xxx');
      const result = await getProviderApiKey('provider1');
      expect(mockGetItemAsync).toHaveBeenCalledWith('kavi_provider_key_provider1');
      expect(result).toBe('sk-xxx');
    });

    it('deleteProviderApiKey should delete with correct key pattern', async () => {
      await deleteProviderApiKey('provider1');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('kavi_provider_key_provider1');
    });
  });

  describe('MCP Token helpers', () => {
    it('saveMcpToken should save with correct key pattern', async () => {
      await saveMcpToken('server1', 'token123');
      expect(mockSetItemAsync).toHaveBeenCalledWith('kavi_mcp_token_server1', 'token123');
    });

    it('getMcpToken should get with correct key pattern', async () => {
      mockGetItemAsync.mockResolvedValue('token123');
      const result = await getMcpToken('server1');
      expect(mockGetItemAsync).toHaveBeenCalledWith('kavi_mcp_token_server1');
      expect(result).toBe('token123');
    });

    it('deleteMcpToken should delete with correct key pattern', async () => {
      await deleteMcpToken('server1');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('kavi_mcp_token_server1');
    });
  });

  describe('MCP OAuth secret helpers', () => {
    it('reads and writes OAuth secret keys with the expected prefix', async () => {
      await saveMcpOAuthSecret('server1', 'secret-123');
      expect(mockSetItemAsync).toHaveBeenCalledWith('kavi_mcp_oauth_secret_server1', 'secret-123');

      mockGetItemAsync.mockResolvedValueOnce('secret-123');
      await expect(getMcpOAuthSecret('server1')).resolves.toBe('secret-123');

      await deleteMcpOAuthSecret('server1');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('kavi_mcp_oauth_secret_server1');
    });
  });

  describe('MCP OAuth client secret helpers', () => {
    it('reads and writes OAuth client secret keys with the expected prefix', async () => {
      await saveMcpOAuthClientSecret('server1', 'client-secret-123');
      expect(mockSetItemAsync).toHaveBeenCalledWith(
        'kavi_mcp_oauth_client_secret_server1',
        'client-secret-123',
      );

      mockGetItemAsync.mockResolvedValueOnce('client-secret-123');
      await expect(getMcpOAuthClientSecret('server1')).resolves.toBe('client-secret-123');

      await deleteMcpOAuthClientSecret('server1');
      expect(mockDeleteItemAsync).toHaveBeenCalledWith('kavi_mcp_oauth_client_secret_server1');
    });
  });
});
