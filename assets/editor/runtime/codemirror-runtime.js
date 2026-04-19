import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { css } from '@codemirror/lang-css';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';

export function createCodeMirrorModules() {
  return {
    Compartment,
    EditorState,
    EditorView,
    basicSetup,
    css,
    html,
    indentWithTab,
    javascript,
    json,
    keymap,
    markdown,
    oneDark,
    python,
    rust,
    sql,
    xml,
    yaml,
  };
}