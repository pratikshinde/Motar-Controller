import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react-native';
import { colors, radius } from '@/shared/theme';
import { tracking } from '@/shared/i18n/languages';
import { formatReading } from '@/shared/i18n/format';
import { signalBars } from '@/features/pumps/model';

/** A line-voltage ring. `voltage` null = the pump has not reported it: shown as a dash, never as 0. */
export const VoltageRing: React.FC<{ phase: string; voltage: number | null | undefined; color: string }> = ({
  phase,
  voltage,
  color,
}) => {
  const { t } = useTranslation();
  const unknown = voltage === null || voltage === undefined;
  const isDead = !unknown && voltage < 20;
  const ringRadius = 38;
  const circumference = 2 * Math.PI * ringRadius;
  const ratio = unknown ? 0 : Math.min(Math.max(voltage / 500, 0), 1);
  const strokeDashoffset = unknown || isDead ? circumference : circumference * (1 - ratio);
  const valueColor = unknown || isDead ? colors.textFaint : color;

  return (
    <View style={styles.wrap}>
      <View style={styles.circle}>
        <Svg width="96" height="96" viewBox="0 0 92 92">
          <Circle cx="46" cy="46" r={ringRadius} stroke={colors.border} strokeWidth={6} fill="none" />
          <Circle
            cx="46"
            cy="46"
            r={ringRadius}
            stroke={unknown || isDead ? colors.border : color}
            strokeWidth={6}
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            transform="rotate(-90 46 46)"
          />
        </Svg>
        <View style={styles.center}>
          <Text style={[styles.phase, { color: valueColor }]}>{phase}</Text>
          <Text style={[styles.value, { color: valueColor }]}>{formatReading(isDead ? 0 : voltage)}</Text>
          <Text style={styles.unit}>{t('dashboard.volts')}</Text>
        </View>
      </View>
      <View
        style={[
          styles.presence,
          unknown ? styles.presenceUnknown : isDead ? styles.presenceAbsent : styles.presencePresent,
        ]}
      >
        {unknown ? (
          <HelpCircle size={12} color={colors.idle} />
        ) : isDead ? (
          <AlertTriangle size={12} color={colors.danger} />
        ) : (
          <CheckCircle2 size={12} color={colors.ok} />
        )}
        <Text style={[styles.presenceText, { color: unknown ? colors.idle : isDead ? colors.danger : colors.ok }]}>
          {unknown ? t('live.noReading') : isDead ? t('dashboard.noPower') : t('dashboard.powerOk')}
        </Text>
      </View>
    </View>
  );
};

/** Mobile-signal bars; no bars are drawn (and no strength is claimed) when the pump has not reported it. */
export const SignalBars: React.FC<{ dbm: number | null | undefined; light?: boolean }> = ({ dbm, light }) => {
  const { t, i18n } = useTranslation();
  const bars = signalBars(dbm);
  return (
    <View style={styles.gsm}>
      <View style={[styles.gsmRow, light && styles.gsmRowLight]}>
        {[5, 9, 13, 17, 21].map((height, i) => (
          <View
            key={i}
            style={[
              styles.stick,
              { height },
              bars !== null && i < bars
                ? light
                  ? styles.stickOnLight
                  : styles.stickOn
                : light
                  ? styles.stickOffLight
                  : styles.stickOff,
            ]}
          />
        ))}
      </View>
      <Text
        style={[styles.gsmLabel, light && styles.gsmLabelLight, tracking(i18n.language, 0.6)]}
      >
        {bars === null ? '—' : t('dashboard.signal')}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', gap: 8 },
  circle: { position: 'relative', width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  phase: { fontSize: 13, fontWeight: '900', letterSpacing: 1 },
  value: { fontSize: 18, fontWeight: '900', marginVertical: 1 },
  unit: { fontSize: 10, color: colors.textFaint, fontWeight: '600' },
  presence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  presencePresent: { backgroundColor: colors.okSoft },
  presenceAbsent: { backgroundColor: colors.dangerSoft },
  presenceUnknown: { backgroundColor: colors.idleSoft },
  presenceText: { fontSize: 11.5, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  gsm: { alignItems: 'center' },
  gsmRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 24,
    backgroundColor: colors.heroRaised,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.heroBorder,
  },
  gsmRowLight: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  stick: { width: 4, borderRadius: 2 },
  stickOn: { backgroundColor: '#00e676' },
  stickOnLight: { backgroundColor: colors.primary },
  stickOff: { backgroundColor: '#4E6E5E' },
  stickOffLight: { backgroundColor: colors.border },
  gsmLabel: { color: colors.textOnDarkMuted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6, marginTop: 2 },
  gsmLabelLight: { color: colors.textFaint },
});
