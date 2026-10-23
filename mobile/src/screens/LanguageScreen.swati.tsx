import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';
import { useTranslation } from 'react-i18next';
import { Check, Volume2, Square, ChevronLeft } from 'lucide-react-native';
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
export const LanguageScreenSwati: React.FC<LanguageScreenProps> = ({ initial, mode, onDone, onBack }) => {
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
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Screen 2 Top Bar */}
      <View style={styles.topBar}>
        {onBack ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={back}
            accessibilityRole="button"
            accessibilityLabel={t('language.back')}
            activeOpacity={0.7}
          >
            <ChevronLeft size={28} color="#0F172A" style={flip} />
          </TouchableOpacity>
        ) : <View style={{ width: 28 }} />}
        <Text style={styles.headerTitle}>{t('language.title')}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Single Column Language List */}
        <View style={styles.list}>
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
                  {on ? <Check size={14} color="#FFFFFF" strokeWidth={3.5} /> : null}
                </View>
                <Text style={[styles.nativeText, on && styles.nativeTextOn]}>{l.native}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Audio Helper Card */}
        <TouchableOpacity
          style={[styles.assistBtn, playing && styles.assistBtnOn]}
          onPress={playing ? stopAssistant : startAssistant}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={playing ? t('language.stopListening') : t('language.listenAll')}
        >
          {playing ? (
            <Square size={20} color="#FFFFFF" fill="#FFFFFF" />
          ) : (
            <Volume2 size={22} color="#1565C0" />
          )}
          <Text style={[styles.assistText, playing && { color: '#FFFFFF' }]}>
            {playing ? t('language.stopListening') : t('language.listenAll')}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom Continue Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, saving && { opacity: 0.7 }]}
          onPress={confirm}
          disabled={saving}
          activeOpacity={0.85}
          accessibilityRole="button"
          testID="language-continue"
        >
          <Text style={styles.continueText}>{`${t('language.continue')} →`}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  list: {
    gap: 12,
    marginBottom: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 14,
  },
  cardOn: {
    borderColor: '#16A34A',
    backgroundColor: '#F0FDF4',
  },
  cardSpeaking: {
    borderColor: '#1565C0',
    backgroundColor: '#EFF6FF',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: '#16A34A',
    backgroundColor: '#16A34A',
  },
  nativeText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#334155',
  },
  nativeTextOn: {
    fontWeight: '800',
    color: '#15803D',
  },
  assistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E0F2FE',
    borderRadius: 14,
    paddingVertical: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  assistBtnOn: {
    backgroundColor: '#1565C0',
    borderColor: '#1565C0',
  },
  assistText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1565C0',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  continueBtn: {
    backgroundColor: '#1565C0',
    borderRadius: 28,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#1565C0',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  continueText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
});
