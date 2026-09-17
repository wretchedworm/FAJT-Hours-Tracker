import test from "node:test";
import assert from "node:assert/strict";
await import("./calculations.js");
await import("./operations.js");
const {
  emptyState, withDefaults, cycleKey, durationFromFields,
  clockIn, clockOut, addEntry, editEntry, editOpenEntry, deleteEntry,
  setName, saveCycleSettings, resetCycle, resetAll, loadSampleData,
} = globalThis.FAJTOperations;
const { cycleFor } = globalThis.FAJTCalculations;

const THU = "2026-09-17";
const open = () => clockIn(emptyState(), { date: THU, clockIn: "0715", targetMinutes: 390 });

test("clock in creates an open entry with the target clock-out", () => {
  const { state, entry, error } = open();
  assert.equal(error, undefined);
  assert.equal(state.entries.length, 1);
  assert.equal(entry.date, THU);
  assert.equal(entry.clockIn, 435);
  assert.equal(entry.targetMinutes, 390);
  assert.equal(entry.targetOut, 855);
  assert.ok(entry.id);
  assert.ok(entry.createdAt);
  assert.equal(entry.clockOut, undefined);
});

test("clock in rejects bad input with a message and leaves the state alone", () => {
  const before = emptyState();
  assert.equal(clockIn(before, { date: THU, clockIn: "", targetMinutes: 390 }).error, "Enter a valid clock-in time.");
  assert.equal(clockIn(before, { date: THU, clockIn: "0715", targetMinutes: 0 }).error, "Enter a valid target duration.");
  assert.equal(clockIn(before, { date: THU, clockIn: "2300", targetMinutes: 120 }).error, "The target must finish on the same day.");
  assert.deepEqual(before, emptyState());
});

test("clock in refuses a second entry on the same date", () => {
  const { state } = open();
  assert.equal(clockIn(state, { date: THU, clockIn: "0800", targetMinutes: 60 }).error, "An entry already exists for this date.");
});

test("clock out closes the entry with lunch deducted", () => {
  const { state: s1, entry } = open();
  const { state, entry: closed, error } = clockOut(s1, { id: entry.id, clockOut: "1730" });
  assert.equal(error, undefined);
  assert.equal(closed.clockOut, 1050);
  assert.equal(closed.elapsedMinutes, 615);
  assert.equal(closed.lunchMinutes, 30);
  assert.equal(closed.netMinutes, 585);
  assert.ok(closed.confirmedAt);
  assert.equal(state.entries[0].clockOut, 1050);
  assert.equal(s1.entries[0].clockOut, undefined, "input state is not mutated");
});

test("clock out rejects an end before the start", () => {
  const { state, entry } = open();
  assert.equal(clockOut(state, { id: entry.id, clockOut: "0700" }).error, "Clock-out must be later than clock-in on the same day.");
  assert.equal(clockOut(state, { id: "nope", clockOut: "1700" }).error, "Entry not found.");
});

test("a past entry is added complete, on a past or current weekday only", () => {
  const today = new Date(2026, 8, 17);
  const ok = addEntry(emptyState(), { date: "2026-09-16", clockIn: "0800", clockOut: "1700", today });
  assert.equal(ok.error, undefined);
  assert.equal(ok.entry.netMinutes, 510);
  assert.equal(ok.entry.clockOut, 1020);
  assert.equal(addEntry(emptyState(), { date: "2026-09-19", clockIn: "0800", clockOut: "1700", today }).error, "Choose a past or current weekday.");
  assert.equal(addEntry(emptyState(), { date: "2026-09-18", clockIn: "0800", clockOut: "1700", today }).error, "Choose a past or current weekday.");
  assert.equal(addEntry(emptyState(), { date: "2026-09-16", clockIn: "0800", clockOut: "0700", today }).error, "Clock-out must be later than clock-in on the same day.");
  assert.equal(addEntry(ok.state, { date: "2026-09-16", clockIn: "0900", clockOut: "1700", today }).error, "An entry already exists for this date.");
});

test("editing a closed entry recalculates its hours", () => {
  const { state: s1, entry } = addEntry(emptyState(), { date: "2026-09-16", clockIn: "0800", clockOut: "1700", today: new Date(2026, 8, 17) });
  const { state, entry: edited, error } = editEntry(s1, { id: entry.id, clockIn: "0900", clockOut: "1200" });
  assert.equal(error, undefined);
  assert.equal(edited.netMinutes, 180);
  assert.equal(edited.lunchMinutes, 0);
  assert.ok(edited.updatedAt);
  assert.equal(state.entries[0].clockIn, 540);
  assert.equal(editEntry(s1, { id: entry.id, clockIn: "0900", clockOut: "0800" }).error, "Clock-out must be later than clock-in on the same day.");
});

test("editing an open entry moves its target clock-out", () => {
  const { state: s1, entry } = open();
  const { state, entry: edited, error } = editOpenEntry(s1, { id: entry.id, clockIn: "0800", targetMinutes: 180 });
  assert.equal(error, undefined);
  assert.equal(edited.targetOut, 660);
  assert.equal(state.entries[0].targetMinutes, 180);
  assert.equal(editOpenEntry(s1, { id: entry.id, clockIn: "2330", targetMinutes: 180 }).error, "The target must finish on the same day.");
});

test("deleting an entry removes it", () => {
  const { state: s1, entry } = open();
  const { state } = deleteEntry(s1, { id: entry.id });
  assert.deepEqual(state.entries, []);
  assert.equal(s1.entries.length, 1);
  assert.equal(deleteEntry(s1, { id: "nope" }).error, "Entry not found.");
});

test("state helpers", () => {
  assert.deepEqual(emptyState(), { version: 1, name: "", entries: [], openingBalances: {}, cycleSettings: {} });
  assert.deepEqual(withDefaults({ name: "Darren" }), { version: 1, name: "Darren", entries: [], openingBalances: {}, cycleSettings: {} });
  assert.equal(cycleKey({ start: new Date(2026, 8, 16), end: new Date(2026, 8, 30) }), "2026-09-16_2026-09-30");
  assert.equal(durationFromFields("6", "30"), 390);
  assert.equal(durationFromFields("", ""), 0);
  assert.equal(durationFromFields("1", "70"), null);
  assert.equal(durationFromFields("-1", "0"), null);
});

const CYCLE = cycleFor(new Date(2026, 8, 17)); // 16–30 Sept 2026
const KEY = "2026-09-16_2026-09-30";

test("setting the name trims it", () => {
  const { state } = setName(emptyState(), { name: "  Darren " });
  assert.equal(state.name, "Darren");
});

test("saving cycle settings records days off, opening balance and name", () => {
  const { state, error } = saveCycleSettings(emptyState(), { cycle: CYCLE, name: " Darren ", nonWorkingDays: [1, 5], openingHours: "2", openingMinutes: "5" });
  assert.equal(error, undefined);
  assert.equal(state.name, "Darren");
  assert.deepEqual(state.cycleSettings[KEY].nonWorkingDays, [1, 5]);
  assert.ok(state.cycleSettings[KEY].createdAt);
  assert.equal(state.openingBalances[KEY], 125);
});

test("re-saving cycle settings keeps the original createdAt", () => {
  const first = saveCycleSettings(emptyState(), { cycle: CYCLE, name: "D", nonWorkingDays: [1], openingHours: 0, openingMinutes: 0, now: new Date(2026, 8, 16) }).state;
  const second = saveCycleSettings(first, { cycle: CYCLE, name: "D", nonWorkingDays: [2], openingHours: 1, openingMinutes: 0, now: new Date(2026, 8, 20) }).state;
  assert.equal(second.cycleSettings[KEY].createdAt, first.cycleSettings[KEY].createdAt);
  assert.deepEqual(second.cycleSettings[KEY].nonWorkingDays, [2]);
  assert.equal(second.openingBalances[KEY], 60);
});

test("saving cycle settings rejects a bad opening balance", () => {
  assert.equal(saveCycleSettings(emptyState(), { cycle: CYCLE, name: "", nonWorkingDays: [], openingHours: "1", openingMinutes: "75" }).error, "Enter a valid opening balance.");
});

test("resetting a cycle removes only that cycle's entries and settings", () => {
  let state = saveCycleSettings(emptyState(), { cycle: CYCLE, name: "Darren", nonWorkingDays: [1], openingHours: 1, openingMinutes: 0 }).state;
  const today = new Date(2026, 8, 17);
  state = addEntry(state, { date: "2026-09-16", clockIn: "0800", clockOut: "1700", today }).state;
  state = addEntry(state, { date: "2026-09-10", clockIn: "0800", clockOut: "1700", today }).state;
  state.openingBalances["2026-09-01_2026-09-15"] = 30;
  const { state: after } = resetCycle(state, { cycle: CYCLE });
  assert.deepEqual(after.entries.map((e) => e.date), ["2026-09-10"]);
  assert.equal(after.cycleSettings[KEY], undefined);
  assert.equal(after.openingBalances[KEY], undefined);
  assert.equal(after.openingBalances["2026-09-01_2026-09-15"], 30);
  assert.equal(after.name, "Darren");
  assert.equal(state.entries.length, 2, "input state is not mutated");
});

test("resetting everything returns an empty state", () => {
  const { state } = resetAll();
  assert.deepEqual(state, emptyState());
});

test("sample data adds five marked weekdays and skips dates already filled", () => {
  const today = new Date(2026, 8, 17);
  const seeded = addEntry(emptyState(), { date: "2026-09-16", clockIn: "0800", clockOut: "1700", today }).state;
  const { state, added } = loadSampleData(seeded, { cycle: CYCLE });
  assert.equal(added, 4, "the 16th is the first sample slot and already has an entry");
  assert.equal(state.entries.length, 5);
  const samples = state.entries.filter((e) => e.isTest);
  assert.equal(samples.length, 4);
  assert.ok(samples.every((e) => e.clockOut && e.netMinutes > 0));
  assert.equal(loadSampleData(state, { cycle: CYCLE }).added, 0);
  const fromEmpty = loadSampleData(emptyState(), { cycle: CYCLE }).state.entries;
  assert.deepEqual(fromEmpty.map((e) => [e.date, e.clockIn, e.clockOut, e.netMinutes]), [
    ["2026-09-16", 480, 1050, 540], ["2026-09-18", 435, 1050, 585], ["2026-09-23", 510, 1080, 540],
    ["2026-09-28", 540, 1020, 450], ["2026-09-30", 465, 1095, 600],
  ]);
});

test("operations accept minutes as numbers as well as typed text", () => {
  assert.equal(clockIn(emptyState(), { date: THU, clockIn: 435, targetMinutes: 390 }).entry.targetOut, 855);
  assert.equal(addEntry(emptyState(), { date: "2026-09-16", clockIn: 480, clockOut: 1020, today: new Date(2026, 8, 17) }).entry.netMinutes, 510);
});
