export interface WarmerSchedule {
  startHour: number;
  endHour: number;
  skipProbability: number;
}

export interface WarmerPacing {
  typingPerCharMs: number;
  typingMinMs: number;
  typingMaxMs: number;
  replyMinMs: number;
  replyMaxMs: number;
  minTurnsPerConversation: number;
  maxTurnsPerConversation: number;
}

/** Per-number daily message quota that ramps up as the run ages (ban-safe). */
export interface WarmerRamp {
  day0: number;
  day14: number;
  day30: number;
}

export interface WarmerOutboundPartner {
  number: string;
  label: string;
}

export interface WarmerAiCampaign {
  enabled?: boolean;
  intensity?: "subtle" | "moderate" | "direct";
  topics?: string[];
  sampleMessages?: string[];
}

export interface WarmerAiSettings {
  enabled: boolean;
  style?: string;
  campaign?: WarmerAiCampaign;
  minTurns?: number;
  maxTurns?: number;
  maxConversationsPerDay?: number;
}

export interface WarmerConfig {
  mode: "pair" | "internal";
  participatingInstanceIds: string[];
  outboundPartners?: WarmerOutboundPartner[];
  /** IANA timezone the schedule hours + weights are interpreted in (e.g. "Asia/Kuala_Lumpur"). Falls back to UTC. */
  timezone?: string;
  schedule: WarmerSchedule;
  pacing: WarmerPacing;
  timeOfDayWeights: number[];
  dayOfWeekWeights: number[];
  reactions?: { enabled: boolean; emojis: string[] };
  ai?: WarmerAiSettings;
  ramp?: WarmerRamp;
}

/** A decided AI conversation to run (text is generated separately by the worker). */
export interface ConversationDecision {
  instanceId: string; // primary sender that starts the conversation
  partnerInstanceId?: string; // set in "internal" mode — the other participating instance
  partnerNumber?: string; // set in "pair" mode — the external partner number
  turns: number;
}

/** One scheduled send within a planned conversation. */
export interface PlannedSend {
  instanceId: string; // sender for this turn
  to: string; // recipient number
  text: string;
  typingDelayMs: number;
  scheduledDelayMs: number; // cumulative delay from "now"
}

export interface DecideConversationInput {
  config: WarmerConfig;
  now: Date;
  random?: () => number;
}

export interface PlanConversationInput {
  config: WarmerConfig;
  decision: ConversationDecision;
  lines: string[];
  senderNumber: string; // phone number of the primary instance (recipient of partner replies)
  partnerNumber: string; // recipient number for the primary instance's turns
  random?: () => number;
}

export interface NextMove {
  instanceId: string;
  to: string;
  text: string;
  typingDelayMs: number;
  scheduledDelayMs: number;
}

export interface NextMoveInput {
  config: WarmerConfig;
  templateBodies: string[];
  now: Date;
  random?: () => number;
}
