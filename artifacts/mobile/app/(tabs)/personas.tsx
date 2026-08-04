import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Platform,
  Alert,
} from 'react-native';
import {
  useListPersonas,
  useActivatePersona,
  type PersonaSummary,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface PersonaCardProps {
  persona: PersonaSummary;
  onActivate: (id: string) => void;
  isActivating: boolean;
}

function PersonaCard({ persona, onActivate, isActivating }: PersonaCardProps) {
  const colors = useColors();
  const isActive = persona.isActive;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isActive ? colors.accent : colors.border,
          borderWidth: isActive ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      {/* Top row: name + active badge */}
      <View style={styles.cardHeader}>
        <View style={styles.cardAvatarWrapper}>
          <View
            style={[
              styles.cardAvatar,
              {
                backgroundColor: isActive
                  ? colors.accent + '20'
                  : colors.muted,
              },
            ]}
          >
            <Feather
              name="user"
              size={20}
              color={isActive ? colors.accent : colors.mutedForeground}
            />
          </View>
        </View>

        <View style={styles.cardNameBlock}>
          <Text
            style={[styles.personaName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {persona.name}
          </Text>
          <View style={styles.badgeRow}>
            {isActive && (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.accent + '20' },
                ]}
              >
                <View
                  style={[styles.activeDot, { backgroundColor: colors.accent }]}
                />
                <Text style={[styles.badgeText, { color: colors.accent }]}>
                  Active
                </Text>
              </View>
            )}
            {persona.hasTraits && (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.primary + '15' },
                ]}
              >
                <Text
                  style={[styles.badgeText, { color: colors.primary }]}
                >
                  v{persona.traitsVersion ?? 1}
                </Text>
              </View>
            )}
            <View
              style={[
                styles.badge,
                { backgroundColor: colors.muted },
              ]}
            >
              <Text
                style={[styles.badgeText, { color: colors.mutedForeground }]}
              >
                {persona.source.replace('_', ' ')}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Description */}
      {!!persona.description && (
        <Text
          style={[styles.description, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {persona.description}
        </Text>
      )}

      {/* Activate button */}
      {!isActive && (
        <TouchableOpacity
          style={[
            styles.activateBtn,
            {
              backgroundColor: colors.primary + '15',
              borderColor: colors.primary + '30',
            },
          ]}
          onPress={() => onActivate(persona.id)}
          disabled={isActivating}
        >
          <Feather name="zap" size={14} color={colors.primary} />
          <Text style={[styles.activateBtnText, { color: colors.primary }]}>
            {isActivating ? 'Activating…' : 'Activate'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function PersonasScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 84 : 80 + insets.bottom;
  const queryClient = useQueryClient();

  const [activatingId, setActivatingId] = React.useState<string | null>(null);

  const { data: personas, isLoading, isError, refetch, isFetching } =
    useListPersonas();

  const { mutate: activatePersona } = useActivatePersona({
    mutation: {
      onMutate: ({ id }) => setActivatingId(id),
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: ['/api/v1/personas'] });
      },
      onError: () => {
        Alert.alert('Error', 'Failed to activate persona');
      },
      onSettled: () => setActivatingId(null),
    },
  });

  const handleActivate = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    activatePersona({ id });
  };

  const list = personas ?? [];
  const activePersona = list.find((p) => p.isActive);

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
          Personas
        </Text>
        {list.length > 0 && (
          <View
            style={[styles.countBadge, { backgroundColor: colors.muted }]}
          >
            <Text
              style={[styles.countText, { color: colors.mutedForeground }]}
            >
              {list.length}
            </Text>
          </View>
        )}
      </View>

      {/* Active persona banner */}
      {activePersona && !isLoading && (
        <View
          style={[
            styles.activeBanner,
            { backgroundColor: colors.accent + '12', borderColor: colors.accent + '30' },
          ]}
        >
          <Feather name="zap" size={14} color={colors.accent} />
          <Text style={[styles.activeBannerText, { color: colors.accent }]}>
            Active persona:{' '}
            <Text style={styles.activeBannerBold}>{activePersona.name}</Text>
          </Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <View
            style={[styles.loadingDot, { backgroundColor: colors.primary }]}
          />
        </View>
      ) : isError ? (
        <View style={styles.centered}>
          <Feather name="wifi-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Could not load personas
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
          data={list}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PersonaCard
              persona={item}
              onActivate={handleActivate}
              isActivating={activatingId === item.id}
            />
          )}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: bottomPadding },
            list.length === 0 && styles.listEmpty,
          ]}
          scrollEnabled={list.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.centered}>
              <Feather name="user-x" size={40} color={colors.muted} />
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                No personas configured
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
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  activeBannerText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  activeBannerBold: { fontFamily: 'Inter_600SemiBold' },
  list: { padding: 12, gap: 10 },
  listEmpty: { flex: 1 },
  card: {
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardAvatarWrapper: {},
  cardAvatar: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardNameBlock: { flex: 1, gap: 6 },
  personaName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: -0.2,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textTransform: 'lowercase',
  },
  description: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  activateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  activateBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
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
