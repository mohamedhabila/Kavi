import type { MutableRefObject } from 'react';
import { renderHook } from '@testing-library/react-native';

import { useSettingsSectionNavigation } from '../../src/screens/settings/useSettingsSectionNavigation';

describe('useSettingsSectionNavigation', () => {
  it('resets the main scroll position when the Settings destination changes', () => {
    const scrollTo = jest.fn();
    const animationFrame = jest
      .spyOn(global, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    const { result, rerender } = renderHook(
      ({ mainContentKey }) =>
        useSettingsSectionNavigation({
          mainContentKey,
          section: 'main',
        }),
      { initialProps: { mainContentKey: 'home' } },
    );
    (result.current.mainScrollRef as MutableRefObject<any>).current = { scrollTo };

    rerender({ mainContentKey: 'connections' });

    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    animationFrame.mockRestore();
  });
});
