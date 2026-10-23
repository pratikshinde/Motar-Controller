import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, Clock, Download, Droplets, Globe, LogOut, Settings, Trash2, User } from 'lucide-react-native';
import {
  exportMyData,
  getGetDeletionRequestQueryKey,
  useGetDeletionRequest,
  useListAlerts,
  useRequestDeletion,
} from '@/api/generated/farmer';
import { colors } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { SwatiPage } from '@/shared/ui/SwatiPage';
import { friendlyError } from '@/shared/i18n/errors';
import { formatDate } from '@/shared/i18n/format';
import { languageInfo } from '@/shared/i18n/languages';
import { useDirection } from '@/shared/i18n/useDirection';
import { useOnline } from '@/shared/hooks/useOnline';
import { shareTextFile } from '@/shared/share';
import { useAuth } from '@/state/auth';

interface RowProps {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  color?: string;
  title: string;
  value?: string;
  badge?: number;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}

const Row: React.FC<RowProps> = ({ icon: Icon, color = colors.primary, title, value, badge, danger, disabled, onPress, testID }) => {
  const { flip } = useDirection();
  return (
    <TouchableOpacity
      style={[styles.row, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      testID={testID}
    >
      <View style={styles.iconBox}>
        <Icon size={22} color={color} />
      </View>
      <Text style={[styles.rowTitle, danger && { color: colors.danger }]}>{title}</Text>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {danger ? null : <ChevronRight size={20} color="#94A3B8" style={flip} />}
    </TouchableOpacity>
  );
};

/** Swati's "More" page: the few things a farmer needs, each one tap away. */
export const SettingsScreenSwati: React.FC = () => {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const user = useAuth((s) => s.user);
  const signOut = useAuth((s) => s.signOut);

  const alertsQ = useListAlerts({ unresolved_only: true });
  const openAlerts = (alertsQ.data?.alerts ?? []).length;

  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deletion = useGetDeletionRequest();
  const pending = deletion.data?.request ?? null;
  const requestDeletion = useRequestDeletion({
    mutation: { onSuccess: () => void qc.invalidateQueries({ queryKey: getGetDeletionRequestQueryKey() }) },
  });

  const doExport = async () => {
    setExporting(true);
    setExportFailed(false);
    try {
      const data = await exportMyData();
      await shareTextFile('my_pump_data.json', JSON.stringify(data, null, 2), 'application/json');
    } catch {
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  };

  return (
    <SwatiPage title={t('nav.more')} noBack>
      <View style={styles.menu}>
        <Row
          icon={User}
          title={t('settings.profile')}
          onPress={() => Alert.alert(user?.full_name || t('settings.profile'), user?.phone_number ?? '')}
        />
        <View style={styles.divider} />
        <Row icon={AlertTriangle} color="#D97706" title={t('nav.alerts')} badge={openAlerts} onPress={() => router.push('/alerts')} />
        <View style={styles.divider} />
        <Row icon={Clock} title={t('swati.history')} onPress={() => router.push('/history')} />
        <View style={styles.divider} />
        <Row icon={Settings} title={t('swati.technical')} onPress={() => router.push('/technical')} />
        <View style={styles.divider} />
        <Row icon={Droplets} title={t('pumps.title')} onPress={() => router.push('/pumps')} />
        <View style={styles.divider} />
        <Row
          icon={Globe}
          title={t('settings.language')}
          value={languageInfo(i18n.language).native}
          onPress={() => router.push({ pathname: '/language', params: { mode: 'change' } })}
        />
        <View style={styles.divider} />
        <Row icon={Download} title={t('settings.export')} disabled={exporting || !online} onPress={() => void doExport()} testID="export-data" />
        <View style={styles.divider} />
        <Row icon={LogOut} color={colors.danger} title={t('settings.logout')} danger onPress={() => setConfirmLogout(true)} testID="logout" />
      </View>

      {exportFailed ? <Banner tone="danger" text={t('settings.exportFailed')} /> : null}

      {pending ? (
        <Banner tone="info" text={t('settings.deletePending', { date: formatDate(i18n.language, pending.requested_at) })} testID="deletion-pending" />
      ) : (
        <TouchableOpacity style={styles.deleteLink} onPress={() => setConfirmDelete(true)} disabled={!online} accessibilityRole="button" testID="delete-data">
          <Trash2 size={18} color="#64748B" />
          <Text style={styles.deleteText}>{t('settings.delete')}</Text>
        </TouchableOpacity>
      )}
      {requestDeletion.isError ? <Banner tone="danger" text={friendlyError(requestDeletion.error, t, 'command')} /> : null}

      <ConfirmSheet
        visible={confirmLogout}
        title={t('settings.logoutTitle')}
        message={t('settings.logoutMessage')}
        confirmLabel={t('settings.logout')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          setConfirmLogout(false);
          void signOut();
        }}
        onCancel={() => setConfirmLogout(false)}
      />
      <ConfirmSheet
        visible={confirmDelete}
        title={t('settings.deleteTitle')}
        message={t('settings.deleteBody')}
        confirmLabel={t('settings.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busy={requestDeletion.isPending}
        onConfirm={() => requestDeletion.mutate({ data: {} }, { onSettled: () => setConfirmDelete(false) })}
        onCancel={() => setConfirmDelete(false)}
      />
    </SwatiPage>
  );
};

const styles = StyleSheet.create({
  menu: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1.5, borderColor: '#E2E8F0', paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, minHeight: 60 },
  iconBox: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#0F172A' },
  value: { fontSize: 15, fontWeight: '700', color: '#64748B' },
  badge: { backgroundColor: colors.danger, borderRadius: 12, minWidth: 24, height: 24, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  divider: { height: 1, backgroundColor: '#F1F5F9', marginStart: 64 },
  deleteLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  deleteText: { fontSize: 15, fontWeight: '700', color: '#64748B' },
});
