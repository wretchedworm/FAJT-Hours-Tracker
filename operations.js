/**
 * FAJT Hours — the rules for changing your records.
 *
 * Every operation is pure: it takes the current state plus an input and
 * returns either `{ state, ... }` with a NEW state object, or `{ error }`
 * with a message ready to show. The input state is never mutated. app.js
 * only draws the screen and hands these the values from the form fields.
 */
(() => {
  const { localISO, parseISO, parseTime, workMinutes, targetClockOut, entryInCycle } = globalThis.FAJTCalculations;

  const ERR = {
    clockIn: "Enter a valid clock-in time.",
    target: "Enter a valid target duration.",
    sameDay: "The target must finish on the same day.",
    order: "Clock-out must be later than clock-in on the same day.",
    duplicate: "An entry already exists for this date.",
    weekday: "Choose a past or current weekday.",
    notFound: "Entry not found.",
    balance: "Enter a valid opening balance.",
  };
  const fail = (error) => ({ error });
  const toMinutes = (value) => (typeof value === "number" ? value : parseTime(value));

  /* ------------------------------------------------------------- state */

  const emptyState = () => ({ version: 1, name: "", entries: [], openingBalances: {}, cycleSettings: {} });
  const withDefaults = (raw) => ({ ...emptyState(), ...(raw || {}) });
  const cycleKey = (cycle) => `${localISO(cycle.start)}_${localISO(cycle.end)}`;

  /** Hours + minutes form fields -> total minutes, or null if nonsense. */
  function durationFromFields(hours, minutes) {
    const h = Number(hours || 0), m = Number(minutes || 0);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;
  const stamp = (now) => (now || new Date()).toISOString();
  const findEntry = (state, id) => state.entries.find((e) => e.id === id);
  const hasDate = (state, date) => state.entries.some((e) => e.date === date);
  const replaceEntry = (state, entry) =>
    ({ ...state, entries: state.entries.map((e) => (e.id === entry.id ? entry : e)) });

  /** Shared checks for anything that sets a clock-in + target. */
  function openFields({ clockIn, targetMinutes }) {
    const start = toMinutes(clockIn);
    if (start === null) return fail(ERR.clockIn);
    if (!(targetMinutes > 0)) return fail(ERR.target);
    const targetOut = targetClockOut(start, targetMinutes);
    if (targetOut === null) return fail(ERR.sameDay);
    return { clockIn: start, targetMinutes, targetOut };
  }

  /** Shared checks for anything that sets a clock-in + clock-out. */
  function closedFields({ clockIn, clockOut }) {
    const start = toMinutes(clockIn), end = toMinutes(clockOut);
    const result = workMinutes(start, end);
    if (!result) return fail(ERR.order);
    return { clockIn: start, clockOut: end, elapsedMinutes: result.elapsed, lunchMinutes: result.lunch, netMinutes: result.net };
  }

  /* ----------------------------------------------------------- entries */

  function clockIn(state, { date, clockIn, targetMinutes, now }) {
    if (hasDate(state, date)) return fail(ERR.duplicate);
    const fields = openFields({ clockIn, targetMinutes });
    if (fields.error) return fields;
    const entry = { id: crypto.randomUUID(), date, ...fields, createdAt: stamp(now) };
    return { state: { ...state, entries: [...state.entries, entry] }, entry };
  }

  function clockOut(state, { id, clockOut, now }) {
    const current = findEntry(state, id);
    if (!current) return fail(ERR.notFound);
    const end = toMinutes(clockOut);
    const result = workMinutes(current.clockIn, end);
    if (!result) return fail(ERR.order);
    const entry = { ...current, clockOut: end, elapsedMinutes: result.elapsed, lunchMinutes: result.lunch, netMinutes: result.net, confirmedAt: stamp(now) };
    return { state: replaceEntry(state, entry), entry, result };
  }

  function addEntry(state, { date, clockIn, clockOut, today = new Date(), now }) {
    const day = date && parseISO(date);
    if (!day || Number.isNaN(day.getTime()) || day > today || isWeekend(day)) return fail(ERR.weekday);
    if (hasDate(state, date)) return fail(ERR.duplicate);
    const fields = closedFields({ clockIn, clockOut });
    if (fields.error) return fields;
    const entry = { id: crypto.randomUUID(), date, ...fields, confirmedAt: stamp(now) };
    return { state: { ...state, entries: [...state.entries, entry] }, entry };
  }

  function editEntry(state, { id, clockIn, clockOut, now }) {
    const current = findEntry(state, id);
    if (!current) return fail(ERR.notFound);
    const fields = closedFields({ clockIn, clockOut });
    if (fields.error) return fields;
    const entry = { ...current, ...fields, updatedAt: stamp(now) };
    return { state: replaceEntry(state, entry), entry };
  }

  function editOpenEntry(state, { id, clockIn, targetMinutes, now }) {
    const current = findEntry(state, id);
    if (!current) return fail(ERR.notFound);
    const fields = openFields({ clockIn, targetMinutes });
    if (fields.error) return fields;
    const entry = { ...current, ...fields, updatedAt: stamp(now) };
    return { state: replaceEntry(state, entry), entry };
  }

  function deleteEntry(state, { id }) {
    if (!findEntry(state, id)) return fail(ERR.notFound);
    return { state: { ...state, entries: state.entries.filter((e) => e.id !== id) } };
  }

  /* ---------------------------------------------------------- settings */

  function setName(state, { name }) {
    return { state: { ...state, name: String(name || "").trim() } };
  }

  function saveCycleSettings(state, { cycle, name, nonWorkingDays, openingHours, openingMinutes, now }) {
    const balance = durationFromFields(openingHours, openingMinutes);
    if (balance === null) return fail(ERR.balance);
    const key = cycleKey(cycle);
    const existing = state.cycleSettings[key] || {};
    return { state: {
      ...state,
      name: String(name || "").trim(),
      cycleSettings: { ...state.cycleSettings, [key]: { ...existing, nonWorkingDays: [...nonWorkingDays], createdAt: existing.createdAt || stamp(now) } },
      openingBalances: { ...state.openingBalances, [key]: balance },
    } };
  }

  /* ------------------------------------------------------------ resets */

  function resetCycle(state, { cycle }) {
    const key = cycleKey(cycle);
    const { [key]: _balance, ...openingBalances } = state.openingBalances;
    const { [key]: _settings, ...cycleSettings } = state.cycleSettings;
    return { state: {
      ...state,
      entries: state.entries.filter((entry) => !entryInCycle(entry, cycle)),
      openingBalances,
      cycleSettings,
    } };
  }

  const resetAll = () => ({ state: emptyState() });

  /* ------------------------------------------------------- sample data */

  const SAMPLE_PATTERNS = [
    { clockIn: 8 * 60,      clockOut: 17 * 60 + 30 },
    { clockIn: 7 * 60 + 15, clockOut: 17 * 60 + 30 },
    { clockIn: 8 * 60 + 30, clockOut: 18 * 60 },
    { clockIn: 9 * 60,      clockOut: 17 * 60 },
    { clockIn: 7 * 60 + 45, clockOut: 18 * 60 + 15 },
  ];

  /** Five example weekdays spread across the cycle; dates already filled are skipped. */
  function loadSampleData(state, { cycle, now }) {
    const weekdays = [];
    const cursor = new Date(cycle.start);
    while (cursor <= cycle.end) {
      if (!isWeekend(cursor)) weekdays.push(localISO(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    const slots = [0, 2, 5, 8, weekdays.length - 1].map((i) => weekdays[i]).filter(Boolean);
    const fresh = [];
    slots.forEach((date, index) => {
      if (hasDate(state, date) || fresh.some((e) => e.date === date)) return;
      const pattern = SAMPLE_PATTERNS[index % SAMPLE_PATTERNS.length];
      const fields = closedFields(pattern);
      fresh.push({ id: crypto.randomUUID(), date, ...fields, isTest: true, confirmedAt: stamp(now) });
    });
    return { state: { ...state, entries: [...state.entries, ...fresh] }, added: fresh.length };
  }

  globalThis.FAJTOperations = {
    emptyState, withDefaults, cycleKey, durationFromFields,
    clockIn, clockOut, addEntry, editEntry, editOpenEntry, deleteEntry,
    setName, saveCycleSettings, resetCycle, resetAll, loadSampleData,
  };
})();
