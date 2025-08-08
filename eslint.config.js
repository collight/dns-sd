// @ts-check
import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import prettierRecommended from 'eslint-plugin-prettier/recommended'
import tseslint from 'typescript-eslint'

// MARK: baseConfig
const baseConfig = tseslint.config(eslint.configs.recommended, {
  rules: {
    /** https://eslint.org/docs/latest/rules/no-extra-boolean-cast @remark in favor of `@typescript-eslint/strict-boolean-expressions` */
    'no-extra-boolean-cast': 'off',
    /** https://eslint.org/docs/latest/rules/no-param-reassign */
    'no-param-reassign': 'warn',
    /** https://eslint.org/docs/latest/rules/no-unused-vars @remark in favor of `@typescript-eslint/no-unused-vars` */
    'no-unused-vars': 'off',
    /** https://eslint.org/docs/latest/rules/prefer-const */
    'prefer-const': 'warn',
    /** https://eslint.org/docs/latest/rules/require-yield @remark allow generator without `yield` */
    'require-yield': 'off',
  },
})

// MARK: typeCheckedConfig
const typeCheckedConfig = tseslint.config(
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      // type-checking rules
      /** https://typescript-eslint.io/rules/no-confusing-void-expression/ */
      '@typescript-eslint/no-confusing-void-expression': ['warn', { ignoreArrowShorthand: true }],
      /** https://typescript-eslint.io/rules/restrict-template-expressions/ @remark allow implicit `toString()` in string templates */
      '@typescript-eslint/restrict-template-expressions': 'off',
      /** https://typescript-eslint.io/rules/strict-boolean-expressions/ */
      '@typescript-eslint/strict-boolean-expressions': 'warn',
      /** https://typescript-eslint.io/rules/switch-exhaustiveness-check/ */
      '@typescript-eslint/switch-exhaustiveness-check': ['warn', { considerDefaultExhaustiveForUnions: true }],

      // non-type-checking rules
      /** https://typescript-eslint.io/rules/consistent-type-definitions/ @remark prefer `type` for plain objects, `interface` for class inheritance */
      '@typescript-eslint/consistent-type-definitions': 'off',
      /** https://typescript-eslint.io/rules/no-namespace @remark allow `namespace` */
      '@typescript-eslint/no-namespace': 'off',
      /** https://typescript-eslint.io/rules/require-await @remark allow `await` */
      '@typescript-eslint/require-await': 'off',
      /** https://typescript-eslint.io/rules/no-non-null-assertion */
      '@typescript-eslint/no-non-null-assertion': 'off',
      /** https://typescript-eslint.io/rules/no-unused-expressions */
      '@typescript-eslint/no-unused-expressions': 'warn',
      /** https://typescript-eslint.io/rules/explicit-function-return-type */
      '@typescript-eslint/explicit-function-return-type': 'warn',
      /** https://typescript-eslint.io/rules/no-unused-vars/ */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
)

// MARK: prettierConfig
const prettierConfig = tseslint.config(eslintConfigPrettier, prettierRecommended, {
  rules: {
    'prettier/prettier': 'warn',
  },
})

export default tseslint.config(
  {
    ignores: ['coverage', 'dist', 'docs', 'node_modules', '*.config.{js,cjs,mjs,ts}'],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...baseConfig,
  ...typeCheckedConfig,
  ...prettierConfig,
)
