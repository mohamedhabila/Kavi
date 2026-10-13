import { waitFor } from '@testing-library/react-native';

// Async queries must not give up long before jest does: under a loaded full run, a one
// second wait failed UI tests whose async work had simply not been scheduled yet.
describe('Testing Library async budget', () => {
  it('keeps waiting past the one second Testing Library default', async () => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
    }, 1_500);

    try {
      await waitFor(() => expect(settled).toBe(true));
    } finally {
      clearTimeout(timer);
    }
  });
});
