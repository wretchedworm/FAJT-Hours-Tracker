(() => {
const LUNCH_MINUTES = 30;
const DAILY_TARGET_MINUTES = 390;

function localISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseISO(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseTime(value) {
  const clean = String(value || "").trim().replace(/[^0-9:]/g, "");
  let hours, minutes;
  if (clean.includes(":")) [hours, minutes] = clean.split(":").map(Number);
  else {
    const padded = clean.padStart(4, "0");
    if (!/^\d{4}$/.test(padded)) return null;
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2));
  }
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function timeText(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function durationText(minutes) {
  const safe = Math.max(0, Math.round(minutes));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, "0")}m`;
}

function workMinutes(clockIn, clockOut) {
  const start = typeof clockIn === "number" ? clockIn : parseTime(clockIn);
  const end = typeof clockOut === "number" ? clockOut : parseTime(clockOut);
  if (start === null || end === null || end <= start) return null;
  const lunch = end > 12 * 60 ? LUNCH_MINUTES : 0;
  return { elapsed: end - start, lunch, net: Math.max(0, end - start - lunch) };
}

function cycleFor(date = new Date()) {
  const startDay = date.getDate() <= 15 ? 1 : 16;
  const endDay = startDay === 1 ? 15 : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return {
    start: new Date(date.getFullYear(), date.getMonth(), startDay),
    end: new Date(date.getFullYear(), date.getMonth(), endDay),
  };
}

function weekdaysBetween(start, end) {
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function availableDays(cycle, today, nonWorkingDays, hasClockedInToday) {
  const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = normalizedToday < cycle.start ? new Date(cycle.start) : normalizedToday;
  if (hasClockedInToday) start.setDate(start.getDate() + 1);
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= cycle.end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6 && !nonWorkingDays.includes(day)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function entryInCycle(entry, cycle) {
  const date = parseISO(entry.date);
  return date >= cycle.start && date <= cycle.end;
}

globalThis.FAJTCalculations = {
  LUNCH_MINUTES,
  DAILY_TARGET_MINUTES,
  localISO,
  parseISO,
  parseTime,
  timeText,
  durationText,
  workMinutes,
  cycleFor,
  weekdaysBetween,
  availableDays,
  entryInCycle,
};
})();
