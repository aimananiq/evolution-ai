import type {
  NextMove,
  NextMoveInput,
  DecideConversationInput,
  ConversationDecision,
  PlanConversationInput,
  PlannedSend,
  WarmerRamp,
} from "./types";

export * from "./types";

// Per-number daily message quota, ramping from day0 → day14 → day30 (then flat).
// This is the ban-safety governor: a fresh number sends little, an aged one more.
export function dailyQuota(ramp: WarmerRamp, dayIndex: number): number {
  const d = Math.max(0, Math.floor(dayIndex));
  if (d <= 14) return Math.round(ramp.day0 + (ramp.day14 - ramp.day0) * (d / 14));
  if (d <= 30) return Math.round(ramp.day14 + (ramp.day30 - ramp.day14) * ((d - 14) / 16));
  return ramp.day30;
}

/** Whole days elapsed since a run started (used for the ramp). */
export function runDayIndex(startedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 86_400_000));
}

const DOW_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * Hour-of-day (0-23) and day-of-week (Mon=0…Sun=6) in the config's timezone, so
 * the schedule window + time-of-day weights track LOCAL time (e.g. Malaysia)
 * instead of UTC. Falls back to UTC when no/invalid timezone is given.
 */
function localHourDow(now: Date, tz?: string): { hour: number; dow: number } {
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "", 10) % 24;
      const dow = DOW_INDEX[parts.find((p) => p.type === "weekday")?.value ?? ""];
      if (!Number.isNaN(hour) && dow !== undefined) return { hour, dow };
    } catch {
      /* invalid tz — fall through to UTC */
    }
  }
  return { hour: now.getUTCHours(), dow: (now.getUTCDay() + 6) % 7 };
}

export function nextMove(input: NextMoveInput): NextMove | null {
  const random = input.random ?? Math.random;
  const { config, templateBodies, now } = input;

  if (config.participatingInstanceIds.length === 0) return null;
  if (config.mode === "pair" && (!config.outboundPartners || config.outboundPartners.length === 0)) return null;
  if (templateBodies.length === 0) return null;

  const { hour, dow } = localHourDow(now, config.timezone);
  if (hour < config.schedule.startHour || hour >= config.schedule.endHour) return null;

  const todWeight = config.timeOfDayWeights[hour] ?? 0;
  if (random() >= todWeight) return null;

  const dowWeight = config.dayOfWeekWeights[dow] ?? 0;
  if (random() >= dowWeight) return null;

  if (random() < config.schedule.skipProbability) return null;

  const instance = pick(random, config.participatingInstanceIds);
  if (!instance) return null;

  let partner: string | null = null;
  if (config.mode === "pair") {
    const p = pick(random, config.outboundPartners!);
    if (p) partner = p.number;
  } else {
    const p = pick(random, config.participatingInstanceIds.filter((id) => id !== instance));
    if (p) partner = p;
  }
  if (!partner) return null;

  const text = pick(random, templateBodies);
  if (!text) return null;

  const typingDelayMs = Math.min(
    config.pacing.typingMaxMs,
    Math.max(config.pacing.typingMinMs, config.pacing.typingPerCharMs * text.length),
  );

  const scheduledDelayMs = Math.floor(
    config.pacing.replyMinMs + random() * Math.max(0, config.pacing.replyMaxMs - config.pacing.replyMinMs),
  );

  return {
    instanceId: instance,
    to: partner,
    text,
    typingDelayMs,
    scheduledDelayMs,
  };
}

function pick<T>(random: () => number, arr: T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(random() * arr.length)] ?? null;
}

// Same schedule/weight/skip gating as nextMove, but returns a whole-conversation
// decision (instance + partner + turn count) with no text — the worker generates
// the lines via AI, then plans the timed sends with planConversation().
export function decideConversation(input: DecideConversationInput): ConversationDecision | null {
  const random = input.random ?? Math.random;
  const { config, now } = input;

  if (config.participatingInstanceIds.length === 0) return null;
  if (config.mode === "pair" && (!config.outboundPartners || config.outboundPartners.length === 0)) return null;

  const { hour, dow } = localHourDow(now, config.timezone);
  if (hour < config.schedule.startHour || hour >= config.schedule.endHour) return null;
  if (random() >= (config.timeOfDayWeights[hour] ?? 0)) return null;
  if (random() >= (config.dayOfWeekWeights[dow] ?? 0)) return null;
  if (random() < config.schedule.skipProbability) return null;

  const instance = pick(random, config.participatingInstanceIds);
  if (!instance) return null;

  const min = config.ai?.minTurns ?? config.pacing.minTurnsPerConversation ?? 4;
  const max = config.ai?.maxTurns ?? config.pacing.maxTurnsPerConversation ?? 8;
  const turns = Math.max(2, Math.floor(min + random() * Math.max(1, max - min + 1)));

  if (config.mode === "pair") {
    const partner = pick(random, config.outboundPartners!);
    if (!partner) return null;
    return { instanceId: instance, partnerNumber: partner.number, turns };
  }
  const other = pick(random, config.participatingInstanceIds.filter((id) => id !== instance));
  if (!other) return null;
  return { instanceId: instance, partnerInstanceId: other, turns };
}

// Turn AI-generated lines into timed sends.
//  - "internal" mode: both instances send, alternating (a real two-way thread).
//  - "pair" mode: only the primary instance sends (partner is external); the
//    partner's would-be replies advance the clock but produce no send.
export function planConversation(input: PlanConversationInput): PlannedSend[] {
  const { config, decision, lines, senderNumber, partnerNumber } = input;
  const random = input.random ?? Math.random;
  const p = config.pacing;
  const internal = !!decision.partnerInstanceId;
  const sends: PlannedSend[] = [];
  let cumulative = 0;

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const typingDelayMs = Math.min(p.typingMaxMs, Math.max(p.typingMinMs, p.typingPerCharMs * text.length));
    const isPrimary = i % 2 === 0;
    if (internal || isPrimary) {
      const sender = isPrimary ? decision.instanceId : decision.partnerInstanceId!;
      const to = isPrimary ? partnerNumber : senderNumber;
      sends.push({ instanceId: sender, to, text, typingDelayMs, scheduledDelayMs: Math.floor(cumulative) });
    }
    const replyGap = p.replyMinMs + random() * Math.max(0, p.replyMaxMs - p.replyMinMs);
    cumulative += typingDelayMs + replyGap;
  }
  return sends;
}
