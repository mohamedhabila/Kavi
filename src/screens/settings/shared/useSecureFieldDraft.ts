import { useCallback, useMemo } from 'react';

type SecureFieldSetter = (value: string) => void;

export function useSecureFieldDraft(value: string, setValue: SecureFieldSetter) {
  const clearValue = useCallback(() => {
    setValue('');
  }, [setValue]);

  return useMemo(
    () => ({
      value,
      setValue,
      clearValue,
    }),
    [clearValue, setValue, value],
  );
}
