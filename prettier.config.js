// @ts-check
/** @type {import("prettier").Config} */
const config = {
  arrowParens: 'avoid',
  bracketSameLine: false,
  bracketSpacing: true,
  htmlWhitespaceSensitivity: 'css',
  insertPragma: false,
  jsxSingleQuote: true,
  printWidth: 120,
  proseWrap: 'always',
  quoteProps: 'as-needed',
  requirePragma: false,
  semi: false,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
  plugins: ['@ianvs/prettier-plugin-sort-imports'],

  // @ianvs/prettier-plugin-sort-imports
  importOrder: ['<BUILTIN_MODULES>', '<THIRD_PARTY_MODULES>', '', '^@/', '', '^[./]'],
  importOrderParserPlugins: ['typescript', 'jsx', '["decorators", { "decoratorsBeforeExport": true }]'],
  importOrderTypeScriptVersion: '5.0.0',
  importOrderCaseSensitive: false,
}

export default config
