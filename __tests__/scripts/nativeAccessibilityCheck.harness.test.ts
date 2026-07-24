const path = require('path');

const {
  scanNativeAccessibilityDirectory,
  scanNativeAccessibilitySource,
} = require('../../scripts/lib/nativeAccessibilityCheck');

describe('native accessibility check harness', () => {
  it('accepts explicitly named native controls', () => {
    const result = scanNativeAccessibilitySource(`
      import { Pressable, Switch, TextInput } from 'react-native';
      export const Example = () => <>
        <Pressable accessibilityRole="button" accessibilityLabel="Save" />
        <TextInput accessibilityLabel="Message" />
        <Switch accessibilityLabel="Enabled" />
      </>;
    `);

    expect(result.issues).toEqual([]);
    expect(result.controlsScanned).toBe(3);
  });

  it('reports every missing or empty required attribute', () => {
    const result = scanNativeAccessibilitySource(`
      import { Pressable, Switch, TextInput, TouchableOpacity } from 'react-native';
      export const Example = () => <>
        <TouchableOpacity />
        <Pressable accessibilityLabel="Open" />
        <TextInput accessibilityLabel="" />
        <Switch />
      </>;
    `);

    expect(result.issues.map((issue: any) => [issue.componentName, issue.missing])).toEqual([
      ['TouchableOpacity', ['accessibilityRole', 'accessibilityLabel']],
      ['Pressable', ['accessibilityRole']],
      ['TextInput', ['accessibilityLabel']],
      ['Switch', ['accessibilityLabel']],
    ]);
  });

  it('resolves aliased and namespaced React Native controls', () => {
    const result = scanNativeAccessibilitySource(`
      import * as Native from 'react-native';
      import { Pressable as NativePressable } from 'react-native';
      export const Example = () => <>
        <NativePressable accessibilityLabel="Open" />
        <Native.Switch />
      </>;
    `);

    expect(result.issues.map((issue: any) => issue.componentName)).toEqual(['Pressable', 'Switch']);
  });

  it('allows an explicit decorative touch-wrapper opt-out but not form controls', () => {
    const result = scanNativeAccessibilitySource(`
      import { TextInput, TouchableWithoutFeedback } from 'react-native';
      export const Example = () => <>
        <TouchableWithoutFeedback accessible={false} />
        <TextInput accessible={false} />
      </>;
    `);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      componentName: 'TextInput',
      missing: ['accessibilityLabel'],
    });
  });

  it('keeps the production source at zero accessibility findings', () => {
    const result = scanNativeAccessibilityDirectory(path.resolve(__dirname, '../../src'));
    expect(result.issues).toEqual([]);
    expect(result.controlsScanned).toBeGreaterThan(0);
  });
});
