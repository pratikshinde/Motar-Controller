import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Platform, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';
import { Check, Volume2, Square, Languages, ArrowRight, ChevronLeft } from 'lucide-react-native';
import { colors, font, radius, space, TOUCH, shadow } from '../shared/theme';
import { LANGUAGES, LanguageInfo, LangCode, previewLanguage, setAppLanguage } from '../shared/i18n';
import { useDirection } from '../shared/i18n/useDirection';

interface LanguageScreenProps {
  /** Language highlighted when the screen opens (saved choice, or the phone's language). */
  initial: LangCode;
  /** 'first' = first launch (no back button). 'change' = opened from Settings. */
  mode: 'first' | 'change';
  onDone: (code: LangCode) => void;
  onBack?: () => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const norm = (tag: string) => tag.replace('_', '-').toLowerCase();

/**
 * Language picker: two languages per row, each in its own script. Picking a card
 * switches the whole app to that language at once - heading and "Continue"
 * included - so nothing is shown in a second language.
 *
 * One speech-assistant button (instead of a speaker on every card) reads the
 * language names aloud one after another and highlights each as it is said, for
 * people who can't read any of them. It is also where the voice assistant
 * (planner Phase 5) will live: "say your language".
 */
export const LanguageScreen: React.FC<LanguageScreenProps> = ({ initial, mode, onDone, onBack }) => {
  const { t } = useTranslation();
  const { flip } = useDirection();
  const [selected, setSelected] = useState<LangCode>(initial);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speakingCode, setSpeakingCode] = useState<LangCode | null>(null);

  const playingRef = useRef(false);
  const voicesRef = useRef<string[] | null>(null);

  /** Best installed voice for a language, or null if the phone has none of its candidates. */
  const pickVoice = (l: LanguageInfo): string | null => {
    const have = voicesRef.current ?? [];
    if (have.length === 0) return l.speech[0]; // voice list unavailable: just try
    return l.speech.find((tag) => have.includes(norm(tag))) ?? null;
  };

  const speakOne = (text: string, language: string) =>
    new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (!finished) {
          finished = true;
          resolve();
        }
      };
      try {
        Speech.speak(text, { language, rate: 0.85, onDone: finish, onStopped: finish, onError: finish });
      } catch {
        finish();
      }
      setTimeout(finish, 4500); // never hang on a voice that stays silent
    });

  const stopAssistant = () => {
    playingRef.current = false;
    try {
      Speech.stop();
    } catch {
      // nothing playing
    }
    setPlaying(false);
    setSpeakingCode(null);
  };

  const startAssistant = async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    if (!voicesRef.current) {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        voicesRef.current = voices.map((v) => norm(v.language));
      } catch {
        voicesRef.current = [];
      }
    }
    for (const l of LANGUAGES) {
      if (!playingRef.current) return;
      setSpeakingCode(l.code);
      const voice = pickVoice(l);
      if (voice) await speakOne(l.native, voice);
      else await sleep(900); // no voice installed: still highlight it so it can be recognised
      await sleep(250);
    }
    stopAssistant();
  };

  useEffect(() => stopAssistant, []); // silence on leaving the screen

  const choose = (code: LangCode) => {
    stopAssistant();
    setSelected(code);
    previewLanguage(code);
  };

  const confirm = async () => {
    stopAssistant();
    setSaving(true);
    try {
      await setAppLanguage(selected);
      onDone(selected);
    } finally {
      setSaving(false);
    }
  };

  const back = () => {
    stopAssistant();
    previewLanguage(initial); // discard the live preview
    onBack?.();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {mode === 'change' && onBack ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel={t('language.back')}
            activeOpacity={0.7}
          >
            <ChevronLeft size={26} color={colors.primary} style={flip} />
            <Text style={styles.backText}>{t('language.back')}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Languages size={34} color={colors.primary} />
          </View>
          <Text style={styles.title}>{t('language.title')}</Text>

          <TouchableOpacity
            style={[styles.assistBtn, playing && styles.assistBtnOn]}
            onPress={playing ? stopAssistant : startAssistant}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={playing ? t('language.stopListening') : t('language.listenAll')}
          >
            {playing ? (
              <Square size={20} color={colors.textOnPrimary} fill={colors.textOnPrimary} />
            ) : (
              <Volume2 size={24} color={colors.primary} />
            )}
            <Text style={[styles.assistText, playing && { color: colors.textOnPrimary }]}>
              {playing ? t('language.stopListening') : t('language.listenAll')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.grid}>
          {LANGUAGES.map((l) => {
            const on = l.code === selected;
            const speaking = l.code === speakingCode;
            return (
              <TouchableOpacity
                key={l.code}
                style={[styles.card, on && styles.cardOn, speaking && styles.cardSpeaking]}
                onPress={() => choose(l.code)}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${l.native}, ${l.english}`}
              >
                <View style={[styles.radio, on && styles.radioOn]}>
                  {on ? <Check size={16} color={colors.textOnPrimary} strokeWidth={3} /> : null}
                </View>
                <Text style={styles.native} numberOfLines={1} adjustsFontSizeToFit>
                  {l.native}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, saving && { opacity: 0.7 }]}
          onPress={confirm}
          disabled={saving}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Text style={styles.continueText}>{t('language.continue')}</Text>
          <ArrowRight size={22} color={colors.textOnPrimary} style={flip} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },
  scroll: { padding: space.lg, paddingBottom: space.xl },
  backBtn: { flexDirection: 'row', alignItems: 'center', minHeight: TOUCH - 8, marginBottom: 4 },
  backText: { color: colors.primary, fontSize: font.body, fontWeight: '800' },
  hero: { alignItems: 'center', paddingTop: space.lg, paddingBottom: space.xl },
  heroIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { color: colors.text, fontSize: font.headline, fontWeight: '900', textAlign: 'center' },
  assistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: TOUCH,
    marginTop: 18,
    paddingHorizontal: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  assistBtnOn: { backgroundColor: colors.primary },
  assistText: { color: colors.primary, fontSize: font.body, fontWeight: '800' },

  // Two per row: 48% + 48% leaves a 4% gutter that space-between spreads out.
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md },
  card: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 68,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    ...(shadow as object),
  },
  cardOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  cardSpeaking: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  native: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '800' },
  footer: {
    padding: space.lg,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    minHeight: TOUCH + 4,
  },
  continueText: { color: colors.textOnPrimary, fontSize: font.title, fontWeight: '800' },
});
