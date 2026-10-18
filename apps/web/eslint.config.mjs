import js from '@eslint/js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**',
      'design-system/out/**',
    ],
  },
  js.configs.recommended,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // eslint-config-next 16 bundles eslint-plugin-react-hooks v7, which enables
    // the new React Compiler ruleset. The rules below are deliberately kept off:
    // our usage of these patterns is safe and idiomatic, so enforcing them would
    // require widespread inline disables rather than improving the code. The
    // classic rules-of-hooks / exhaustive-deps checks remain active, and the
    // other React Compiler rules are enforced.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/incompatible-library': 'off',
      // A leading underscore marks an intentionally unused binding, matching
      // the data-worker config.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];

export default eslintConfig;
