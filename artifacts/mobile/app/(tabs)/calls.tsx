import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Platform,
  Modal,
  ScrollView,
  TextInput,
  Linking,
} from 'react-native';
import {
  useListCalls,
  useHangupCall,
  type Call,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '--';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const DIRECTION_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  INBOUND: 'phone-incoming',
  OUTBOUND: 'phone-outgoing',
};

type DirectionFilter = 'ALL' | 'INBOUND' | 'OUTBOUND';
type StatusFilter = 'ALL' | 'LIVE' | 'COMPLETED' | 'FAILED';

// ─── Call Detail Modal ────────────────────────────────────────────────────────

function CallDetailModal({ call, onClose }: { call: Call | null; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  if (!call) return null;

  const isLive = call.status === 'IN_PROGRESS' || call.status === 'RINGING';
  const isInbound = call.direction === 'INBOUND';

  const statusColor =
    call.status === 'COMPLETED' ? colors.accent :
    call.status === 'FAILED'    ? colors.destructive :
    isLive                      ? colors.primary :
    colors.mutedForeground;

  const detail = call as any;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[detailStyles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom + 24 }]}>
        {/* Header */}
        <View style={[detailStyles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <View style={detailStyles.headerLeft}>
            <View style={[detailStyles.dirIcon, { backgroundColor: isInbound ? colors.accent + '1a' : colors.primary + '1a' }]}>
              <Feather name={DIRECTION_ICONS[call.direction] ?? 'phone'} size={18} color={isInbound ? colors.accent : colors.primary} />
            </View>
            <View>
              <Text style={[detailStyles.caller, { color: colors.foreground }]} numberOfLines={1}>
                {call.customerName ?? call.customerNumber ?? 'Unknown Caller'}
              </Text>
              <View style={[detailStyles.statusRow]}>
                <View style={[detailStyles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[detailStyles.statusText, { color: statusColor }]}>
                  {call.status.replace('_', ' ')}
                </Text>
              </View>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} style={[detailStyles.closeBtn, { backgroundColor: colors.muted }]}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={detailStyles.body}>
          {/* Call Stats */}
          <View style={[detailStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[detailStyles.sectionTitle, { color: colors.mutedForeground }]}>CALL DETAILS</Text>
            {[
              { label: 'Direction', value: call.direction },
              { label: 'Duration', value: formatDuration(call.durationSeconds) },
              { label: 'Started', value: formatDateTime(call.startedAt) },
              { label: 'Ended', value: formatDateTime(call.endedAt) },
              { label: 'Hangup Reason', value: detail.finalDisposition ?? call.hangupReason ?? '—' },
              { label: 'Language', value: call.languageDetected?.toUpperCase() ?? '—' },
              { label: 'Connect Outcome', value: detail.connectOutcome ?? call.amdResult ?? '—' },
              { label: 'Interruptions', value: detail.interruptionCount != null ? String(detail.interruptionCount) : '—' },
              { label: 'Escalations', value: detail.escalationCount != null ? String(detail.escalationCount) : '—' },
              { label: 'Persona', value: detail.personaName ?? (detail.personaId ? 'Active' : '—') },
            ].map(({ label, value }) => (
              <View key={label} style={[detailStyles.row, { borderBottomColor: colors.border }]}>
                <Text style={[detailStyles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <Text style={[detailStyles.rowValue, { color: colors.foreground }]} numberOfLines={1}>{value}</Text>
              </View>
            ))}
          </View>

          {/* Transcript / Summary */}
          <View style={[detailStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[detailStyles.sectionTitle, { color: colors.mutedForeground }]}>TRANSCRIPT / SUMMARY</Text>
            {call.summary ? (
              <Text style={[detailStyles.transcript, { color: colors.foreground }]}>{call.summary}</Text>
            ) : (
              <View style={detailStyles.emptySection}>
                <Feather name="file-text" size={24} color={colors.muted} />
                <Text style={[detailStyles.emptyText, { color: colors.mutedForeground }]}>
                  No transcript available
                </Text>
                <Text style={[detailStyles.emptyHint, { color: colors.mutedForeground }]}>
                  Transcripts appear here once the call is processed.
                </Text>
              </View>
            )}
          </View>

          {/* Recording */}
          <View style={[detailStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[detailStyles.sectionTitle, { color: colors.mutedForeground }]}>RECORDING</Text>
            {call.recordingUrl ? (
              <TouchableOpacity
                style={[detailStyles.playBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}
                onPress={() => Linking.openURL(call.recordingUrl!)}
              >
                <Feather name="play-circle" size={20} color={colors.primary} />
                <Text style={[detailStyles.playBtnText, { color: colors.primary }]}>Play Recording</Text>
                <Feather name="external-link" size={14} color={colors.primary + 'aa'} />
              </TouchableOpacity>
            ) : (
              <View style={detailStyles.emptySection}>
                <Feather name="mic-off" size={24} color={colors.muted} />
                <Text style={[detailStyles.emptyText, { color: colors.mutedForeground }]}>
                  No recording available
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Call Row ────────────────────────────────────────────────────────────────

interface CallItemProps {
  call: Call;
  onHangup: (id: string) => void;
  onPress: (call: Call) => void;
  isHanging: boolean;
}

function CallItem({ call, onHangup, onPress, isHanging }: CallItemProps) {
  const colors = useColors();
  const isLive = call.status === 'IN_PROGRESS' || call.status === 'RINGING';
  const isInbound = call.direction === 'INBOUND';

  const statusColor =
    call.status === 'COMPLETED' ? colors.accent :
    call.status === 'FAILED'    ? colors.destructive :
    isLive                      ? colors.primary :
    colors.mutedForeground;

  const caller = call.customerName ?? call.customerNumber ?? 'Unknown caller';
  const detail = call as any;

  return (
    <TouchableOpacity
      style={[
        styles.callRow,
        {
          backgroundColor: colors.card,
          borderColor: isLive ? colors.primary + '40' : colors.border,
          borderWidth: isLive ? 1 : StyleSheet.hairlineWidth,
        },
      ]}
      onPress={() => onPress(call)}
      activeOpacity={0.7}
    >
      {/* Direction icon */}
      <View
        style={[
          styles.directionBadge,
          { backgroundColor: isInbound ? colors.accent + '1a' : colors.primary + '1a' },
        ]}
      >
        <Feather
          name={DIRECTION_ICONS[call.direction] ?? 'phone'}
          size={16}
          color={isInbound ? colors.accent : colors.primary}
        />
      </View>

      {/* Call info */}
      <View style={styles.callInfo}>
        <Text style={[styles.callerName, { color: colors.foreground }]} numberOfLines={1}>
          {caller}
        </Text>
        <View style={styles.callMeta}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {call.status.replace('_', ' ')}
          </Text>
          <Text style={[styles.metaDivider, { color: colors.border }]}>·</Text>
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {formatDuration(call.durationSeconds)}
          </Text>
          {detail.personaName ? (
            <>
              <Text style={[styles.metaDivider, { color: colors.border }]}>·</Text>
              <Feather name="user" size={10} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.primary }]} numberOfLines={1}>
                {detail.personaName}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      {/* Right side */}
      <View style={styles.callRight}>
        <Text style={[styles.callTime, { color: colors.mutedForeground }]}>
          {formatTime(call.createdAt)}
        </Text>
        {isLive ? (
          <TouchableOpacity
            style={[styles.hangupBtn, { backgroundColor: colors.destructive + '1a' }]}
            onPress={() => onHangup(call.id)}
            disabled={isHanging}
          >
            <Feather name="phone-off" size={15} color={colors.destructive} />
          </TouchableOpacity>
        ) : (
          <Feather name="chevron-right" size={14} color={colors.mutedForeground + '80'} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Filter Bar ──────────────────────────────────────────────────────────────

function FilterBar({
  direction, onDirection,
  status, onStatus,
  search, onSearch,
}: {
  direction: DirectionFilter; onDirection: (v: DirectionFilter) => void;
  status: StatusFilter; onStatus: (v: StatusFilter) => void;
  search: string; onSearch: (v: string) => void;
}) {
  const colors = useColors();

  const dirOptions: { label: string; value: DirectionFilter }[] = [
    { label: 'All', value: 'ALL' },
    { label: '↙ In', value: 'INBOUND' },
    { label: '↗ Out', value: 'OUTBOUND' },
  ];
  const statusOptions: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: 'ALL' },
    { label: 'Live', value: 'LIVE' },
    { label: 'Done', value: 'COMPLETED' },
    { label: 'Failed', value: 'FAILED' },
  ];

  return (
    <View style={[filterStyles.wrapper, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
      {/* Search */}
      <View style={[filterStyles.searchRow, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name="search" size={14} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={onSearch}
          placeholder="Search caller…"
          placeholderTextColor={colors.mutedForeground}
          style={[filterStyles.searchInput, { color: colors.foreground }]}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => onSearch('')}>
            <Feather name="x-circle" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* Direction + Status chips */}
      <View style={filterStyles.chipRow}>
        {dirOptions.map((opt) => {
          const active = direction === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => onDirection(opt.value)}
              style={[
                filterStyles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[filterStyles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View style={[filterStyles.chipDivider, { backgroundColor: colors.border }]} />
        {statusOptions.map((opt) => {
          const active = status === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => onStatus(opt.value)}
              style={[
                filterStyles.chip,
                {
                  backgroundColor: active ? colors.primary : colors.muted,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[filterStyles.chipText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 84 : 80 + insets.bottom;
  const queryClient = useQueryClient();

  const [hangingId, setHangingId] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, refetch, isFetching } = useListCalls({ limit: 100 });

  const { mutate: hangup } = useHangupCall({
    mutation: {
      onMutate: ({ id }) => setHangingId(id),
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/v1/calls'] }); },
      onSettled: () => setHangingId(null),
    },
  });

  const handleHangup = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Hang Up Call', 'End this call now?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Hang Up', style: 'destructive', onPress: () => hangup({ id }) },
    ]);
  };

  const allCalls = data?.calls ?? [];
  const total = data?.total ?? 0;

  // Client-side filtering
  const calls = useMemo(() => {
    let filtered = allCalls;
    if (directionFilter !== 'ALL') {
      filtered = filtered.filter((c) => c.direction === directionFilter);
    }
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'LIVE') {
        filtered = filtered.filter((c) => c.status === 'IN_PROGRESS' || c.status === 'RINGING' || c.status === 'INITIATING');
      } else {
        filtered = filtered.filter((c) => c.status === statusFilter);
      }
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.customerName?.toLowerCase().includes(q) ||
          c.customerNumber?.toLowerCase().includes(q) ||
          (c as any).personaName?.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allCalls, directionFilter, statusFilter, search]);

  const hasFilters = directionFilter !== 'ALL' || statusFilter !== 'ALL' || search.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Call Log</Text>
        {total > 0 && (
          <View style={[styles.countBadge, { backgroundColor: colors.muted }]}>
            <Text style={[styles.countText, { color: colors.mutedForeground }]}>{total}</Text>
          </View>
        )}
        {hasFilters && (
          <View style={[styles.countBadge, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.countText, { color: colors.primary }]}>{calls.length} shown</Text>
          </View>
        )}
      </View>

      {/* Filters */}
      <FilterBar
        direction={directionFilter} onDirection={setDirectionFilter}
        status={statusFilter} onStatus={setStatusFilter}
        search={search} onSearch={setSearch}
      />

      {isLoading ? (
        <View style={styles.centered}>
          <View style={[styles.loadingDot, { backgroundColor: colors.primary }]} />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Could not load calls</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => refetch()}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CallItem
              call={item}
              onHangup={handleHangup}
              onPress={setSelectedCall}
              isHanging={hangingId === item.id}
            />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPadding },
            calls.length === 0 && styles.listEmpty,
          ]}
          scrollEnabled={calls.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Feather name="phone-missed" size={40} color={colors.muted} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {hasFilters ? 'No calls match your filters' : 'No calls yet'}
              </Text>
              {hasFilters && (
                <TouchableOpacity
                  onPress={() => { setDirectionFilter('ALL'); setStatusFilter('ALL'); setSearch(''); }}
                  style={[styles.retryBtn, { backgroundColor: colors.muted }]}
                >
                  <Text style={[styles.retryText, { color: colors.mutedForeground }]}>Clear Filters</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Call Detail Modal */}
      <CallDetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  list: { padding: 12, gap: 8 },
  listEmpty: { flex: 1 },
  callRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10,
  },
  directionBadge: {
    width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },
  callInfo: { flex: 1, gap: 4 },
  callerName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  metaDivider: { fontSize: 12 },
  metaText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  callRight: { alignItems: 'flex-end', gap: 6 },
  callTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  hangupBtn: { width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 300 },
  loadingDot: { width: 8, height: 8, borderRadius: 4 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, marginTop: 4 },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});

const filterStyles = StyleSheet.create({
  wrapper: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', padding: 0 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1,
  },
  chipText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  chipDivider: { width: 1, height: 14, marginHorizontal: 2 },
});

const detailStyles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  dirIcon: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  caller: { fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 16 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sectionTitle: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, padding: 12, paddingBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },
  rowValue: { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1, textAlign: 'right' },
  transcript: { padding: 12, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  emptySection: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  emptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 24 },
  playBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 12, padding: 14, borderRadius: 10, borderWidth: 1,
  },
  playBtnText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
