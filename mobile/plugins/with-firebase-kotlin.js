// Expo config plugin: lets the React Native Firebase modules compile against the current Firebase Android SDK.
//
// @react-native-firebase 27 uses Firebase Android SDK 35, whose Kotlin metadata is version 2.4. The Kotlin this app is built with
// is older, and its compiler refuses the newer metadata ("Module was compiled with an incompatible version of Kotlin"). Skipping
// the metadata version check for the Firebase modules only is the usual remedy: nothing else in the app is affected.
const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARK = 'react-native-firebase: skip Kotlin metadata version check';

const SNIPPET = `
// ${MARK}
subprojects { sub ->
  if (sub.name.startsWith('react-native-firebase')) {
    sub.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
      compilerOptions.freeCompilerArgs.add('-Xskip-metadata-version-check')
    }
  }
}
`;

module.exports = function withFirebaseKotlin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy' && !cfg.modResults.contents.includes(MARK)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
};
