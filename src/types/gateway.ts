export type GatewayConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface GatewayConfig {
  url: string;
  token: string;
  deviceName?: string;
  reconnect?: boolean;
  maxReconnectDelay?: number;
}

export interface GatewayCapability {
  name: string;
  description?: string;
  version?: string;
}

export interface GatewayMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: any };
}
