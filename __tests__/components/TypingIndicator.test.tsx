// ---------------------------------------------------------------------------
// Tests for TypingIndicator component
// ---------------------------------------------------------------------------

import React from 'react';
import { render } from '@testing-library/react-native';
import TypingIndicator from '../../src/components/chat/TypingIndicator';

describe('TypingIndicator', () => {
  it('renders three dots', () => {
    const { toJSON } = render(<TypingIndicator />);
    const tree = toJSON() as any;

    // Container with 3 Animated.View children
    expect(tree.children).toHaveLength(3);
  });

  it('has accessibility label', () => {
    const { getByLabelText } = render(<TypingIndicator />);
    expect(getByLabelText('Assistant is typing')).toBeTruthy();
  });

  it('uses default color when no prop', () => {
    const { toJSON } = render(<TypingIndicator />);
    const tree = toJSON() as any;

    // Each dot should have the default color
    for (const child of tree.children) {
      const flatStyle = Array.isArray(child.props.style)
        ? Object.assign({}, ...child.props.style)
        : child.props.style;
      expect(flatStyle.backgroundColor).toBe('#e94560');
    }
  });

  it('accepts custom color prop', () => {
    const { toJSON } = render(<TypingIndicator color="#00ff00" />);
    const tree = toJSON() as any;

    for (const child of tree.children) {
      const flatStyle = Array.isArray(child.props.style)
        ? Object.assign({}, ...child.props.style)
        : child.props.style;
      expect(flatStyle.backgroundColor).toBe('#00ff00');
    }
  });

  it('unmounts without error', () => {
    const { unmount } = render(<TypingIndicator />);
    expect(() => unmount()).not.toThrow();
  });
});
