// ---------------------------------------------------------------------------
// Tests — DiffViewer Component
// ---------------------------------------------------------------------------

import { render } from '@testing-library/react-native';
import { DiffViewer, InlineDiff } from '../../src/components/editor/DiffViewer';

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      panel: '#111',
      border: '#333',
      header: '#222',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      primarySoft: '#030',
      onPrimary: '#fff',
      danger: '#f00',
      warning: '#ff0',
    },
  }),
  AppPalette: {},
}));

describe('DiffViewer', () => {
  it('should show "No changes" when texts are identical', () => {
    const { getByText } = render(<DiffViewer oldText="hello world" newText="hello world" />);
    expect(getByText('No changes')).toBeTruthy();
  });

  it('should render the new file name in the header', () => {
    const { getByText } = render(
      <DiffViewer oldText="line1\nline2" newText="line1\nline2\nline3" newFileName="modified.ts" />,
    );
    expect(getByText('modified.ts')).toBeTruthy();
  });

  it('should show added line count in stats', () => {
    const { getByText } = render(<DiffViewer oldText="a" newText="a\nb\nc" />);
    // Stats shows +N for additions
    expect(getByText(/^\+\d+$/)).toBeTruthy();
  });

  it('should show removed line count in stats', () => {
    const { getByText } = render(<DiffViewer oldText="a\nb\nc" newText="a" />);
    expect(getByText(/^-\d+$/)).toBeTruthy();
  });

  it('should render hunk headers for multi-line diffs', () => {
    const oldText = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const newText = oldText.replace('line 10', 'modified line 10');
    const { getAllByText } = render(<DiffViewer oldText={oldText} newText={newText} />);
    // Should contain at least one hunk header (starts with @@)
    const hunkHeaders = getAllByText(/^@@/);
    expect(hunkHeaders.length).toBeGreaterThanOrEqual(1);
  });

  it('should render added lines with + prefix', () => {
    const { getAllByText } = render(<DiffViewer oldText="" newText="new line" />);
    const plusMarkers = getAllByText('+');
    expect(plusMarkers.length).toBeGreaterThan(0);
  });

  it('should render removed lines with - prefix', () => {
    const { getAllByText } = render(<DiffViewer oldText="removed line" newText="" />);
    const minusMarkers = getAllByText('-');
    expect(minusMarkers.length).toBeGreaterThan(0);
  });

  it('should respect contextLines prop', () => {
    const oldLines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const newLines = [...oldLines];
    newLines[25] = 'changed line 26';

    // With 1 context line, fewer context lines are shown
    const { toJSON: toJSON1 } = render(
      <DiffViewer oldText={oldLines.join('\n')} newText={newLines.join('\n')} contextLines={1} />,
    );

    // With 5 context lines, more context lines are shown
    const { toJSON: toJSON5 } = render(
      <DiffViewer oldText={oldLines.join('\n')} newText={newLines.join('\n')} contextLines={5} />,
    );

    // The JSON representation should differ (more nodes with more context)
    const j1 = JSON.stringify(toJSON1());
    const j5 = JSON.stringify(toJSON5());
    expect(j5.length).toBeGreaterThan(j1.length);
  });

  it('should use default file names', () => {
    const { getByText } = render(<DiffViewer oldText="a" newText="b" />);
    expect(getByText('modified')).toBeTruthy();
  });
});

describe('InlineDiff', () => {
  it('should render changed words with different styling', () => {
    const { getByText } = render(<InlineDiff oldText="hello world" newText="hello planet" />);
    // Both the removed and added text should be present
    expect(getByText('world')).toBeTruthy();
    expect(getByText('planet')).toBeTruthy();
  });

  it('should render unchanged text normally', () => {
    const { getByText } = render(<InlineDiff oldText="hello world" newText="hello world" />);
    expect(getByText('hello world')).toBeTruthy();
  });

  it('should handle empty strings', () => {
    const { toJSON } = render(<InlineDiff oldText="" newText="new content" />);
    expect(toJSON()).toBeTruthy();
  });
});
