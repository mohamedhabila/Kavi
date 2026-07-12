import { NativeModule, requireNativeModule } from 'expo';
import type {
  ConnectVerifiedRequest,
  DisconnectRequest,
  DiscoverHostKeyRequest,
  ExecRequest,
} from './KaviSsh.types';
import { SSH_NATIVE_MODULE_NAME } from './KaviSsh.types';

declare class NativeKaviSshModule extends NativeModule {
  discoverHostKey(request: DiscoverHostKeyRequest): Promise<unknown>;
  connectVerified(request: ConnectVerifiedRequest): Promise<unknown>;
  exec(request: ExecRequest): Promise<unknown>;
  disconnect(request: DisconnectRequest): Promise<unknown>;
}

export default requireNativeModule<NativeKaviSshModule>(SSH_NATIVE_MODULE_NAME);
