import {
  compactUiInventory,
  extractUiStateSummary,
  parseAccessibilityTree,
} from '../../../src/services/memory/uiState';

describe('UI state popup roles', () => {
  it('preserves popup option roles alongside option labels', () => {
    const nodes = parseAccessibilityTree(
      [
        "[0] RootWebArea 'test', visible",
        "\t[1] button 'qmenu-current', clickable, visible, hasPopup='menu', expanded=True",
        "\t\t[2] list '', visible",
        "\t\t\t[3] listitem '', visible",
        "\t\t\t\t[4] link 'qmenu-alpha', clickable, visible",
        "\t\t\t[5] listitem '', visible",
        "\t\t\t\t[6] link 'qmenu-beta', clickable, visible",
      ].join('\n'),
    );

    const inventory = compactUiInventory(extractUiStateSummary(nodes));
    expect(inventory.popupControls).toEqual([
      expect.objectContaining({
        role: 'button',
        name: 'qmenu-current',
        options: ['qmenu-alpha', 'qmenu-beta'],
        optionRoles: ['link'],
      }),
    ]);
  });

  it('groups sibling tabs as structural options', () => {
    const nodes = parseAccessibilityTree(
      [
        "[0] RootWebArea 'test', visible",
        "\t[1] tablist '', visible",
        "\t\t[2] tab 'qtab-alpha', clickable, visible, selected=True, expanded=True",
        "\t\t\t[3] link 'qtab-alpha', clickable, visible",
        "\t\t[4] tab 'qtab-beta', clickable, visible, selected=False, expanded=False",
        "\t\t\t[5] link 'qtab-beta', clickable, visible",
        "\t\t[6] tab 'qtab-gamma', clickable, visible, selected=False, expanded=False",
        "\t\t\t[7] link 'qtab-gamma', clickable, visible",
      ].join('\n'),
    );

    const inventory = compactUiInventory(extractUiStateSummary(nodes));
    expect(inventory.popupControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tab',
          name: 'qtab-alpha',
          options: ['qtab-alpha', 'qtab-beta', 'qtab-gamma'],
          optionRoles: ['tab'],
        }),
      ]),
    );
  });
});
