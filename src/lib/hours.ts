const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const EXTRA_ABBREVIATIONS: Record<string, string[]> = {
  tuesday: ["tues"],
  thursday: ["thur", "thurs"],
};

/**
 * Today's line from a store's free-text hours: the line starting with today's weekday name
 * (full or abbreviated, e.g. "Mon", "Tues"), without the day name. Null if none matches.
 */
export function todaysHours(hours: string | undefined, now: Date = new Date()): string | null {
  if (!hours) return null;
  const today = DAYS[now.getDay()] ?? "";
  const names = new Set([today, today.slice(0, 3), ...(EXTRA_ABBREVIATIONS[today] ?? [])]);
  for (const line of hours.split(/\r?\n/)) {
    const [, word = "", tail = ""] = /^\s*([A-Za-z]+)\.?(.*)$/.exec(line) ?? [];
    // Day ranges like "Monday-Friday 10-6" aren't supported.
    if (!names.has(word.toLowerCase()) || /^\s*[-–—]\s*[A-Za-z]/.test(tail)) continue;
    const rest = tail
      .replace(/\s+/g, " ")
      .replace(/^[\s:,-]+/, "")
      .trim();
    if (rest) return rest;
  }
  return null;
}
