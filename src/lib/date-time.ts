import type { Locale } from "@/i18n/config";
import { localeCode } from "@/i18n/format";

export const defaultTimeZone = "Europe/Paris";

export function safeTimeZone(value: string | null | undefined) {
  if (!value) return defaultTimeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return defaultTimeZone;
  }
}

/** Date and time with an explicit zone name, so console timestamps are never ambiguous. */
export function dateTimeFormatter(locale: Locale, timeZone: string, style: "short" | "medium" = "short") {
  // dateStyle/timeStyle cannot be combined with timeZoneName: list the parts.
  return new Intl.DateTimeFormat(localeCode(locale), {
    year: "numeric",
    month: style === "short" ? "2-digit" : "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(style === "medium" ? { second: "2-digit" as const } : {}),
    timeZone: safeTimeZone(timeZone),
    timeZoneName: "short",
  });
}

function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** First instant of a calendar day (YYYY-MM-DD) in a time zone, or null for an invalid day. */
export function zonedDayStart(day: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utcMidnight = Date.UTC(year, month - 1, date);
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
  const zone = safeTimeZone(timeZone);
  // Two passes settle the offset around daylight-saving transitions.
  let instant = utcMidnight - zoneOffsetMs(new Date(utcMidnight), zone);
  instant = utcMidnight - zoneOffsetMs(new Date(instant), zone);
  return new Date(instant);
}

/** Calendar day (YYYY-MM-DD) following `day`. */
export function nextDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}
