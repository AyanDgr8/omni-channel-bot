import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Platform,
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

const STATUS_COLORS: Record<string, string> = {};
const DIRECTION_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  INBOUND: 'phone-incoming',
  OUTBOUND: 'phone-outgoing',
};

interface CallItemProps {
  call: Call;
  onHangup: (id: string) => void;
  isHanging: boolean;
}

function CallItem({ call, onHangup, isHanging }: CallItemProps) {
  const colors = useColors();
  const isLive = call.status === 'IN_PROGRESS' || call.status === 'RINGING';
  const isInbound = call.direction === 'INBOUND';

  const statusColor =
    call.status === 'COMPLETED'
      ? colors.accent
      : call.status === 'FAILED'
      ? colors.destructive
      : isLive
      ? colors.primary
      : colors.mutedForeground;

  const caller =
    call.customerName ?? call.customerNumber ?? 'Unknown caller';

  return (
    <View
      style={[
        styles.callRow,
        {
          backgroundColor: colors.card,
          borderColor: isLive ? colors.primary + '40' : colors.border,
          borderWidth: isLive ? 1 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      {/* Direction icon */}
      <View
        style={[
          styles.directionBadge,
          {
            backgroundColor: isInbound
              ? colors.accent + '1a'
              : colors.primary + '1a',
          },
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
        <Text
          style={[styles.callerName, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {caller}
        </Text>
        <View style={styles.callMeta}>
          <View
            style={[styles.statusDot, { backgroundColor: statusColor }]}
          />
          <Text style={[styles.statusText, { color: statusColor }]}>
            {call.status.replace('_', ' ')}
          </Text>
          <Text style={[styles.metaDivider, { color: colors.border }]}>
            ·
          </Text>
          <Text
            style={[styles.metaText, { color: colors.mutedForeground }]}
          >
            {formatDuration(call.durationSeconds)}
          </Text>
        </View>
      </View>

      {/* Right side */}
      <View style={styles.callRight}>
        <Text style={[styles.callTime, { color: colors.mutedForeground }]}>
          {formatTime(call.createdAt)}
        </Text>
        {isLive && (
          <TouchableOpacity
            style={[
              styles.hangupBtn,
              { backgroundColor: colors.destructive + '1a' },
            ]}
            onPress={() => onHangup(call.id)}
            disabled={isHanging}
          >
            <Feather
              name="phone-off"
              size={15}
              color={colors.destructive}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 84 : 80 + insets.bottom;
  const queryClient = useQueryClient();

  const [hangingId, setHangingId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useListCalls({
    limit: 50,
  });

  const { mutate: hangup } = useHangupCall({
    mutation: {
      onMutate: ({ id }) => setHangingId(id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/v1/calls'] });
      },
      onSettled: () => setHangingId(null),
    },
  });

  const handleHangup = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Hang Up Call', 'End this call now?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Hang Up',
        style: 'destructive',
        onPress: () => hangup({ id }),
      },
    ]);
  };

  const calls = data?.calls ?? [];
  const total = data?.total ?? 0;

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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Call Log
        </Text>
        {total > 0 && (
          <View
            style={[styles.countBadge, { backgroundColor: colors.muted }]}
          >
            <Text
              style={[styles.countText, { color: colors.mutedForeground }]}
            >
              {total}
            </Text>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <View
            style={[
              styles.loadingDot,
              { backgroundColor: colors.primary },
            ]}
          />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Could not load calls
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={() => refetch()}
          >
            <Text
              style={[styles.retryText, { color: colors.primaryForeground }]}
            >
              Retry
            </Text>
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
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                No calls yet
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

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
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  list: { padding: 12, gap: 8 },
  listEmpty: { flex: 1 },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
  },
  directionBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callInfo: { flex: 1, gap: 4 },
  callerName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  metaDivider: { fontSize: 12 },
  metaText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  callRight: { alignItems: 'flex-end', gap: 6 },
  callTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  hangupBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 300,
  },
  loadingDot: { width: 8, height: 8, borderRadius: 4 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
