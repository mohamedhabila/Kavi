// ---------------------------------------------------------------------------
// Tests — MigrationProgressBanner
// ---------------------------------------------------------------------------

import { render, fireEvent } from '@testing-library/react-native';
import { MigrationProgressBanner } from '../../src/components/MigrationProgressBanner';
import type { AppPalette } from '../../src/theme/useAppTheme';

jest.mock('../../src/services/memory/migrationSeedPass', () => {
  const states: any[] = [];
  return {
    listMigrationStates: jest.fn(() => states),
    __setMigrationStates: (rows: any[]) => {
      states.length = 0;
      states.push(...rows);
    },
  };
});

const seed = require('../../src/services/memory/migrationSeedPass') as {
  __setMigrationStates: (rows: any[]) => void;
};

const colors = {
  background: '#000',
  surface: '#111',
  text: '#fff',
  textSecondary: '#aaa',
  textTertiary: '#888',
  border: '#222',
  primary: '#5cf',
  onPrimary: '#000',
} as unknown as AppPalette;

describe('MigrationProgressBanner', () => {
  beforeEach(() => seed.__setMigrationStates([]));

  function statesFor(pending: number, completed: number): any[] {
    const rows: any[] = [];
    for (let i = 0; i < pending; i++) {
      rows.push({ conversationId: `p${i}`, status: 'pending' });
    }
    for (let i = 0; i < completed; i++) {
      rows.push({ conversationId: `c${i}`, status: 'completed' });
    }
    return rows;
  }

  it('renders nothing when there are no migration states', () => {
    seed.__setMigrationStates([]);
    const { queryByTestId } = render(<MigrationProgressBanner colors={colors} />);
    expect(queryByTestId('migration-progress-banner')).toBeNull();
  });

  it('renders progress when pending > 0', () => {
    seed.__setMigrationStates(statesFor(2, 3));
    const { getByTestId, getByText } = render(<MigrationProgressBanner colors={colors} />);
    expect(getByTestId('migration-progress-banner')).toBeTruthy();
    expect(getByText(/3.*5/)).toBeTruthy();
  });

  it('hides when dismissed', () => {
    seed.__setMigrationStates(statesFor(1, 2));
    const { getByTestId, queryByTestId } = render(<MigrationProgressBanner colors={colors} />);
    fireEvent.press(getByTestId('migration-progress-banner-dismiss'));
    expect(queryByTestId('migration-progress-banner')).toBeNull();
  });

  it('shows the complete copy when pending hits zero', () => {
    seed.__setMigrationStates(statesFor(0, 4));
    const { getByTestId } = render(<MigrationProgressBanner colors={colors} />);
    expect(getByTestId('migration-progress-banner')).toBeTruthy();
  });
});
