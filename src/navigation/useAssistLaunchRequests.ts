import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { isAssistLaunchUrl } from '../services/assistant/assistantRole';
import { createLogger } from '../utils/logger';

const logger = createLogger('AssistLaunch');

/**
 * Calls `onAssistLaunch` when the system opened Kavi as the phone's assistant: once for the
 * launch that started the app, and again for every assist request while it runs.
 */
export function useAssistLaunchRequests(onAssistLaunch: () => void): void {
  const onAssistLaunchRef = useRef(onAssistLaunch);
  onAssistLaunchRef.current = onAssistLaunch;

  useEffect(() => {
    let active = true;
    Linking.getInitialURL()
      .then((url) => {
        if (active && isAssistLaunchUrl(url)) onAssistLaunchRef.current();
      })
      .catch((error: unknown) => {
        logger.warn('Could not read the launch link.', { error: String(error) });
      });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (isAssistLaunchUrl(url)) onAssistLaunchRef.current();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
}
