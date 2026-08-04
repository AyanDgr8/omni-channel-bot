import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useGetStatsOverview } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

interface KpiCardProps {
  label: string;
  value: string;
  icon: keyof typeof Feather.glyphMap;
  accent?: boolean;
  alert?: boolean;
}

function KpiCard({ label, value, icon, accent, alert }: KpiCardProps) {
  const colors = useColors();
  const iconColor = alert
    ? colors.destructive
    : accent
    ? colors.accent
    : colors.primary;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.cardIconWrapper,
          { backgroundColor: iconColor + '1a' },
        ]}
      >
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <Text
        style={[styles.cardValue, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text style={[styles.cardLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

function SkeletonCard() {
  const colors = useColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.skeletonIcon, { backgroundColor: colors.muted }]}
      />
      <View
        style={[
          styles.skeletonValue,
          { backgroundColor: colors.muted },
        ]}
      />
      <View
        style={[
          styles.skeletonLabel,
          { backgroundColor: colors.muted },
        ]}
      />
    </View>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 84 : 80 + insets.bottom;

  const { data: stats, isLoading, isError, refetch, isFetching } =
    useGetStatsOverview();

  const formatRate = (v: number) => `${Math.round(v)}%`;
  const formatDuration = (v: number) => {
    if (v < 60) return `${Math.round(v)}s`;
    return `${Math.round(v / 60)}m`;
  };

  const kpis: KpiCardProps[] = stats
    ? [
        {
          label: 'Total Calls',
          value: stats.totalCalls.toLocaleString(),
          icon: 'phone',
        },
        {
          label: 'Active Now',
          value: String(stats.activeCalls),
          icon: 'activity',
          accent: stats.activeCalls > 0,
        },
        {
          label: 'Completed Today',
          value: stats.completedToday.toLocaleString(),
          icon: 'check-circle',
        },
        {
          label: 'Success Rate',
          value: formatRate(stats.successRate),
          icon: 'trending-up',
          accent: stats.successRate >= 80,
          alert: stats.successRate < 50,
        },
        {
          label: 'Avg Duration',
          value: formatDuration(stats.avgDurationSeconds),
          icon: 'clock',
        },
        {
          label: 'AMD Accuracy',
          value: formatRate(stats.amdAccuracy),
          icon: 'cpu',
        },
        {
          label: 'Memory Hit Rate',
          value: formatRate(stats.memoryHitRate),
          icon: 'database',
          accent: stats.memoryHitRate >= 70,
        },
        {
          label: 'Bots Online',
          value: String(stats.totalBots),
          icon: 'radio',
        },
      ]
    : [];

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
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.logoMark,
              { backgroundColor: colors.primary },
            ]}
          />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            VoxAgent
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => refetch()}
          style={styles.refreshBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather
            name="refresh-cw"
            size={20}
            color={isFetching ? colors.primary : colors.mutedForeground}
          />
        </TouchableOpacity>
      </View>

      {isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            Could not load stats
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={() => refetch()}
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: bottomPadding },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            OVERVIEW
          </Text>
          {isLoading ? (
            <View style={styles.cardGrid}>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </View>
          ) : (
            <View style={styles.cardGrid}>
              {kpis.map((kpi) => (
                <KpiCard key={kpi.label} {...kpi} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoMark: { width: 8, height: 8, borderRadius: 4 },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  refreshBtn: { padding: 2 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.2,
    marginBottom: 12,
    marginTop: 20,
    marginHorizontal: 20,
  },
  grid: { paddingHorizontal: 16 },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    flex: 1,
    minWidth: '45%',
    maxWidth: '50%',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 6,
  },
  cardIconWrapper: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  cardValue: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  cardLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  skeletonIcon: { width: 34, height: 34, borderRadius: 8 },
  skeletonValue: { height: 30, borderRadius: 6, width: '60%' },
  skeletonLabel: { height: 12, borderRadius: 4, width: '80%' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
