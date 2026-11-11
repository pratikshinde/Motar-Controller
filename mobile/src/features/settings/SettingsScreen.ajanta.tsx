import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Droplets,
  Globe,
  Headphones,
  LogOut,
  Pencil,
  Phone,
  Settings,
  Smartphone,
  Trash2,
  User as UserIcon,
} from 'lucide-react-native';
import {
  exportMyData,
  getGetDeletionRequestQueryKey,
  getListSessionsQueryKey,
  useGetDeletionRequest,
  useListAlerts,
  useListPumps,
  useListSessions,
  useRequestDeletion,
  useRevokeSession,
  useUpdateMe,
} from '@/api/generated/farmer';
import { getInstallId } from '@/api/session';
import pkg from '../../../package.json';
import { brand } from '@/config/brand';
import { Banner } from '@/shared/ui/Banner';
import { AjantaScreen } from '@/shared/ui/AjantaScreen';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { friendlyError } from '@/shared/i18n/errors';
import { formatDate, timeAgo } from '@/shared/i18n/format';
import { languageInfo } from '@/shared/i18n/languages';
import { useDirection } from '@/shared/i18n/useDirection';
import { useOnline } from '@/shared/hooks/useOnline';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { shareTextFile } from '@/shared/share';
import { useAuth } from '@/state/auth';
import { useSelectedPump } from '@/state/selectedPump';
import { SupportCard } from '@/features/support/SupportCard';

import { colors } from '@/shared/theme';
const INK = colors.text;
const MUTED = colors.textMuted;

type IconType = React.ComponentType<{ size?: number; color?: string }>;

const Row: React.FC<{
  icon: IconType;
  color: string;
  tint: string;
  title: string;
  hint?: string;
  value?: string;
  open?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}> = ({ icon: Icon, color, tint, title, hint, value, open, danger, disabled, onPress, testID }) => {
  const { flip } = useDirection();
  return (
    <TouchableOpacity
      style={[styles.row, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      testID={testID}
    >
      <View style={[styles.iconCircle, { backgroundColor: tint }]}>
        <Icon size={26} color={color} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, danger && { color: colors.danger }]}>{title}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {value ? (
        <View style={styles.valueChip}>
          <Text style={styles.valueText}>{value}</Text>
        </View>
      ) : null}
      {danger ? null : open === undefined ? (
        <ChevronRight size={22} color={colors.textFaint} style={flip} />
      ) : (
        <ChevronDown size={22} color={colors.textFaint} style={open ? { transform: [{ rotate: '180deg' }] } : undefined} />
      )}
    </TouchableOpacity>
  );
};

/** Ajanta's "More" page (the Settings mockup): the same things the original page offered, one card each. */
export const SettingsScreenAjanta: React.FC = () => {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const user = useAuth((s) => s.user);
  useStatusBar('light');

  const alertsQ = useListAlerts({ unresolved_only: true });
  const openAlerts = (alertsQ.data?.alerts ?? []).length;

  // The pump the farmer is looking at is who Help & support rings.
  const pumps = useListPumps().data?.pumps ?? [];
  const selected = useSelectedPump((s) => s.id);
  const supportPump = pumps.find((p) => p.id === selected) ?? pumps[0];

  const [name, setName] = useState(user?.full_name ?? '');
  const [nameSaved, setNameSaved] = useState(false);
  const updateMe = useUpdateMe();
  const [prevFullName, setPrevFullName] = useState(user?.full_name);
  if (user?.full_name !== prevFullName) {
    setPrevFullName(user?.full_name);
    setName(user?.full_name ?? '');
  }

  const sessions = useListSessions();
  const [installId, setInstallId] = useState<string | null>(null);
  useEffect(() => {
    void getInstallId().then(setInstallId);
  }, []);
  const revoke = useRevokeSession({
    mutation: { onSuccess: () => void qc.invalidateQueries({ queryKey: getListSessionsQueryKey() }) },
  });
  const [revoking, setRevoking] = useState<string | null>(null);

  const deletion = useGetDeletionRequest();
  const requestDeletion = useRequestDeletion({
    mutation: { onSuccess: () => void qc.invalidateQueries({ queryKey: getGetDeletionRequestQueryKey() }) },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [open, setOpen] = useState<'sessions' | 'help' | 'about' | null>(null);
  const toggle = (k: 'sessions' | 'help' | 'about') => setOpen((cur) => (cur === k ? null : k));

  const changed = name.trim() !== '' && name.trim() !== user?.full_name;
  const saveName = () => {
    const next = name.trim();
    if (!next || next === user?.full_name) return;
    updateMe.mutate(
      { data: { full_name: next } },
      {
        onSuccess: (u) => {
          void useAuth.getState().updateUser(u);
          setNameSaved(true);
        },
      },
    );
  };

  const doExport = async () => {
    setExporting(true);
    setExportError(false);
    try {
      const data = await exportMyData();
      await shareTextFile('agripump_my_data.json', JSON.stringify(data, null, 2), 'application/json');
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  };

  const others = (sessions.data?.sessions ?? []).filter((s) => s.app_install_id !== installId);
  const pending = deletion.data?.request?.status === 'PENDING' ? deletion.data.request : null;

  return (
    <AjantaScreen
      banner={{
        title: t('settings.title'),
        unreadAlerts: openAlerts,
        onPressAlerts: () => router.push('/alerts'),
        onPressProfile: () => router.push('/settings'),
      }}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={[styles.iconCircle, { backgroundColor: colors.primarySoft }]}>
            <UserIcon size={26} color={colors.primary} />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{t('home.myDetails')}</Text>
            <Text style={styles.rowHint}>{t('home.myDetailsHint')}</Text>
          </View>
        </View>
        <View style={styles.detailsBox}>
          <Text style={styles.label}>{t('settings.name')}</Text>
          <View style={styles.inputRow}>
            <TextInput
              testID="profile-name"
              style={styles.input}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setNameSaved(false);
              }}
              maxLength={100}
              accessibilityLabel={t('settings.name')}
            />
            <Pencil size={20} color={colors.primary} />
          </View>
          {changed ? (
            <TouchableOpacity
              style={[styles.saveBtn, (!online || updateMe.isPending) && { opacity: 0.5 }]}
              onPress={saveName}
              disabled={!online || updateMe.isPending}
              accessibilityRole="button"
              testID="save-name"
            >
              <Text style={styles.saveText}>{t('common.save')}</Text>
            </TouchableOpacity>
          ) : null}
          {updateMe.isError ? <Banner tone="danger" text={friendlyError(updateMe.error, t, 'command')} /> : null}
          {nameSaved ? <Banner tone="info" text={t('settings.nameSaved')} testID="name-saved" /> : null}
          <Text style={[styles.label, { marginTop: 10 }]}>{t('settings.mobile')}</Text>
          <View style={styles.phoneRow}>
            <Phone size={20} color={colors.primary} />
            <Text style={styles.phone}>{user?.phone_number ?? '—'}</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Row
          icon={Globe}
          color={colors.primary}
          tint={colors.primarySoft}
          title={t('settings.language')}
          hint={t('settings.languageHint')}
          value={languageInfo(i18n.language).native}
          onPress={() => router.push({ pathname: '/language', params: { mode: 'change' } })}
          testID="open-language"
        />
      </View>

      <View style={styles.card}>
        <Row
          icon={Droplets}
          color={colors.primary}
          tint={colors.primarySoft}
          title={t('settings.managePumps')}
          hint={t('settings.managePumpsHint')}
          onPress={() => router.push('/manage')}
          testID="open-manage"
        />
      </View>

      <View style={styles.card}>
        <Row
          icon={Smartphone}
          color={colors.primary}
          tint={colors.primarySoft}
          title={t('settings.sessions')}
          hint={t('home.sessionsHint')}
          open={open === 'sessions'}
          onPress={() => toggle('sessions')}
          testID="open-sessions"
        />
        {open === 'sessions' ? (
          <View style={styles.expand}>
            {sessions.isLoading && !sessions.data ? <Text style={styles.rowHint}>{t('common.loading')}</Text> : null}
            {(sessions.data?.sessions ?? []).map((s) => {
              const mine = s.app_install_id === installId;
              return (
                <View key={s.family_id} style={styles.session} testID={`session-${s.family_id}`}>
                  <View style={styles.rowText}>
                    <Text style={styles.sessionTitle}>
                      {s.device_info}
                      {mine ? ` · ${t('settings.thisDevice')}` : ''}
                    </Text>
                    <Text style={styles.rowHint}>
                      {t('settings.lastUsed', { when: timeAgo(t, s.last_used_at ?? s.created_at) })}
                    </Text>
                  </View>
                  {!mine ? (
                    <TouchableOpacity
                      style={styles.signOut}
                      onPress={() => setRevoking(s.family_id)}
                      accessibilityRole="button"
                      testID={`revoke-${s.family_id}`}
                    >
                      <Text style={styles.signOutText}>{t('settings.signOutDevice')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
            {sessions.data && others.length === 0 ? <Text style={styles.rowHint}>{t('settings.noOtherSessions')}</Text> : null}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Row
          icon={Headphones}
          color={colors.primary}
          tint={colors.primarySoft}
          title={t('home.help')}
          hint={t('home.helpHint')}
          open={open === 'help'}
          onPress={() => toggle('help')}
          testID="open-help"
        />
        {open === 'help' && supportPump ? (
          <View style={styles.expand}>
            <SupportCard pumpId={supportPump.id} />
          </View>
        ) : null}
        <View style={styles.divider} />
        <Row
          icon={Settings}
          color={colors.textMuted}
          tint={colors.surfaceAlt}
          title={t('home.about')}
          hint={t('home.aboutHint')}
          open={open === 'about'}
          onPress={() => toggle('about')}
          testID="open-about"
        />
        {open === 'about' ? (
          <View style={styles.expand}>
            <Text style={styles.aboutName}>{brand.appName}</Text>
            <Text style={styles.rowHint}>{t('settings.version', { version: pkg.version })}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Row
          icon={Download}
          color={colors.primary}
          tint={colors.primarySoft}
          title={t('settings.export')}
          hint={t('settings.exportHint')}
          disabled={exporting || !online}
          onPress={() => void doExport()}
          testID="export-data"
        />
        {exportError ? <Banner tone="danger" text={t('settings.exportFailed')} /> : null}
        <View style={styles.divider} />
        {pending ? (
          <Banner
            tone="info"
            text={t('settings.deletePending', { date: formatDate(i18n.language, pending.requested_at) })}
            testID="deletion-pending"
          />
        ) : (
          <Row
            icon={Trash2}
            color={colors.textMuted}
            tint={colors.surfaceAlt}
            title={t('settings.delete')}
            hint={t('settings.deleteHint')}
            disabled={!online}
            onPress={() => setConfirmDelete(true)}
            testID="delete-data"
          />
        )}
        {requestDeletion.isError ? <Banner tone="danger" text={friendlyError(requestDeletion.error, t, 'command')} /> : null}
        <View style={styles.divider} />
        <Row
          icon={LogOut}
          color={colors.danger}
          tint={colors.dangerSoft}
          title={t('settings.logout')}
          danger
          onPress={() => setConfirmLogout(true)}
          testID="logout"
        />
      </View>

      <ConfirmSheet
        visible={confirmLogout}
        title={t('settings.logoutTitle')}
        message={t('settings.logoutMessage')}
        confirmLabel={t('settings.logout')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        onConfirm={() => {
          setConfirmLogout(false);
          void useAuth.getState().signOut();
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
      <ConfirmSheet
        visible={revoking !== null}
        title={t('settings.signOutDeviceTitle')}
        message={t('settings.signOutDeviceBody')}
        confirmLabel={t('settings.signOutDevice')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate({ familyId: revoking }, { onSettled: () => setRevoking(null) })}
        onCancel={() => setRevoking(null)}
      />
    </AjantaScreen>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    elevation: 1,
    shadowColor: colors.shadowTint,
    shadowOpacity: 0.07,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingVertical: 8, minHeight: 64 },
  iconCircle: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: INK, fontSize: 18, fontWeight: '800' },
  rowHint: { color: MUTED, fontSize: 13.5, marginTop: 2 },
  valueChip: { backgroundColor: colors.primarySoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  valueText: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 8 },
  expand: { paddingHorizontal: 6, paddingBottom: 8, gap: 8 },
  detailsBox: { backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 12, marginTop: 4, marginHorizontal: 4, marginBottom: 4 },
  label: { color: MUTED, fontSize: 14, fontWeight: '700', marginBottom: 6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 50,
  },
  input: { flex: 1, color: INK, fontSize: 17, fontWeight: '700', paddingVertical: 8 },
  saveBtn: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10, marginTop: 10 },
  saveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  phone: { color: INK, fontSize: 18, fontWeight: '800' },
  session: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  sessionTitle: { color: INK, fontSize: 15, fontWeight: '800' },
  signOut: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  signOutText: { color: colors.danger, fontSize: 15, fontWeight: '900' },
  aboutName: { color: INK, fontSize: 17, fontWeight: '800' },
});
