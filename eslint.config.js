import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/next-env.d.ts',
      // Generated from the API's OpenAPI document by `npm run api:types`.
      'apps/web/src/lib/api-types.ts',
      '.agents/**',
      '.codex/**',
      'plans/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      '@next/next': nextPlugin,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    settings: {
      next: { rootDir: 'apps/web' },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Source vendored from the shadcn, Dice UI and AI Elements registries. It is kept as installed
    // so registry updates stay diffable; React Compiler-style hook rules are not enforced on it.
    files: [
      'apps/web/src/components/ui/**',
      'apps/web/src/components/ai-elements/**',
      'apps/web/src/hooks/use-mobile.ts',
      'apps/web/src/lib/compose-refs.ts',
    ],
    rules: Object.fromEntries(Object.keys(reactHooks.configs.recommended.rules).map((rule) => [rule, 'off'])),
  },
);
