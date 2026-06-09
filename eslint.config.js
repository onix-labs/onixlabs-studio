// @ts-check
// ESLint flat config — enforces the baseline rules from docs/code-quality.md.
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    // Build output and non-source artefacts.
    ignores: ['dist/**', 'dist-electron/**', 'release/**', '.angular/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      ...angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    processor: angular.processInlineTemplates,
    rules: {
      // Rule 2 — explicit member accessibility on every class member.
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit' }],

      // Rule 3 — explicit, total type annotations; no `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: false },
      ],
      '@typescript-eslint/typedef': [
        'error',
        {
          variableDeclaration: true,
          parameter: true,
          memberVariableDeclaration: true,
          propertyDeclaration: true,
        },
      ],

      // No floating promises (see Functions & Methods / Testing).
      '@typescript-eslint/no-floating-promises': 'error',

      // Angular selector conventions.
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
);
