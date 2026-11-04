export type DayPart = "daytime" | "nighttime" | "odd" | "even";

export interface ScheduleConfig {
  parts?: DayPart[];
  startHour?: number;
  endHour?: number;
}

const DAY_START = 6;
const DAY_END = 18;

function partMatches(part: DayPart, now: Date): boolean {
  const hour = now.getHours();
  const dom = now.getDate();
  switch (part) {
    case "daytime": return hour >= DAY_START && hour < DAY_END;
    case "nighttime": return hour < DAY_START || hour >= DAY_END;
    case "odd": return dom % 2 === 1;
    case "even": return dom % 2 === 0;
  }
}

export function isWithinSchedule(config: ScheduleConfig | null | undefined, now: Date = new Date()): boolean {
  if (!config) return true;
  const parts = config.parts ?? [];
  const hasHourRange = typeof config.startHour === "number" && typeof config.endHour === "number";

  if (parts.length === 0 && !hasHourRange) return true;

  const partsOk = parts.length === 0 ? true : parts.some((p) => partMatches(p, now));
  if (!partsOk) return false;

  if (hasHourRange) {
    const hour = now.getHours();
    if (hour < config.startHour! || hour >= config.endHour!) return false;
  }
  return true;
}
