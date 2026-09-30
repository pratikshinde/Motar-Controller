import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Droplets, FolderPlus, Pencil, Trash2 } from 'lucide-react-native';
import {
  createSite,
  deleteSite,
  getListPumpsQueryKey,
  getListSitesQueryKey,
  updatePumpSettings,
  updateSite,
  useListPumps,
  useListSites,
} from '@/api/generated/farmer';
import type { PumpResponse, SiteOut } from '@/api/generated/model';
import { colors, font, radius, space, TOUCH } from '@/shared/theme';
import { Banner } from '@/shared/ui/Banner';
import { BigActionButton } from '@/shared/ui/BigActionButton';
import { Card, CardTitle } from '@/shared/ui/Card';
import { ConfirmSheet } from '@/shared/ui/ConfirmSheet';
import { OfflineBanner } from '@/shared/ui/OfflineBanner';
import { ScreenHeader } from '@/shared/ui/ScreenHeader';
import { StateView } from '@/shared/ui/StateView';
import { friendlyError } from '@/shared/i18n/errors';
import { useOnline } from '@/shared/hooks/useOnline';
import { useStatusBar } from '@/shared/hooks/useStatusBar';
import { displayName } from '@/features/pumps/model';

const Chip: React.FC<{ label: string; on: boolean; onPress: () => void; testID?: string }> = ({
  label,
  on,
  onPress,
  testID,
}) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.chip, on && styles.chipOn]}
    accessibilityRole="button"
    accessibilityState={{ selected: on }}
    activeOpacity={0.8}
    testID={testID}
  >
    <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
  </TouchableOpacity>
);

const IconButton: React.FC<{
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}> = ({ icon: Icon, label, onPress, disabled, testID }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={[styles.iconBtn, disabled && { opacity: 0.35 }]}
    accessibilityRole="button"
    accessibilityLabel={label}
    activeOpacity={0.7}
    testID={testID}
  >
    <Icon size={22} color={colors.primary} />
  </TouchableOpacity>
);

/** Rename pumps, put them in the order the farmer wants, and gather them into groups such as "North field". */
export const ManageScreen: React.FC = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const online = useOnline();
  const pumpsQ = useListPumps();
  const sitesQ = useListSites();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [nameEmpty, setNameEmpty] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  const [renamingGroup, setRenamingGroup] = useState<{ id: string; value: string } | null>(null);
  const [deleting, setDeleting] = useState<SiteOut | null>(null);
  useStatusBar('light');

  const pumps = pumpsQ.data?.pumps ?? [];
  const sites = sitesQ.data?.sites ?? [];

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListPumpsQueryKey() }),
        qc.invalidateQueries({ queryKey: getListSitesQueryKey() }),
      ]);
      setBusy(false);
    }
  };

  // The server treats an empty string as "clear this".
  const saveName = (p: PumpResponse, value: string) =>
    run(async () => {
      await updatePumpSettings(p.id, { nickname: value.trim() === p.name ? '' : value.trim() });
      setRenaming(null);
    });

  const setGroup = (p: PumpResponse, siteId: string | null) =>
    run(() => updatePumpSettings(p.id, { site_id: siteId ?? '' }));

  const move = (index: number, delta: -1 | 1) =>
    run(async () => {
      const order = pumps.map((p) => p.id);
      const target = index + delta;
      if (target < 0 || target >= order.length) return;
      [order[index], order[target]] = [order[target], order[index]];
      // Write the whole order so ties (every pump starts at 0) are settled once and for all.
      await Promise.all(
        order.map((id, i) =>
          pumps.find((p) => p.id === id)?.sort_order === i ? null : updatePumpSettings(id, { sort_order: i }),
        ),
      );
    });

  const addGroup = () => {
    const name = newGroup.trim();
    if (!name) return;
    void run(async () => {
      await createSite({ name });
      setNewGroup('');
    });
  };

  if ((pumpsQ.isLoading && !pumpsQ.data) || (sitesQ.isLoading && !sitesQ.data)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScreenHeader title={t('manage.title')} onBack={() => router.back()} backLabel={t('common.back')} />
        <StateView kind="loading" title={t('common.loading')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader
        title={t('manage.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backLabel={t('common.back')}
      />
      <OfflineBanner />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <Banner tone="danger" text={friendlyError(error, t, 'command')} testID="manage-error" /> : null}

        <Card>
          <CardTitle icon={Droplets} title={t('manage.pumps')} />
          {pumps.length === 0 ? <Text style={styles.hint}>{t('manage.empty')}</Text> : null}
          {pumps.map((p, i) => {
            const editing = renaming?.id === p.id;
            return (
              <View key={p.id} style={styles.pump} testID={`manage-pump-${p.id}`}>
                <View style={styles.pumpHead}>
                  {editing ? (
                    <TextInput
                      testID={`rename-input-${p.id}`}
                      style={styles.input}
                      value={renaming.value}
                      onChangeText={(v) => {
                        setRenaming({ id: p.id, value: v });
                        setNameEmpty(false);
                      }}
                      placeholder={t('manage.namePlaceholder')}
                      maxLength={100}
                      autoFocus
                      accessibilityLabel={t('manage.namePlaceholder')}
                    />
                  ) : (
                    <View style={styles.nameBox}>
                      <Text style={styles.pumpName}>{displayName(p)}</Text>
                      {p.nickname ? (
                        <Text style={styles.hint}>{t('manage.originalName', { name: p.name })}</Text>
                      ) : null}
                    </View>
                  )}
                  <View style={styles.moves}>
                    <IconButton
                      icon={ArrowUp}
                      label={t('manage.moveUp')}
                      onPress={() => void move(i, -1)}
                      disabled={busy || !online || i === 0}
                      testID={`up-${p.id}`}
                    />
                    <IconButton
                      icon={ArrowDown}
                      label={t('manage.moveDown')}
                      onPress={() => void move(i, 1)}
                      disabled={busy || !online || i === pumps.length - 1}
                      testID={`down-${p.id}`}
                    />
                  </View>
                </View>

                {editing && nameEmpty ? <Banner tone="warn" text={t('manage.nameEmpty')} testID="name-empty" /> : null}
                {editing ? (
                  <View style={styles.editActions}>
                    <BigActionButton
                      label={t('common.save')}
                      onPress={() => (renaming.value.trim() ? void saveName(p, renaming.value) : setNameEmpty(true))}
                      loading={busy}
                      testID={`save-name-${p.id}`}
                    />
                    <BigActionButton
                      label={t('common.cancel')}
                      tone="neutral"
                      onPress={() => setRenaming(null)}
                      disabled={busy}
                    />
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.rename}
                    onPress={() => setRenaming({ id: p.id, value: displayName(p) })}
                    accessibilityRole="button"
                    testID={`rename-${p.id}`}
                  >
                    <Pencil size={18} color={colors.primary} />
                    <Text style={styles.renameText}>{t('manage.rename')}</Text>
                  </TouchableOpacity>
                )}

                <Text style={styles.groupLabel}>{t('manage.group')}</Text>
                <View style={styles.chips}>
                  <Chip
                    label={t('manage.noGroup')}
                    on={!p.site_id}
                    onPress={() => void setGroup(p, null)}
                    testID={`group-none-${p.id}`}
                  />
                  {sites.map((s) => (
                    <Chip
                      key={s.id}
                      label={s.name}
                      on={p.site_id === s.id}
                      onPress={() => void setGroup(p, s.id)}
                      testID={`group-${s.id}-${p.id}`}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </Card>

        <Card>
          <CardTitle icon={FolderPlus} title={t('manage.groups')} />
          {sites.map((s) => {
            const editing = renamingGroup?.id === s.id;
            return (
              <View key={s.id} style={styles.site} testID={`site-${s.id}`}>
                {editing ? (
                  <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={renamingGroup.value}
                    onChangeText={(v) => setRenamingGroup({ id: s.id, value: v })}
                    maxLength={100}
                    autoFocus
                    accessibilityLabel={t('manage.renameGroup')}
                  />
                ) : (
                  <View style={styles.nameBox}>
                    <Text style={styles.pumpName}>{s.name}</Text>
                    <Text style={styles.hint}>{t('manage.groupPumps', { count: s.pump_count ?? 0 })}</Text>
                  </View>
                )}
                {editing ? (
                  <IconButton
                    icon={Pencil}
                    label={t('common.save')}
                    onPress={() =>
                      renamingGroup.value.trim() &&
                      void run(async () => {
                        await updateSite(s.id, { name: renamingGroup.value.trim() });
                        setRenamingGroup(null);
                      })
                    }
                    testID={`save-site-${s.id}`}
                  />
                ) : (
                  <IconButton
                    icon={Pencil}
                    label={t('manage.renameGroup')}
                    onPress={() => setRenamingGroup({ id: s.id, value: s.name })}
                    disabled={busy || !online}
                    testID={`rename-site-${s.id}`}
                  />
                )}
                <IconButton
                  icon={Trash2}
                  label={t('manage.deleteGroup')}
                  onPress={() => setDeleting(s)}
                  disabled={busy || !online}
                  testID={`delete-site-${s.id}`}
                />
              </View>
            );
          })}
          <Text style={[styles.groupLabel, { marginTop: space.md }]}>{t('manage.newGroup')}</Text>
          <TextInput
            testID="new-group"
            style={styles.input}
            value={newGroup}
            onChangeText={setNewGroup}
            placeholder={t('manage.groupPlaceholder')}
            placeholderTextColor={colors.textFaint}
            maxLength={100}
            accessibilityLabel={t('manage.newGroup')}
          />
          <View style={{ marginTop: space.md }}>
            <BigActionButton
              label={t('manage.createGroup')}
              onPress={addGroup}
              disabled={busy || !online || !newGroup.trim()}
              testID="create-group"
            />
          </View>
        </Card>
      </ScrollView>

      <ConfirmSheet
        visible={deleting !== null}
        title={t('manage.deleteGroupTitle')}
        message={deleting ? `${deleting.name}\n\n${t('manage.deleteGroupBody')}` : undefined}
        confirmLabel={t('manage.deleteGroup')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busy={busy}
        onConfirm={() => {
          const s = deleting;
          setDeleting(null);
          if (s) void run(() => deleteSite(s.id));
        }}
        onCancel={() => setDeleting(null)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  content: { padding: space.lg, gap: space.lg, backgroundColor: colors.bg, paddingBottom: 40 },
  hint: { color: colors.textMuted, fontSize: font.body },
  pump: { gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  pumpHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameBox: { flex: 1, gap: 2 },
  pumpName: { color: colors.text, fontSize: font.bodyLg, fontWeight: '900' },
  moves: { flexDirection: 'row', gap: 6 },
  iconBtn: {
    width: TOUCH - 8,
    height: TOUCH - 8,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
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
  editActions: { gap: 8 },
  rename: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TOUCH - 12, alignSelf: 'flex-start' },
  renameText: { color: colors.primary, fontSize: font.body, fontWeight: '800' },
  groupLabel: { color: colors.textMuted, fontSize: font.body, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: TOUCH - 12,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: font.body, fontWeight: '800' },
  chipTextOn: { color: colors.textOnPrimary },
  site: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
