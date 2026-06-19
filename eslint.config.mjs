import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['**/*.{js,mjs,cjs,ts,tsx}'];

export default tseslint.config(
  {
    ignores: [
      '.private/**',
      '.tmp/**',
      'android/**',
      'assets/editor/**',
      'coverage/**',
      'ios/Pods/**',
      'ios/build/**',
      'jest_dx/**',
      'node-compile-cache/**',
      'node_modules/**',
      'patches/**',
    ],
  },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2024,
        ...globals.node,
        __DEV__: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['__tests__/**/*.{js,ts,tsx}', 'jest.setup.ts'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
);
