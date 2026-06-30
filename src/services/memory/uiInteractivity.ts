interface InteractiveNodeLike {
  role: string;
  name: string | null;
  attributes: string[];
}

export const UI_ACTIONABLE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'menuitem',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

const NON_CONTROL_CLICKABLE_ROLES = new Set(['labeltext', 'statictext']);

export function isInteractiveUiNode(node: InteractiveNodeLike): boolean {
  const role = node.role.toLocaleLowerCase();
  return (
    UI_ACTIONABLE_ROLES.has(role) ||
    Boolean(
      node.name &&
        !NON_CONTROL_CLICKABLE_ROLES.has(role) &&
        node.attributes.some((attribute) => attribute.trim() === 'clickable'),
    )
  );
}
