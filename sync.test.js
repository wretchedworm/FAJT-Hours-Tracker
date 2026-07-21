import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("./sync.js", import.meta.url), "utf8");
const LOCAL_KEY = "fajt-hours-v1";

/** A fake browser: its own localStorage, its own copy of sync.js. */
function makeDevice(name, server) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const sandbox = {
    localStorage,
    navigator: { onLine: true },
    document: { visibilityState: "hidden", addEventListener() {} },
    addEventListener() {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    TextEncoder,
    crypto: globalThis.crypto,
    console,
    FAJT_CONFIG: { url: "https://example.test", anonKey: "key" },
    // Route all network through the shared in-memory "server".
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.endsWith("/fajt_load")) {
        const data = server.rows.get(body.room_id) ?? null;
        return { ok: true, status: 200, text: async () => JSON.stringify(data) };
      }
      if (url.endsWith("/fajt_save")) {
        server.writes.push(name);
        server.rows.set(body.room_id, body.payload);
        return { ok: true, status: 200, text: async () => "" };
      }
      throw new Error(`unexpected url ${url}`);
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const sync = sandbox.FAJTSync;
  return {
    name,
    sync,
    read: () => JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"),
    /** Mimic app.js: mutate state, stamp it, write it, push it. */
    async save(mutate) {
      const state = JSON.parse(localStorage.getItem(LOCAL_KEY) || "null") ||
        { version: 1, entries: [], openingBalances: {}, cycleSettings: {} };
      mutate(state);
      const prepared = sync.prepare(state);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(prepared));
      await sync.refresh();
    },
    setOnline(value) { sandbox.navigator.onLine = value; },
  };
}

const entry = (date, minutes) => ({ date, start: "09:00", end: "17:00", minutes });
const dates = (state) => (state.entries || []).map((e) => e.date).sort();

test("a second device picks up records from the first", async () => {
  const server = { rows: new Map(), writes: [] };
  const phone = makeDevice("phone", server);
  const mac = makeDevice("mac", server);

  await phone.sync.connect("pineapple");
  await phone.save((s) => s.entries.push(entry("2026-07-20", 480)));

  await mac.sync.connect("pineapple");
  assert.deepEqual(dates(mac.read()), ["2026-07-20"]);
});

test("a different passcode gets a completely separate record", async () => {
  const server = { rows: new Map(), writes: [] };
  const mine = makeDevice("mine", server);
  const theirs = makeDevice("theirs", server);

  await mine.sync.connect("pineapple");
  await mine.save((s) => s.entries.push(entry("2026-07-20", 480)));

  await theirs.sync.connect("watermelon");
  assert.deepEqual(dates(theirs.read() || { entries: [] }), []);
});

test("edits made offline on both devices survive — no data eaten", async () => {
  const server = { rows: new Map(), writes: [] };
  const phone = makeDevice("phone", server);
  const mac = makeDevice("mac", server);

  await phone.sync.connect("pineapple");
  await mac.sync.connect("pineapple");

  phone.setOnline(false);
  mac.setOnline(false);
  await phone.save((s) => s.entries.push(entry("2026-07-20", 480)));
  await mac.save((s) => s.entries.push(entry("2026-07-21", 300)));

  phone.setOnline(true);
  mac.setOnline(true);
  await phone.sync.refresh();
  await mac.sync.refresh();
  await phone.sync.refresh();

  assert.deepEqual(dates(phone.read()), ["2026-07-20", "2026-07-21"]);
  assert.deepEqual(dates(mac.read()), ["2026-07-20", "2026-07-21"]);
});

test("the same day edited on both devices — the later edit wins", async () => {
  const server = { rows: new Map(), writes: [] };
  const phone = makeDevice("phone", server);
  const mac = makeDevice("mac", server);

  await phone.sync.connect("pineapple");
  await phone.save((s) => s.entries.push(entry("2026-07-20", 480)));
  await mac.sync.connect("pineapple");

  mac.setOnline(false);
  await new Promise((r) => setTimeout(r, 5));
  await mac.save((s) => { s.entries[0].minutes = 600; });
  mac.setOnline(true);
  await mac.sync.refresh();
  await phone.sync.refresh();

  assert.equal(phone.read().entries[0].minutes, 600);
});

test("a deleted day stays deleted instead of coming back from the cloud", async () => {
  const server = { rows: new Map(), writes: [] };
  const phone = makeDevice("phone", server);
  const mac = makeDevice("mac", server);

  await phone.sync.connect("pineapple");
  await phone.save((s) => s.entries.push(entry("2026-07-20", 480)));
  await mac.sync.connect("pineapple");
  assert.deepEqual(dates(mac.read()), ["2026-07-20"]);

  await new Promise((r) => setTimeout(r, 5));
  await phone.save((s) => { s.entries = s.entries.filter((e) => e.date !== "2026-07-20"); });
  await mac.sync.refresh();

  assert.deepEqual(dates(mac.read()), []);
});

test("settings and opening balances sync too", async () => {
  const server = { rows: new Map(), writes: [] };
  const phone = makeDevice("phone", server);
  const mac = makeDevice("mac", server);

  await phone.sync.connect("pineapple");
  await phone.save((s) => {
    s.openingBalances["2026-07-16_2026-07-31"] = 125;
    s.cycleSettings["2026-07-16_2026-07-31"] = { nonWorkingDays: [1, 5] };
  });

  await mac.sync.connect("pineapple");
  assert.equal(mac.read().openingBalances["2026-07-16_2026-07-31"], 125);
  assert.deepEqual(mac.read().cycleSettings["2026-07-16_2026-07-31"].nonWorkingDays, [1, 5]);
});

test("offline saves keep working with no server at all", async () => {
  const server = { rows: new Map(), writes: [] };
  const phone = makeDevice("phone", server);

  await phone.sync.connect("pineapple");
  phone.setOnline(false);
  await phone.save((s) => s.entries.push(entry("2026-07-20", 480)));

  assert.deepEqual(dates(phone.read()), ["2026-07-20"]);
  assert.equal(phone.sync.status, "offline");
});
