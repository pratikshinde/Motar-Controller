import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, ShieldCheck, Wrench } from 'lucide-react-native';
import {
  getGetPumpQueryKey,
  getListPumpFaultsQueryKey,
  useAckPumpFault,
  useListPumpFaults,
} from '@/api/generated/farmer';
import type { FaultRecordResponse, PumpResponse } from '@/api/generated/model';
import { colors, font, space } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { Card, CardTitle } from '@/shared/ui/Card';
import { StatusPill } from '@/shared/ui/StatusPill';
import { faultName } from '@/shared/i18n/faults';
import { friendlyError } from '@/shared/i18n/errors';
import { formatDateTime, timeAgo } from '@/shared/i18n/format';
import { hasKnownFault, isKnownHealthy } from '@/features/pumps/model';
import { SupportCard } from '@/features/support/SupportCard';
import { faultInfoKeys } from './info';
import { PanelResetIllustration } from './PanelResetIllustration';

const FaultRow: React.FC<{ fault: FaultRecordResponse; onAck: () => void; acking: boolean }> = ({
  fault,
  onAck,
  acking,
}) => {
  const { t, i18n } = useTranslation();
  const resolved = !!fault.resolved_at;
  const seen = !!fault.ack_at;
  return (
    <View style={styles.row} testID={`fault-${fault.id}`}>
      <View style={styles.rowHead}>
        <Text style={styles.rowName}>
          {fault.fault_code
            ? faultName(t, fault.fault_code)
            : (fault.fault_description ?? t('faults.unknown', { code: '?' }))}
        </Text>
        <StatusPill
          tone={resolved ? 'ok' : seen ? 'idle' : 'danger'}
          size="sm"
          label={resolved ? t('faults.fixed') : seen ? t('faults.acked') : t('faults.open')}
        />
      </View>
      <Text style={styles.rowWhen}>
        {t('faults.occurred', { when: formatDateTime(i18n.language, fault.occurred_at) })}
      </Text>
      {seen && fault.ack_at ? (
        <Text style={styles.rowWhen}>{t('faults.seenAt', { when: formatDateTime(i18n.language, fault.ack_at) })}</Text>
      ) : null}
      {!seen && !resolved ? (
        <BigActionButton
          tone="neutral"
          label={t('faults.ack')}
          onPress={onAck}
          loading={acking}
          testID={`ack-${fault.id}`}
        />
      ) : null}
    </View>
  );
};

/** What is wrong now and what to do about it, who to call, and the history of past problems. */
export const FaultsTab: React.FC<{ pump: PumpResponse }> = ({ pump }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useListPumpFaults(pump.id, { status: 'all' });
  const ack = useAckPumpFault({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListPumpFaultsQueryKey(pump.id) });
        void qc.invalidateQueries({ queryKey: getGetPumpQueryKey(pump.id) });
      },
    },
  });

  const inFault = hasKnownFault(pump);
  const healthy = isKnownHealthy(pump);
  const keys = faultInfoKeys(pump.fault_code);
  const faults = q.data ?? [];

  return (
    <View style={styles.stack}>
      <Card>
        <CardTitle icon={inFault ? AlertTriangle : ShieldCheck} title={t('faults.current')} />
        {inFault ? (
          <View style={styles.stack} testID="current-fault">
            <Text style={styles.faultName}>
              {pump.fault_code ? faultName(t, pump.fault_code) : t('faultInfo.unknown.cause')}
            </Text>
            <View style={styles.block}>
              <Text style={styles.blockLabel}>{t('faults.cause')}</Text>
              <Text style={styles.blockText}>{t(keys.cause)}</Text>
            </View>
            <View style={[styles.block, styles.actionBlock]}>
              <View style={styles.actionHead}>
                <Wrench size={18} color={colors.primary} />
                <Text style={[styles.blockLabel, { color: colors.primary }]}>{t('faults.action')}</Text>
              </View>
              <Text style={styles.blockText}>{t(keys.action)}</Text>
            </View>
          </View>
        ) : healthy ? (
          <View style={styles.healthy}>
            <ShieldCheck size={40} color={colors.ok} />
            <Text style={styles.healthyText}>{t('dashboard.noFaults')}</Text>
          </View>
        ) : (
          <Text style={styles.blockText} testID="fault-unknown">
            {pump.last_seen_at ? t('live.stale', { ago: timeAgo(t, pump.last_seen_at) }) : t('live.noDataYet')}
          </Text>
        )}
      </Card>

      {inFault ? (
        <Card>
          <CardTitle icon={Wrench} title={t('faults.resetTitle')} />
          <PanelResetIllustration />
        </Card>
      ) : null}

      <SupportCard pumpId={pump.id} />

      <Card>
        <CardTitle icon={History} title={t('faults.history')} />
        {ack.isError ? <Banner tone="danger" text={friendlyError(ack.error, t, 'command')} /> : null}
        {q.isLoading && !q.data ? (
          <Text style={styles.blockText}>{t('common.loading')}</Text>
        ) : q.isError && !q.data ? (
          <Banner tone="danger" text={friendlyError(q.error, t, 'load')} />
        ) : faults.length === 0 ? (
          <Text style={styles.blockText} testID="no-fault-history">
            {t('faults.historyEmpty')}
          </Text>
        ) : (
          <View style={styles.list}>
            {faults.map((f) => (
              <FaultRow
                key={f.id}
                fault={f}
                acking={ack.isPending && ack.variables?.faultId === f.id}
                onAck={() => ack.mutate({ id: pump.id, faultId: f.id })}
              />
            ))}
          </View>
        )}
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  stack: { gap: space.md },
  faultName: { color: colors.danger, fontSize: font.headline, fontWeight: '900' },
  block: { gap: 4 },
  actionBlock: { backgroundColor: colors.primarySoft, borderRadius: 12, padding: 12 },
  actionHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  blockLabel: { color: colors.textMuted, fontSize: font.body, fontWeight: '800' },
  blockText: { color: colors.text, fontSize: font.bodyLg, lineHeight: 26 },
  healthy: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  healthyText: { color: colors.ok, fontSize: font.bodyLg, fontWeight: '800', textAlign: 'center' },
  list: { gap: 14 },
  row: { gap: 6, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  rowName: { color: colors.text, fontSize: font.body, fontWeight: '800', flexShrink: 1 },
  rowWhen: { color: colors.textMuted, fontSize: font.body },
});
