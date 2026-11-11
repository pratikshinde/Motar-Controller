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
const fs = require('fs');
const path = require('path');
const brands = require('./brands/load');

module.exports = ({ config }) => {
  const key = brands.selectedKey();
  const brand = brands.load(key);
  const build = brand.build;

  const profile = process.env.EAS_BUILD_PROFILE || '';
  const production = profile === 'production' || profile.endsWith('-production');
  const plugins = [...(config.plugins ?? [])];
  // Push notifications (Firebase Cloud Messaging): only where this app has its Firebase file. google-services.json belongs to
  // one Android package (the Ajanta app's) and is kept out of git; a build without it simply has no push.
  const googleServices = path.join(__dirname, 'google-services.json');
  const push = fs.existsSync(googleServices) && key === 'ajanta';
  // The same Firebase project also verifies phone numbers at sign-in (Firebase Phone Authentication): the library's plugin wires
  // google-services.json into the Android build.
  if (push) plugins.push('expo-notifications', '@react-native-firebase/app', './plugins/with-firebase-kotlin');
  // The Ajanta farmer's first sign-in is scanning the QR code the dealer printed.
  if (key === 'ajanta') plugins.push(['expo-camera', { cameraPermission: 'Allow $(PRODUCT_NAME) to use the camera to scan your QR code.' }]);
  // The phone's own clock picker (Weekly schedule) and every other Android dialog take the brand colour from the app theme.
  const c = brand.colors || {};
  if (key === 'ajanta' && c.primary) {
    plugins.push(['./plugins/with-brand-theme', { accent: c.primary }]);
    plugins.push([
      '@react-native-community/datetimepicker',
      { android: { timePicker: { numbersSelectorColor: { light: c.primary }, numbersBackgroundColor: { light: c.primarySoft }, numbersTextColor: { light: c.text } } } },
    ]);
  }
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
      ...(push ? { googleServicesFile: './google-services.json' } : {}),
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
