// Wraps app.json. Two jobs:
//
// 1. One codebase, one app per manufacturer (brand). BRAND=<key> picks brands/<key>/brand.json, which decides the app's
//    name, package id, deep-link scheme, icon and colours. The same code, built with a different BRAND, is a different
//    app. Without BRAND the build is "ajanta". The brand's public half is passed to the running app through `extra`
//    (read in src/config/brand.ts).
//
// 2. Builds that are NOT a store "production" profile (development and the field-beta preview APK) may talk to the
//    plain-HTTP server, which Android otherwise refuses. A production build must point EXPO_PUBLIC_API_URL at an HTTPS
//    address instead. Profile names are "<profile>" or "<brand>-<profile>" (see eas.json).
const brands = require('./brands/load');

module.exports = ({ config }) => {
  const key = brands.selectedKey();
  const brand = brands.load(key);
  const build = brand.build;

  const profile = process.env.EAS_BUILD_PROFILE || '';
  const production = profile === 'production' || profile.endsWith('-production');
  const plugins = [...(config.plugins ?? [])];
  if (!production) {
    plugins.push(['expo-build-properties', { android: { usesCleartextTraffic: true } }]);
  }

  const icon = brands.assetPath(key, build.icon);
  const adaptiveForeground = brands.assetPath(key, build.adaptiveIconForeground);
  const splashImage = brands.assetPath(key, build.splashImage);

  return {
    ...config,
    name: brand.appName,
    slug: build.slug,
    scheme: build.scheme,
    ...(icon ? { icon } : {}),
    ...(splashImage ? { splash: { image: splashImage, resizeMode: 'contain', backgroundColor: brand.colors.primary ?? '#007F3B' } } : {}),
    android: {
      ...config.android,
      package: build.androidPackage,
      ...(adaptiveForeground
        ? {
            adaptiveIcon: {
              foregroundImage: adaptiveForeground,
              backgroundColor: build.adaptiveIconBackground ?? brand.colors.primary ?? '#007F3B',
            },
          }
        : {}),
    },
    ios: { ...config.ios, bundleIdentifier: build.iosBundleId },
    plugins,
    extra: {
      ...config.extra,
      brand: brands.publicPart(brand),
      ...(build.easProjectId ? { eas: { projectId: build.easProjectId } } : {}),
    },
  };
};
