module.exports = {
  root: true,
  env: { es2020: true, node: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: { project: ['tsconfig.json'], sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['/lib/**/*', '.eslintrc.js'],
  rules: {
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
  },
};
