import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const CALC = readFileSync(new URL("./calculations.js", import.meta.url), "utf8");
const OPS = readFileSync(new URL("./operations.js", import.meta.url), "utf8");
const STORE = readFileSync(new URL("./store.js", import.meta.url), "utf8");
const LOCAL_KEY = "fajt-hours-v1";

/** A fake browser tab: its own localStorage, optionally a fake sync. */
function makeTab({ storage = new Map(), sync = null } = {}) {
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const sandbox = { localStorage, console, crypto: globalThis.crypto, Date };
  if (sync) sandbox.FAJTSync = sync;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CALC, sandbox);
  vm.runInContext(OPS, sandbox);
  vm.runInContext(STORE, sandbox);
  return { store: sandbox.FAJTStore, storage, raw: () => JSON.parse(storage.get(LOCAL_KEY) || "null") };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const entry = (date, minutes) => ({ id: date, date, clockIn: 540, clockOut: 1020, netMinutes: minutes });

test("an empty tab starts with the default state", () => {
  const { store } = makeTab();
  assert.deepEqual(plain(store.get()), { version: 1, name: "", entries: [], openingBalances: {}, cycleSettings: {} });
});

test("update persists the state and tells subscribers", () => {
  const { store, raw } = makeTab();
  const seen = [];
  store.subscribe((s) => seen.push(s));
  store.update({ ...store.get(), name: "Darren" });
  assert.equal(store.get().name, "Darren");
  assert.equal(raw().name, "Darren");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "Darren");
});

test("a reloaded tab reads back what was saved", () => {
  const storage = new Map();
  makeTab({ storage }).store.update({ version: 1, name: "", entries: [entry("2026-09-16", 480)], openingBalances: {}, cycleSettings: {} });
  const again = makeTab({ storage });
  assert.deepEqual(plain(again.store.get().entries.map((e) => e.date)), ["2026-09-16"]);
});

test("update stamps which days changed so sync can merge per day", async () => {
  const { store } = makeTab();
  store.update({ ...store.get(), entries: [entry("2026-09-16", 480)] });
  const first = store.get().entryStamps["2026-09-16"];
  assert.ok(first > 0);
  await new Promise((r) => setTimeout(r, 5));
  store.update({ ...store.get(), entries: [entry("2026-09-16", 480), entry("2026-09-17", 300)] });
  assert.equal(store.get().entryStamps["2026-09-16"], first, "an unchanged day keeps its stamp");
  assert.ok(store.get().entryStamps["2026-09-17"] > first);
  store.update({ ...store.get(), entries: [entry("2026-09-17", 300)] });
  assert.ok(store.get().deletedEntries["2026-09-16"] > 0, "a removed day is recorded as deleted");
  assert.equal(store.get().entryStamps["2026-09-16"], undefined);
});

test("update asks sync to push, and works with no sync at all", () => {
  let pushes = 0;
  const withSync = makeTab({ sync: { notifyLocalChange: () => pushes++ } });
  withSync.store.update({ ...withSync.store.get(), name: "A" });
  assert.equal(pushes, 1);
  const alone = makeTab();
  alone.store.update({ ...alone.store.get(), name: "B" });
  assert.equal(alone.store.get().name, "B");
});

test("replace adopts a merged state as-is without re-stamping, and notifies", () => {
  const { store, raw } = makeTab();
  const seen = [];
  store.subscribe((s) => seen.push(s));
  const merged = { version: 1, name: "", entries: [entry("2026-09-16", 480)], openingBalances: {}, cycleSettings: {}, entryStamps: { "2026-09-16": 123 }, deletedEntries: {} };
  store.replace(merged);
  assert.equal(store.get().entryStamps["2026-09-16"], 123);
  assert.equal(raw().entryStamps["2026-09-16"], 123);
  assert.equal(seen.length, 1);
  // A later local edit still compares against what replace stored.
  store.update({ ...store.get(), entries: [] });
  assert.ok(store.get().deletedEntries["2026-09-16"] > 123);
});
