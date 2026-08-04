/**
 * Direction-specific configuration types for inbound and outbound bots.
 */

export interface GreetingTimeBoundaries {
  morning: string;   // e.g. "05:00-11:59"
  afternoon: string;
  evening: string;
  night: string;
}

export interface TimeOfDayGreetings {
  morning: string;
  afternoon: string;
  evening: string;
  night: string;
}

export interface InboundDirectionConfig {
  greeting: {
    time_of_day_variants: TimeOfDayGreetings;
    time_boundaries: GreetingTimeBoundaries;
    ai_disclosure: boolean;
    ai_disclosure_text: string;
  };
  queue_behavior: {
    max_ring_wait_ms: number;
  };
  escalation: {
    transfer_number: string;
    transfer_on_request: boolean;
    transfer_on_frustration: boolean;
  };
}

export interface OutboundAmdConfig {
  enabled: boolean;
  detection_window_ms: number;
  on_machine_detected: {
    crm_disposition: string;
    voicemail_message_id: string;
    wait_for_beep: boolean;
    hangup_after_message: boolean;
  };
}

export interface OutboundDirectionConfig {
  amd: OutboundAmdConfig;
  opening_script: string;
  retry_policy: {
    max_attempts: number;
    retry_interval_minutes: number;
  };
  calling_hours: {
    start: string;  // "HH:MM"
    end: string;    // "HH:MM"
    respect_timezone: boolean;
  };
}

export const DEFAULT_INBOUND_CONFIG: InboundDirectionConfig = {
  greeting: {
    time_of_day_variants: {
      morning:   "Good morning, thank you for calling {company}. How may I assist you today?",
      afternoon: "Good afternoon, thank you for calling {company}. How may I assist you?",
      evening:   "Good evening, thank you for calling {company}. How may I help you?",
      night:     "Hello, thank you for calling {company}. How may I assist you?",
    },
    time_boundaries: {
      morning:   "05:00-11:59",
      afternoon: "12:00-16:59",
      evening:   "17:00-20:59",
      night:     "21:00-04:59",
    },
    ai_disclosure: true,
    ai_disclosure_text: "You're speaking with {company}'s virtual assistant.",
  },
  queue_behavior: { max_ring_wait_ms: 30000 },
  escalation: {
    transfer_number: "",
    transfer_on_request: true,
    transfer_on_frustration: true,
  },
};

export const DEFAULT_OUTBOUND_CONFIG: OutboundDirectionConfig = {
  amd: {
    enabled: true,
    detection_window_ms: 4000,
    on_machine_detected: {
      crm_disposition: "ANSWERING_MACHINE",
      voicemail_message_id: "",
      wait_for_beep: true,
      hangup_after_message: true,
    },
  },
  opening_script: "",
  retry_policy: { max_attempts: 3, retry_interval_minutes: 60 },
  calling_hours: { start: "09:00", end: "20:00", respect_timezone: true },
};
