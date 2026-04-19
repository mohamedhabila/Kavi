import { useEffect } from 'react';

import { getSecure } from '../services/storage/SecureStorage';

type UseSecureDraftValueOptions = {
  enabled: boolean;
  secureRef?: string;
  setValue: (value: string) => void;
};

export function useSecureDraftValue({
  enabled,
  secureRef,
  setValue,
}: UseSecureDraftValueOptions): void {
  useEffect(() => {
    let cancelled = false;

    if (!enabled || !secureRef) {
      setValue('');
      return undefined;
    }

    void getSecure(secureRef).then((value) => {
      if (!cancelled) {
        setValue(value || '');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, secureRef, setValue]);
}
