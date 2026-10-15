import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import {
  IOS_LAUNCH_REQUEST_EVENT,
  iosLaunchRequestSource,
  parseLaunchRequestUrl,
  type LaunchRequest,
} from '../services/assistant/launchRequests';
import { createLogger } from '../utils/logger';

const logger = createLogger('LaunchRequests');

/**
 * Calls `onRequest` for each request the system opened Kavi with: the one that started the
 * app and every one while it runs. Android delivers them as kavi:// links; iOS App Intents
 * (Siri, Shortcuts, the Action button) leave them in a native slot this reads once each.
 */
export function useLaunchRequests(onRequest: (request: LaunchRequest) => void): void {
  const onRequestRef = useRef(onRequest);
  onRequestRef.current = onRequest;

  useEffect(() => {
    let active = true;
    const deliver = (url: string | null | undefined) => {
      const request = parseLaunchRequestUrl(url);
      if (active && request) onRequestRef.current(request);
    };
    const warn = (message: string) => (error: unknown) => {
      logger.warn(message, { error: String(error) });
    };

    Linking.getInitialURL().then(deliver).catch(warn('Could not read the launch link.'));
    const linkSubscription = Linking.addEventListener('url', ({ url }) => deliver(url));

    const iosSource = iosLaunchRequestSource();
    const consumeIosRequest = () => {
      iosSource?.consume().then(deliver).catch(warn('Could not read the Shortcuts request.'));
    };
    consumeIosRequest();
    const iosSubscription = iosSource?.emitter.addListener(
      IOS_LAUNCH_REQUEST_EVENT,
      consumeIosRequest,
    );

    return () => {
      active = false;
      linkSubscription.remove();
      iosSubscription?.remove();
    };
  }, []);
}
