export interface RampPolicy {
  rampBaseDaily: number;
  rampGrowthPct: number;
  rampMaxDaily: number;
}

export function rampCapForDay(policy: RampPolicy, dayIndex: number): number {
  const day = Math.max(0, Math.floor(dayIndex));
  const raw = policy.rampBaseDaily * Math.pow(1 + policy.rampGrowthPct / 100, day);
  return Math.min(policy.rampMaxDaily, Math.floor(raw));
}

export function daysSince(start: Date, now: Date): number {
  const ms = now.getTime() - start.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
