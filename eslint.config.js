import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Globals for the plain-JavaScript build scripts.
 *
 * The TypeScript sources get these from `@types/node`, which `no-undef` cannot see. The
 * `.mjs` tooling has no such declaration, so the handful it actually uses is listed
 * here rather than turning the rule off — an undefined name in a build script is still
 * worth catching.
 */
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  WebSocket: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  URL: 'readonly',
  Buffer: 'readonly',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'data/**',
      '**/*.d.ts',
      // Build output: `.tsc` is what the desktop package's typecheck emits and never
      // runs, `.smoke` is the bundle the desktop smoke test builds.
      '**/.tsc/**',
      '**/.smoke/**',
      '**/release/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: { globals: nodeGlobals },
  },
);
