import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';
import { Square, Volume2 } from 'lucide-react-native';
import { languageInfo } from '../i18n/languages';
import { colors, font, radius, TOUCH } from '../theme';

const norm = (code: string) => code.toLowerCase().replace('_', '-');

/** First of the language's preferred voices that this phone actually has, or null. */
export async function pickVoiceLanguage(candidates: string[]): Promise<string | null> {
  let voices: Speech.Voice[] = [];
  try {
    voices = await Speech.getAvailableVoicesAsync();
  } catch {
    return candidates[0] ?? null; // cannot list voices: let the engine try the best guess
  }
  for (const wanted of candidates) {
    const primary = norm(wanted).split('-')[0];
    const match = voices.find((v) => norm(v.language).split('-')[0] === primary);
    if (match) return match.language;
  }
  return null;
}

/**
 * Reads a sentence aloud with the phone's own text-to-speech in the app's language. Nothing is
 * sent to a server; where the phone has no voice for the language it says so instead of speaking
 * in the wrong accent.
 */
export const ListenButton: React.FC<{ getText: () => string; testID?: string }> = ({ getText, testID }) => {
  const { t, i18n } = useTranslation();
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => void Speech.stop(), []);

  const toggle = useCallback(async () => {
    if (speaking) {
      await Speech.stop();
      setSpeaking(false);
      return;
    }
    const language = await pickVoiceLanguage(languageInfo(i18n.language).speech);
    if (!language) {
      const msg = t('listen.noVoice');
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert(t('listen.start'), msg);
      return;
    }
    setSpeaking(true);
    Speech.speak(getText(), {
      language,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  }, [speaking, i18n.language, t, getText]);

  const Icon = speaking ? Square : Volume2;
  const label = speaking ? t('listen.stop') : t('listen.start');
  return (
    <TouchableOpacity
      testID={testID}
      onPress={toggle}
      style={styles.btn}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: speaking }}
    >
      <Icon size={20} color={colors.primary} />
      <Text style={styles.text}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    minHeight: TOUCH - 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  text: { color: colors.primary, fontSize: font.body, fontWeight: '800' },
});
