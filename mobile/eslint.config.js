const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'src/api/generated/**',
      'coverage/**',
      'babel.config.js',
      'app.config.js',
    ],
  },
  {
    rules: {
      // `t('…')` keys and route params are checked by the locale script and by tsc, not by lint.
      'react/display-name': 'off',
      // `axios.create(...)` and `i18n.changeLanguage(...)` are the libraries' documented default-export APIs.
      'import/no-named-as-default-member': 'off',
    },
  },
];
