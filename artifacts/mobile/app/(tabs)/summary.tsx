import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import {
  useListCalls,
  useSendEmail,
  type Call,
} from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

function formatCallLabel(call: Call): string {
  const caller =
    call.customerName ?? call.customerNumber ?? 'Unknown';
  const dir = call.direction === 'INBOUND' ? '↙' : '↗';
  const when = new Date(call.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dir} ${caller} · ${when}`;
}

interface CallPickerProps {
  calls: Call[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function CallPicker({ calls, selectedId, onSelect }: CallPickerProps) {
  const colors = useColors();
  if (calls.length === 0) {
    return (
      <View
        style={[
          styles.emptyPicker,
          { backgroundColor: colors.muted, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.emptyPickerText, { color: colors.mutedForeground }]}>
          No recent calls
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pickerScroll}
    >
      {calls.slice(0, 20).map((call) => {
        const isSelected = call.id === selectedId;
        return (
          <TouchableOpacity
            key={call.id}
            style={[
              styles.callChip,
              {
                backgroundColor: isSelected
                  ? colors.primary
                  : colors.card,
                borderColor: isSelected ? colors.primary : colors.border,
              },
            ]}
            onPress={() => onSelect(call.id)}
          >
            <Feather
              name={call.direction === 'INBOUND' ? 'phone-incoming' : 'phone-outgoing'}
              size={13}
              color={isSelected ? colors.primaryForeground : colors.mutedForeground}
            />
            <Text
              style={[
                styles.chipText,
                {
                  color: isSelected
                    ? colors.primaryForeground
                    : colors.foreground,
                },
              ]}
              numberOfLines={1}
            >
              {call.customerName ?? call.customerNumber ?? 'Unknown'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default function SummaryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPadding = Platform.OS === 'web' ? 84 : 80 + insets.bottom;

  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const { data, isLoading: loadingCalls } = useListCalls({ limit: 20 });
  const calls = data?.calls ?? [];

  const { mutate: sendEmail, isPending } = useSendEmail({
    mutation: {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSent(true);
        setSelectedCallId(null);
        setEmail('');
      },
      onError: () => {
        Alert.alert('Failed to send', 'Could not send the summary email. Please try again.');
      },
    },
  });

  const selectedCall = calls.find((c) => c.id === selectedCallId);

  const handleSend = () => {
    if (!email.trim()) {
      Alert.alert('Recipient required', 'Enter an email address to send the summary to.');
      return;
    }
    if (!selectedCallId) {
      Alert.alert('Select a call', 'Choose a call to send the summary for.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    sendEmail({
      data: {
        to: email.trim(),
        subject: `Call Summary · ${selectedCall?.customerName ?? selectedCall?.customerNumber ?? 'VoxAgent'}`,
        templateName: 'call_summary',
        callId: selectedCallId,
        variables: selectedCall?.customerName
          ? { callerName: selectedCall.customerName }
          : {},
      },
    });
  };

  const canSend = !!selectedCallId && !!email.trim() && !isPending;

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
          Send Summary
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.form,
            { paddingBottom: bottomPadding },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {sent && (
            <View
              style={[
                styles.successBanner,
                { backgroundColor: colors.accent + '15', borderColor: colors.accent + '30' },
              ]}
            >
              <Feather name="check-circle" size={16} color={colors.accent} />
              <Text
                style={[styles.successText, { color: colors.accent }]}
              >
                Summary email sent
              </Text>
            </View>
          )}

          {/* Step 1: Select call */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              1. Select a call
            </Text>
            <Text
              style={[styles.sectionHint, { color: colors.mutedForeground }]}
            >
              Choose from your recent calls
            </Text>
            {loadingCalls ? (
              <View
                style={[
                  styles.loadingPill,
                  { backgroundColor: colors.muted },
                ]}
              />
            ) : (
              <CallPicker
                calls={calls}
                selectedId={selectedCallId}
                onSelect={(id) => {
                  setSelectedCallId(id);
                  setSent(false);
                  Haptics.selectionAsync();
                }}
              />
            )}
            {selectedCall && (
              <View
                style={[
                  styles.selectedCallCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Feather
                  name="phone"
                  size={14}
                  color={colors.primary}
                />
                <Text
                  style={[
                    styles.selectedCallText,
                    { color: colors.foreground },
                  ]}
                  numberOfLines={1}
                >
                  {formatCallLabel(selectedCall)}
                </Text>
              </View>
            )}
          </View>

          {/* Step 2: Recipient email */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              2. Recipient email
            </Text>
            <TextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setSent(false);
              }}
              placeholder="manager@example.com"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.emailInput,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
            />
          </View>

          {/* Send button */}
          <TouchableOpacity
            style={[
              styles.sendBtn,
              {
                backgroundColor: canSend ? colors.primary : colors.muted,
              },
            ]}
            onPress={handleSend}
            disabled={!canSend}
          >
            {isPending ? (
              <Text
                style={[
                  styles.sendBtnText,
                  { color: colors.primaryForeground },
                ]}
              >
                Sending…
              </Text>
            ) : (
              <>
                <Feather
                  name="send"
                  size={16}
                  color={
                    canSend ? colors.primaryForeground : colors.mutedForeground
                  }
                />
                <Text
                  style={[
                    styles.sendBtnText,
                    {
                      color: canSend
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  Send Summary
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text
            style={[styles.disclaimer, { color: colors.mutedForeground }]}
          >
            Sends a call_summary email template with call details and transcript.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  form: { padding: 20, gap: 24 },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  successText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  sectionHint: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: -4 },
  pickerScroll: { gap: 8, paddingVertical: 2 },
  callChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 200,
  },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  emptyPicker: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyPickerText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  selectedCallCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  selectedCallText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  loadingPill: { height: 38, borderRadius: 8 },
  emailInput: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  sendBtn: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  sendBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  disclaimer: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
  },
});
