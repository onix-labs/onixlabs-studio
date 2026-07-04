// @ts-check
// ESLint flat config — enforces the baseline rules from docs/code-quality.md.
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

// INV2 (docs/agents.md §2) — feature-isolation boundary. A feature may import only
// @shared/* and its own @features/<self>/*, never a sibling feature; deleting a
// feature folder must remove the feature cleanly. Promote any shared surface to
// @shared rather than cross-importing. One flat-config block is generated per feature.
const FEATURES = [
  'agent',
  'code',
  'markdown',
  'repository',
  'settings',
  'terminal',
  'welcome',
  'workspace',
];

const featureBoundaries = FEATURES.map((self) => {
  const siblings = FEATURES.filter((feature) => feature !== self);
  const group = siblings.flatMap((feature) => [
    `@features/${feature}`,
    `@features/${feature}/*`,
    `@features/${feature}/**`,
  ]);
  return {
    files: [`src/features/${self}/**/*.ts`],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group,
              message: `Cross-feature import banned (INV2, docs/agents.md §2): feature '${self}' must import only @shared/* and its own @features/${self}/*, never a sibling feature. Promote the shared surface to @shared.`,
            },
          ],
        },
      ],
    },
  };
});

module.exports = tseslint.config(
  {
    // Build output, generated reports, and vendored reference material under resources/.
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'coverage/**',
      '.angular/**',
      'node_modules/**',
      'resources/**',
    ],
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
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: false }],
      '@typescript-eslint/typedef': [
        'error',
        {
          variableDeclaration: true,
          parameter: true,
          memberVariableDeclaration: true,
          propertyDeclaration: true,
        },
      ],
      // Rule 3 mandates explicit annotations even where inferable, so the
      // stylistic preset's no-inferrable-types rule (which forbids them) is
      // disabled — it directly contradicts the typedef rule above.
      '@typescript-eslint/no-inferrable-types': 'off',

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

  // INV2 boundary enforcement — a feature may not import a sibling feature (generated above).
  ...featureBoundaries,

  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);
