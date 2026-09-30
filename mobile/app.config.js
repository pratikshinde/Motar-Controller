// Wraps app.json. Only difference: builds that are NOT the store "production" profile (development and
// the field-beta preview APK) may talk to the plain-HTTP server, which Android otherwise refuses.
// A production build must point EXPO_PUBLIC_API_URL at an HTTPS address instead.
module.exports = ({ config }) => {
  const production = process.env.EAS_BUILD_PROFILE === 'production';
  const plugins = [...(config.plugins ?? [])];
  if (!production) {
    plugins.push(['expo-build-properties', { android: { usesCleartextTraffic: true } }]);
  }
  return { ...config, plugins };
};
