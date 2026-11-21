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
  // Push notifications (Firebase Cloud Messaging) and Firebase phone sign-in: only where this build has a Firebase file that holds THIS app's
  // Android package. google-services.json is kept out of git; it can list several apps of one Firebase project (add each brand's package in
  // the Firebase console and download the file again). A build whose package is not in it simply has no push and no Firebase sign-in.
  const googleServices = path.join(__dirname, 'google-services.json');
  const hasFirebaseFor = (pkg) => {
    try {
      const j = JSON.parse(fs.readFileSync(googleServices, 'utf8'));
      return (j.client || []).some((cl) => (cl.client_info || {}).android_client_info?.package_name === pkg);
    } catch {
      return false;
    }
  };
  const brandFeatures = brand.features || {};
  const firebase = hasFirebaseFor(build.androidPackage);
  const push = firebase && !!brandFeatures.push;
  const features = { ...brandFeatures, push, firebasePhone: firebase && !!brandFeatures.firebasePhone };
  const notificationIcon = fs.existsSync(path.join(__dirname, 'brands', key, 'notification-icon.png')) ? `./brands/${key}/notification-icon.png` : undefined;
  // The same Firebase project also verifies phone numbers at sign-in (Firebase Phone Authentication): the library's plugin wires
  // google-services.json into the Android build.
  if (push) {
    // The small picture in the status bar and the shade must be a white shape on a clear background (Android paints it in one colour);
    // without one the phone shows a plain white square.
    plugins.push(
      ['expo-notifications', { ...(notificationIcon ? { icon: notificationIcon } : {}), color: (brand.colors || {}).primary || '#7053B8' }],
      '@react-native-firebase/app'
    );
  }
  // The React Native Firebase modules are in every brand's Android build (they are dependencies of the app, whether or not the brand
  // uses Firebase), and they only compile with this fix: so it is not tied to push.
  plugins.push('./plugins/with-firebase-kotlin');
  // A farmer's first sign-in is scanning the QR code the dealer printed.
  if (brandFeatures.qrScan) plugins.push(['expo-camera', { cameraPermission: 'Allow $(PRODUCT_NAME) to use the camera to scan your QR code.' }]);
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
    name: build.launcherName ?? brand.appName,   // the label under the icon on the phone; the app's own screens keep using brand.appName
    slug: build.slug,
    scheme: build.scheme,
    ...(icon ? { icon } : {}),
    ...(splashImage ? { splash: { image: splashImage, resizeMode: 'contain', backgroundColor: build.splashBackground ?? brand.colors.primary ?? '#007F3B' } } : {}),
    android: {
      ...config.android,
      package: build.androidPackage,
      // A brand with no QR scan never opens the camera: keep the camera / microphone permissions (declared by the bundled camera library) out of the app.
      ...(brandFeatures.qrScan ? {} : { blockedPermissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'] }),
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
      brand: { ...brands.publicPart(brand), features },
      ...(build.easProjectId ? { eas: { projectId: build.easProjectId } } : {}),
    },
  };
};
