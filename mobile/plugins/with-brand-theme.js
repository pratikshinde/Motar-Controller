// Expo config plugin: gives the Android app theme the brand's accent colour (brands/<key>/brand.json, colors.primary).
//
// `colorAccent` is what Android's own dialogs take their colour from: the OK / Cancel buttons of the clock picker, the selected
// hour and minute box, text cursors and selection handles. Without it they show Android's default purple-grey.
const { AndroidConfig, withAndroidStyles } = require('@expo/config-plugins');

module.exports = function withBrandTheme(config, { accent }) {
  if (!/^#[0-9a-fA-F]{6}$/.test(accent || '')) throw new Error('with-brand-theme: "accent" must be a #RRGGBB colour');
  return withAndroidStyles(config, (cfg) => {
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'colorAccent',
      value: accent,
    });
    return cfg;
  });
};
