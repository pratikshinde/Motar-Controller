import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  Download,
  Languages,
  LogOut,
  Smartphone,
  Trash2,
  User as UserIcon,
  Droplets,
} from 'lucide-react-native';
import {
  exportMyData,
  getGetDeletionRequestQueryKey,
  getListSessionsQueryKey,
  useGetDeletionRequest,
  useListSessions,
  useRequestDeletion,
  useRevokeSession,
  useUpdateMe,
} from '@/api/generated/farmer';
import { getInstallId } from '@/api/session';
import pkg from '../../../package.json';
import { colors, font, radius, space, TOUCH } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { Card, CardTitle } from '@/shared/ui/Card';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { ScreenHeader } from '@/shared/ui/ScreenHeader';
import { friendlyError } from '@/shared/i18n/errors';
import { formatDate, timeAgo } from '@/shared/i18n/format';
import { languageInfo } from '@/shared/i18n/languages';
import { useDirection } from '@/shared/i18n/useDirection';
import { useOnline } from '@/shared/hooks/useOnline';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { shareTextFile } from '@/shared/share';
import { useAuth } from '@/state/auth';

const Row: React.FC<{
  icon: React.ComponentType<{ size?: number; color?: string }>;
  title: string;
  hint?: string;
  value?: string;
  onPress: () => void;
  testID?: string;
}> = ({ icon: Icon, title, hint, value, onPress, testID }) => {
  const { flip } = useDirection();
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      accessibilityRole="button"
      activeOpacity={0.8}
      testID={testID}
    >
      <Icon size={24} color={colors.primary} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      <ChevronRight size={22} color={colors.textFaint} style={flip} />
    </TouchableOpacity>
  );
};

export const SettingsScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const user = useAuth((s) => s.user);
  useStatusBar('light');

  const [name, setName] = useState(user?.full_name ?? '');
  const [nameSaved, setNameSaved] = useState(false);
  const updateMe = useUpdateMe();
  useEffect(() => setName(user?.full_name ?? ''), [user?.full_name]);

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t('settings.title')} />
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <CardTitle icon={UserIcon} title={t('settings.profile')} />
          <Text style={styles.label}>{t('settings.name')}</Text>
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
          {updateMe.isError ? <Banner tone="danger" text={friendlyError(updateMe.error, t, 'command')} /> : null}
          {nameSaved ? <Banner tone="info" text={t('settings.nameSaved')} testID="name-saved" /> : null}
          <View style={styles.gap}>
            <BigActionButton
              testID="save-name"
              label={t('common.save')}
              onPress={saveName}
              loading={updateMe.isPending}
              disabled={!online || !name.trim() || name.trim() === user?.full_name}
            />
          </View>
          <Text style={[styles.label, { marginTop: space.lg }]}>{t('settings.mobile')}</Text>
          <Text style={styles.readonly}>{user?.phone_number ?? '—'}</Text>
        </Card>

        <Card style={styles.rows}>
          <Row
            icon={Languages}
            title={t('settings.language')}
            hint={t('settings.languageHint')}
            value={languageInfo(i18n.language).native}
            onPress={() => router.push({ pathname: '/language', params: { mode: 'change' } })}
            testID="open-language"
          />
          <View style={styles.divider} />
          <Row
            icon={Droplets}
            title={t('settings.managePumps')}
            hint={t('settings.managePumpsHint')}
            onPress={() => router.push('/manage')}
            testID="open-manage"
          />
        </Card>

        <Card>
          <CardTitle icon={Smartphone} title={t('settings.sessions')} />
          {sessions.isLoading && !sessions.data ? <Text style={styles.rowHint}>{t('common.loading')}</Text> : null}
          {(sessions.data?.sessions ?? []).map((s) => {
            const mine = s.app_install_id === installId;
            return (
              <View key={s.family_id} style={styles.session} testID={`session-${s.family_id}`}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>
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
          {sessions.data && others.length === 0 ? (
            <Text style={styles.rowHint}>{t('settings.noOtherSessions')}</Text>
          ) : null}
        </Card>

        <Card>
          <CardTitle icon={Download} title={t('settings.data')} />
          <Text style={styles.rowHint}>{t('settings.exportHint')}</Text>
          {exportError ? <Banner tone="danger" text={t('settings.exportFailed')} /> : null}
          <View style={styles.gap}>
            <BigActionButton
              testID="export-data"
              tone="neutral"
              icon={Download}
              label={t('settings.export')}
              onPress={doExport}
              loading={exporting}
              disabled={!online}
            />
          </View>
          <Text style={[styles.rowHint, { marginTop: space.lg }]}>{t('settings.deleteHint')}</Text>
          {pending ? (
            <Banner
              tone="info"
              text={t('settings.deletePending', { date: formatDate(i18n.language, pending.requested_at) })}
              testID="deletion-pending"
            />
          ) : (
            <View style={styles.gap}>
              <BigActionButton
                testID="delete-data"
                tone="neutral"
                icon={Trash2}
                label={t('settings.delete')}
                onPress={() => setConfirmDelete(true)}
                disabled={!online}
              />
            </View>
          )}
          {requestDeletion.isError ? (
            <Banner tone="danger" text={friendlyError(requestDeletion.error, t, 'command')} />
          ) : null}
        </Card>

        <BigActionButton
          testID="logout"
          tone="danger"
          icon={LogOut}
          label={t('settings.logout')}
          onPress={() => setConfirmLogout(true)}
        />
        <Text style={styles.version}>{t('settings.version', { version: pkg.version })}</Text>
      </ScrollView>

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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  content: { padding: space.lg, gap: space.lg, backgroundColor: colors.bg, paddingBottom: 40 },
  label: { color: colors.textMuted, fontSize: font.body, fontWeight: '700', marginBottom: 6 },
  input: {
    minHeight: TOUCH,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: font.bodyLg,
    fontWeight: '700',
    backgroundColor: colors.surface,
  },
  readonly: { color: colors.text, fontSize: font.bodyLg, fontWeight: '700' },
  gap: { marginTop: space.md },
  rows: { padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: TOUCH + 16,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: font.bodyLg, fontWeight: '800' },
  rowHint: { color: colors.textMuted, fontSize: font.body, lineHeight: 22 },
  rowValue: { color: colors.primary, fontSize: font.body, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.border },
  session: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  signOut: { minHeight: TOUCH - 12, justifyContent: 'center', paddingHorizontal: 10 },
  signOutText: { color: colors.danger, fontSize: font.body, fontWeight: '900' },
  version: { color: colors.textFaint, fontSize: font.caption + 1, textAlign: 'center' },
});
