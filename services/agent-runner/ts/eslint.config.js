import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

const layerRestrictions = (...groups) => [
  'error',
  {
    patterns: groups.map((group) => ({
      group: [`**/${group}/**`],
      message: `This layer must not import from ${group}.`,
    })),
  },
]

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': layerRestrictions(
        'harness',
        'provider',
        'adapter',
        'transport',
        'infrastructure',
      ),
    },
  },
  {
    files: ['src/harness/**/*.ts'],
    rules: {
      'no-restricted-imports': layerRestrictions(
        'provider',
        'adapter',
        'transport',
        'infrastructure',
      ),
    },
  },
  {
    files: ['src/provider/**/*.ts'],
    rules: {
      'no-restricted-imports': layerRestrictions(
        'harness',
        'adapter',
        'transport',
        'infrastructure',
      ),
    },
  },
  {
    files: ['src/adapter/**/*.ts'],
    rules: {
      'no-restricted-imports': layerRestrictions(
        'harness',
        'provider',
        'transport',
        'infrastructure',
      ),
    },
  },
  {
    files: ['src/transport/**/*.ts'],
    rules: {
      'no-restricted-imports': layerRestrictions(
        'provider',
        'adapter',
        'infrastructure',
      ),
    },
  },
  {
    files: ['src/infrastructure/**/*.ts'],
    rules: {
      'no-restricted-imports': layerRestrictions(
        'harness',
        'provider',
        'adapter',
        'transport',
      ),
    },
  },
)
