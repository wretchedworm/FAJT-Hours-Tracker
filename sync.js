/**
 * FAJT Hours — cross-device sync.
 *
 * How it works, in short:
 *   1. You type a passcode. The passcode is hashed into a long random-looking
 *      room ID. The passcode itself never leaves the device.
 *   2. Your whole state blob is stored in one Supabase row under that room ID.
 *   3. Every device that knows the passcode lands on the same row.
 *
 * Offline-first: localStorage is always the source of truth for reading and is
 * written first. The cloud is a mirror that is pushed to and pulled from when
 * the network allows. If you are offline the app works exactly as it does now,
 * and syncs when you come back.
 *
 * Conflicts: merged per-record, not last-writer-wins on the whole blob. Two
 * devices editing different days while offline both keep their edits. Two
 * devices editing the SAME day — the later edit wins.
 */
(() => {
  const LOCAL_KEY = "fajt-hours-v1";
  const META_KEY = "fajt-sync-meta-v1";
  const SNAPSHOT_KEY = "fajt-sync-snapshot-v1";
  const POLL_MS = 20000;

  const cfg = globalThis.FAJT_CONFIG || {};
  const configured = Boolean(cfg.url && cfg.anonKey);

  let roomId = null;
  let status = "local";      // local | offline | syncing | synced | error
  let statusDetail = "";
  let pollTimer = null;
  let pushTimer = null;
  let listeners = [];

  /* ---------------------------------------------------------------- utils */

  const readJSON = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  function setStatus(next, detail = "") {
    status = next;
    statusDetail = detail;
    listeners.forEach((fn) => { try { fn(next, detail); } catch { /* ignore */ } });
  }

  /** Passcode -> room ID. SHA-256 where available, weaker fallback otherwise. */
  async function deriveRoomId(passcode) {
    const input = `fajt-hours::${passcode.trim().toLowerCase()}`;
    if (globalThis.crypto?.subtle) {
      const bytes = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // Fallback for insecure contexts (e.g. opening index.html via file://).
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < input.length; i++) {
      h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + input.charCodeAt(i) * (i + 1), 2246822519) >>> 0;
    }
    return `fallback${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
  }

  /* -------------------------------------------------------- change stamps */

  const byDate = (entries) => {
    const map = {};
    (entries || []).forEach((entry) => { if (entry?.date) map[entry.date] = entry; });
    return map;
  };
  const settingsFingerprint = (state) =>
    JSON.stringify([state?.openingBalances || {}, state?.cycleSettings || {}]);

  /**
   * Compare the state about to be saved against the last snapshot and record
   * WHEN each day changed. This lets us merge intelligently later without
   * having to touch every place in app.js that edits an entry.
   */
  function stampChanges(state) {
    const prev = readJSON(SNAPSHOT_KEY, null);
    const now = Date.now();
    state.entryStamps = { ...(state.entryStamps || {}) };
    state.deletedEntries = { ...(state.deletedEntries || {}) };

    const current = byDate(state.entries);
    const previous = byDate(prev?.entries);

    for (const date of Object.keys(current)) {
      const changed = !previous[date] ||
        JSON.stringify(previous[date]) !== JSON.stringify(current[date]);
      if (changed || !state.entryStamps[date]) {
        state.entryStamps[date] = now;
        delete state.deletedEntries[date];
      }
    }
    for (const date of Object.keys(previous)) {
      if (!current[date]) {
        state.deletedEntries[date] = now;
        delete state.entryStamps[date];
      }
    }
    if (!prev || settingsFingerprint(prev) !== settingsFingerprint(state)) {
      state.settingsUpdatedAt = now;
    }
    state.settingsUpdatedAt = state.settingsUpdatedAt || now;
    writeJSON(SNAPSHOT_KEY, state);
    return state;
  }

  /* ----------------------------------------------------------- merge them */

  function mergeStates(local, remote) {
    if (!remote || typeof remote !== "object") return local;
    if (!local || typeof local !== "object") return remote;

    const localEntries = byDate(local.entries);
    const remoteEntries = byDate(remote.entries);
    const localStamps = local.entryStamps || {};
    const remoteStamps = remote.entryStamps || {};
    const localDeleted = local.deletedEntries || {};
    const remoteDeleted = remote.deletedEntries || {};

    const dates = new Set([
      ...Object.keys(localEntries), ...Object.keys(remoteEntries),
      ...Object.keys(localDeleted), ...Object.keys(remoteDeleted),
    ]);

    const entries = [];
    const entryStamps = {};
    const deletedEntries = {};

    for (const date of dates) {
      const candidates = [
        { ts: localStamps[date] || 0, kind: "keep", entry: localEntries[date] },
        { ts: remoteStamps[date] || 0, kind: "keep", entry: remoteEntries[date] },
        { ts: localDeleted[date] || 0, kind: "delete" },
        { ts: remoteDeleted[date] || 0, kind: "delete" },
      ].filter((c) => c.ts > 0 && (c.kind === "delete" || c.entry));

      if (!candidates.length) {
        const entry = localEntries[date] || remoteEntries[date];
        if (entry) { entries.push(entry); entryStamps[date] = 0; }
        continue;
      }
      const winner = candidates.reduce((a, b) => (b.ts > a.ts ? b : a));
      if (winner.kind === "delete") {
        deletedEntries[date] = winner.ts;
      } else {
        entries.push(winner.entry);
        entryStamps[date] = winner.ts;
      }
    }

    entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const localSettingsTs = local.settingsUpdatedAt || 0;
    const remoteSettingsTs = remote.settingsUpdatedAt || 0;
    const settingsSource = remoteSettingsTs > localSettingsTs ? remote : local;

    return {
      ...local,
      version: Math.max(local.version || 1, remote.version || 1),
      entries,
      entryStamps,
      deletedEntries,
      openingBalances: settingsSource.openingBalances || {},
      cycleSettings: settingsSource.cycleSettings || {},
      settingsUpdatedAt: Math.max(localSettingsTs, remoteSettingsTs),
    };
  }

  /* ------------------------------------------------------------- transport */

  const headers = () => ({
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    "Content-Type": "application/json",
  });

  async function rpc(fn, body) {
    const response = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 404) {
        throw new Error("Database not set up — run supabase-setup.sql");
      }
      throw new Error(`${fn} failed (${response.status}) ${text}`.trim());
    }
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  }

  async function fetchRemote() {
    return rpc("fajt_load", { room_id: roomId });
  }

  async function writeRemote(state) {
    await rpc("fajt_save", { room_id: roomId, payload: state });
  }

  /* -------------------------------------------------------------- the loop */

  const localState = () => readJSON(LOCAL_KEY, null);
  const putLocal = (state) => writeJSON(LOCAL_KEY, state);

  /** Pull remote, merge, save locally, push back if we had anything new. */
  async function reconcile({ silent = false } = {}) {
    if (!roomId || !configured) return;
    if (!navigator.onLine) { setStatus("offline"); return; }
    if (!silent) setStatus("syncing");
    try {
      const remote = await fetchRemote();
      const local = localState();
      const merged = mergeStates(local, remote);
      const changedLocally = JSON.stringify(merged) !== JSON.stringify(local);
      const changedRemotely = JSON.stringify(merged) !== JSON.stringify(remote);

      if (changedLocally) {
        putLocal(merged);
        writeJSON(SNAPSHOT_KEY, merged);
        globalThis.FAJTSync.onRemoteUpdate?.(merged);
      }
      if (changedRemotely) await writeRemote(merged);
      setStatus("synced");
    } catch (error) {
      setStatus("error", error.message);
    }
  }

  /** Called by app.js after every local save. Debounced push. */
  function pushSoon() {
    if (!roomId || !configured) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => reconcile({ silent: true }), 600);
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") reconcile({ silent: true });
    }, POLL_MS);
  }

  /* ----------------------------------------------------------------- public */

  const api = {
    configured,
    get status() { return status; },
    get statusDetail() { return statusDetail; },
    get roomId() { return roomId; },
    get connected() { return Boolean(roomId && configured); },

    onStatus(fn) { listeners.push(fn); fn(status, statusDetail); },
    onRemoteUpdate: null,

    /** Prepare a state object for saving; always call before writing local. */
    prepare(state) { return stampChanges(state); },

    /** Fire-and-forget push after a local save. */
    notifyLocalChange() { pushSoon(); },

    /** Restore a previously entered passcode, if any. */
    async restore() {
      if (!configured) { setStatus("local"); return false; }
      const meta = readJSON(META_KEY, null);
      if (!meta?.roomId) { setStatus("local"); return false; }
      roomId = meta.roomId;
      startPolling();
      await reconcile();
      return true;
    },

    /** Join (or create) the shared record for this passcode. */
    async connect(passcode) {
      if (!configured) throw new Error("Supabase is not configured yet — see config.js");
      if (!passcode || passcode.trim().length < 4) throw new Error("Use at least 4 characters.");
      roomId = await deriveRoomId(passcode);
      writeJSON(META_KEY, { roomId, joinedAt: Date.now() });
      startPolling();
      await reconcile();
      if (status === "error") throw new Error(statusDetail || "Could not reach the server.");
      return true;
    },

    /** Forget the passcode on this device. Cloud data is untouched. */
    disconnect() {
      roomId = null;
      localStorage.removeItem(META_KEY);
      clearInterval(pollTimer);
      setStatus("local");
    },

    /** Manual "sync now". */
    refresh() { return reconcile(); },
  };

  globalThis.FAJTSync = api;

  addEventListener("online", () => reconcile({ silent: true }));
  addEventListener("offline", () => setStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconcile({ silent: true });
  });
})();
