/**
 * FAJT Hours — the one place your records are kept.
 *
 *   get()          the current state (never mutate it; make a new one)
 *   update(next)   adopt a new state: stamp what changed, save it to this
 *                  device, tell sync to push it, tell subscribers
 *   subscribe(fn)  called with the state after every change, local or remote
 *   replace(next)  for sync only: adopt a merged state exactly as given
 *
 * This device's localStorage is always the source of truth for reading. The
 * cloud (sync.js) is a mirror; it reads from here and hands merged results
 * back through replace().
 */
(() => {
  const { withDefaults } = globalThis.FAJTOperations;

  const LOCAL_KEY = "fajt-hours-v1";
  const SNAPSHOT_KEY = "fajt-sync-snapshot-v1";

  const readJSON = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  };
  const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  /* ------------------------------------------------------ change stamps */

  const byDate = (entries) => {
    const map = {};
    (entries || []).forEach((entry) => { if (entry?.date) map[entry.date] = entry; });
    return map;
  };
  const settingsFingerprint = (state) =>
    JSON.stringify([state?.openingBalances || {}, state?.cycleSettings || {}, state?.name || ""]);

  /**
   * Compare the state about to be saved against the last snapshot and record
   * WHEN each day changed, so two devices can be merged day by day later.
   */
  function stampChanges(state) {
    const prev = readJSON(SNAPSHOT_KEY, null);
    const now = Date.now();
    const entryStamps = { ...(state.entryStamps || {}) };
    const deletedEntries = { ...(state.deletedEntries || {}) };
    const current = byDate(state.entries);
    const previous = byDate(prev?.entries);

    for (const date of Object.keys(current)) {
      const changed = !previous[date] ||
        JSON.stringify(previous[date]) !== JSON.stringify(current[date]);
      if (changed || !entryStamps[date]) {
        entryStamps[date] = now;
        delete deletedEntries[date];
      }
    }
    for (const date of Object.keys(previous)) {
      if (!current[date]) {
        deletedEntries[date] = now;
        delete entryStamps[date];
      }
    }
    const settingsChanged = !prev || settingsFingerprint(prev) !== settingsFingerprint(state);
    const settingsUpdatedAt = settingsChanged ? now : (state.settingsUpdatedAt || now);
    return { ...state, entryStamps, deletedEntries, settingsUpdatedAt };
  }

  /* --------------------------------------------------------------- store */

  let state = withDefaults(readJSON(LOCAL_KEY, null));
  const listeners = [];
  const notify = () => listeners.forEach((fn) => { try { fn(state); } catch { /* ignore */ } });

  globalThis.FAJTStore = {
    get() { return state; },

    update(next) {
      state = stampChanges(withDefaults(next));
      writeJSON(LOCAL_KEY, state);
      writeJSON(SNAPSHOT_KEY, state);
      globalThis.FAJTSync?.notifyLocalChange();
      notify();
    },

    replace(next) {
      state = withDefaults(next);
      writeJSON(LOCAL_KEY, state);
      writeJSON(SNAPSHOT_KEY, state);
      notify();
    },

    subscribe(fn) { listeners.push(fn); },
  };
})();
