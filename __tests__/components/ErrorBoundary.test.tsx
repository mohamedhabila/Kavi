import React, { useState } from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';

function MaybeCrash({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('boom');
  }

  return <Text>Healthy child</Text>;
}

describe('ErrorBoundary', () => {
  it('renders its children when no error is thrown', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <Text>Healthy child</Text>
      </ErrorBoundary>,
    );

    expect(getByText('Healthy child')).toBeTruthy();
  });

  it('renders the fallback UI, logs the error, and retries successfully', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onRetry = jest.fn();

    function Wrapper() {
      const [shouldThrow, setShouldThrow] = useState(true);

      return (
        <ErrorBoundary
          fallbackTitle="Custom title"
          fallbackMessage="Custom message"
          onRetry={() => {
            onRetry();
            setShouldThrow(false);
          }}
        >
          <MaybeCrash shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );
    }

    try {
      const { getByText, queryByText } = render(<Wrapper />);

      expect(getByText('Custom title')).toBeTruthy();
      expect(getByText('Custom message')).toBeTruthy();
      expect(getByText('boom')).toBeTruthy();
      expect(warnSpy).toHaveBeenCalledWith('[ErrorBoundary]', 'boom', expect.any(String));

      fireEvent.press(getByText('Retry'));

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(getByText('Healthy child')).toBeTruthy();
      expect(queryByText('Custom title')).toBeNull();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
