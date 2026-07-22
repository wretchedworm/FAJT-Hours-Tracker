const {
  DAILY_TARGET_MINUTES,
  availableDays,
  cycleFor,
  durationText,
  entryInCycle,
  localISO,
  parseISO,
  parseTime,
  timeText,
  totalWorkedMinutes,
  weekdaysBetween,
  workMinutes,
} = globalThis.FAJTCalculations;

const STORAGE_KEY = "fajt-hours-v1";
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const defaultState = { version: 1, name: "", entries: [], openingBalances: {}, cycleSettings: {} };
let state = loadState();
let calendarDate = new Date();

const $ = (id) => document.getElementById(id);
const today = () => new Date();
const todayISO = () => localISO(today());
const cycleKey = (cycle) => `${localISO(cycle.start)}_${localISO(cycle.end)}`;

function loadState() {
  try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; }
  catch { return structuredClone(defaultState); }
}
function persist() {
  const sync = globalThis.FAJTSync;
  if (sync) state = sync.prepare(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  sync?.notifyLocalChange();
}
function saveState() { persist(); render(); }
function cycleEntries(cycle) { return state.entries.filter((entry) => entryInCycle(entry, cycle)); }
function currentSettings(cycle) { return state.cycleSettings[cycleKey(cycle)] || null; }
function openingBalance(cycle) { return Number(state.openingBalances[cycleKey(cycle)] || 0); }
function totalWorked(cycle) { return totalWorkedMinutes(cycleEntries(cycle), openingBalance(cycle)); }
function todayEntry() { return state.entries.find((entry) => entry.date === todayISO()); }

function formatDate(date, options = {}) { return new Intl.DateTimeFormat("en-SG", options).format(date); }
function inputDateLabel(iso) { return formatDate(parseISO(iso), { weekday:"long", day:"numeric", month:"long", year:"numeric" }); }
function isWeekend(date) { return date.getDay() === 0 || date.getDay() === 6; }
function showToast(message) { const el=$("toast"); el.textContent=message; el.classList.remove("hidden"); setTimeout(()=>el.classList.add("hidden"),2200); }

function render() {
  const now = today();
  const cycle = cycleFor(now);
  const settings = currentSettings(cycle);
  const entry = todayEntry();
  const weekdays = weekdaysBetween(cycle.start, cycle.end);
  const target = weekdays * DAILY_TARGET_MINUTES;
  const worked = totalWorked(cycle);
  const difference = target - worked;
  const nonWorking = settings?.nonWorkingDays || [];
  // Today stays an "available day" until it is clocked OUT. A still-open
  // clock-in means hours are yet to be logged today, so it still counts.
  const remainingDays = availableDays(cycle, now, nonWorking, Boolean(entry?.clockOut));
  const average = difference > 0 && remainingDays > 0 ? Math.ceil(difference / remainingDays) : 0;

  const partOfDay = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  $("greeting").textContent = state.name ? `${partOfDay}, ${state.name}` : partOfDay;
  $("todayLabel").textContent = formatDate(now, { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  $("todayDayBadge").innerHTML = `<small>${formatDate(now,{weekday:"short"}).toUpperCase()}</small><strong>${now.getDate()}</strong><small>${formatDate(now,{month:"short"}).toUpperCase()}</small>`;
  $("cycleLabel").textContent = `${formatDate(cycle.start,{day:"numeric",month:"short"})} – ${formatDate(cycle.end,{day:"numeric",month:"short",year:"numeric"})}`;
  $("cycleDaysBadge").textContent = `${weekdays} payable days · ${durationText(target)}`;
  $("payableMaximum").textContent = durationText(target);
  $("workedTotal").textContent = durationText(worked);
  $("remainingTitle").textContent = difference >= 0 ? "Hours left" : "Above target";
  $("remainingTotal").textContent = durationText(Math.abs(difference));
  $("averageNeeded").textContent = durationText(average);
  $("remainingDaysText").textContent = difference <= 0 ? "Target reached" : remainingDays ? `Across ${remainingDays} available day${remainingDays === 1 ? "" : "s"}` : "No available days remain";
  $("progressBar").style.width = `${Math.min(100, target ? worked / target * 100 : 0)}%`;

  const weekend = isWeekend(now);
  $("weekendMessage").classList.toggle("hidden", !weekend);
  $("clockInButton").disabled = weekend || Boolean(entry);
  $("clockOutButton").disabled = !entry || Boolean(entry.clockOut);
  if (!entry) {
    $("todayStatus").textContent = weekend ? "A non-working day" : "Ready to start?";
    $("todayDetails").classList.add("hidden");
  } else {
    $("todayStatus").textContent = entry.clockOut ? `${durationText(entry.netMinutes)} worked` : "Currently clocked in";
    $("todayDetails").classList.remove("hidden");
    $("todayDetails").innerHTML = detailChip("Clock in", timeText(entry.clockIn)) + detailChip(entry.clockOut ? "Clock out" : "Target out", timeText(entry.clockOut ?? entry.targetOut)) + detailChip(entry.clockOut ? "Net worked" : "Target", durationText(entry.netMinutes ?? entry.targetMinutes));
  }
  renderCalendar();
  renderEntries(cycle);
  // When sync is configured, the passcode/connect flow decides when to show
  // setup (after a chance to pull an existing cycle from the cloud). Only the
  // local-only build auto-opens setup here, otherwise it races over — and
  // buries — the passcode prompt on a fresh device.
  if (!settings && !globalThis.FAJTSync?.configured) setTimeout(() => openSetup(cycle), 80);
}

function maybeOpenSetup() {
  const cyc = cycleFor(today());
  if (!currentSettings(cyc)) { openSetup(cyc); return; }
  // Already set up but no name yet (e.g. an install from before names existed):
  // ask once so the greeting is personal.
  if (!state.name) openNamePrompt();
}

function openNamePrompt() {
  openModal("WELCOME", "What should we call you?",
    `<div class="summary-box"><p class="muted">Your name just personalises the greeting. It syncs to your other devices and stays private to your password.</p></div>
     <label class="field"><span>Your name</span><input id="nameInput" type="text" placeholder="e.g. Darren" value="${(state.name||"").replace(/"/g,"&quot;")}" autocomplete="given-name" maxlength="30"></label>
     <button id="saveName" class="button button-primary" style="width:100%">Save</button>`);
  const input = $("nameInput");
  input.focus();
  const save = () => { state.name = input.value.trim(); saveState(); closeModal(); if (state.name) showToast(`Hi, ${state.name}`); };
  $("saveName").onclick = save;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
}

function detailChip(label,value){ return `<div class="detail-chip"><small>${label}</small><strong>${value}</strong></div>`; }

function renderCalendar() {
  const year=calendarDate.getFullYear(), month=calendarDate.getMonth();
  $("monthLabel").textContent=formatDate(calendarDate,{month:"long",year:"numeric"});
  const first=new Date(year,month,1), days=new Date(year,month+1,0).getDate();
  const offset=(first.getDay()+6)%7;
  const currentCycle=cycleFor(today());
  const nonWorking=currentSettings(currentCycle)?.nonWorkingDays||[];
  let html="";
  for(let i=0;i<offset;i++) html += `<span class="calendar-day empty"></span>`;
  for(let day=1;day<=days;day++) {
    const date=new Date(year,month,day), iso=localISO(date), entry=state.entries.find(e=>e.date===iso);
    const classes=["calendar-day"];
    if(isWeekend(date)) classes.push("weekend");
    if(iso===todayISO()) classes.push("today");
    if(date>today()) classes.push("future");
    if(nonWorking.includes(date.getDay())) classes.push("day-off");
    if(entry?.clockOut) classes.push("worked");
    const disabled=isWeekend(date)||date>today();
    html += `<button class="${classes.join(" ")}" data-date="${iso}" ${disabled?"disabled":""}>${day}${entry?.clockOut?`<small>${durationText(entry.netMinutes)}</small>`:""}</button>`;
  }
  $("calendarGrid").innerHTML=html;
  $("calendarGrid").querySelectorAll("button[data-date]:not(:disabled)").forEach(btn=>btn.addEventListener("click",()=>openEntryForDate(btn.dataset.date)));
}

function renderEntries(cycle) {
  const balance=openingBalance(cycle), balanceRow=$("openingBalanceRow");
  balanceRow.classList.toggle("hidden", !balance);
  if(balance) balanceRow.innerHTML=`<div class="entry-date"><div class="date-tile">OB</div><div><p>Opening balance</p><small>Hours entered during setup</small></div></div><span class="entry-hours">${durationText(balance)}</span>`;
  const entries=cycleEntries(cycle).filter(e=>e.clockOut).sort((a,b)=>b.date.localeCompare(a.date));
  $("entriesList").innerHTML=entries.length?entries.map(entry=>`<div class="entry-row" data-id="${entry.id}"><div class="entry-date"><div class="date-tile">${parseISO(entry.date).getDate()}</div><div><p>${formatDate(parseISO(entry.date),{weekday:"long",day:"numeric",month:"short"})}${entry.isTest?` <span class="test-badge">Test</span>`:""}</p><small>${timeText(entry.clockIn)}–${timeText(entry.clockOut)}${entry.lunchMinutes?" · 30m lunch":""}</small></div></div><span class="entry-hours">${durationText(entry.netMinutes)}</span></div>`).join(""):`<p class="empty-state">No confirmed hours yet. Your daily breakdown will appear here.</p>`;
  $("entriesList").querySelectorAll("[data-id]").forEach(row=>row.addEventListener("click",()=>openEdit(row.dataset.id)));
}

function openModal(eyebrow,title,html,{locked=false}={}) {
  $("modalEyebrow").textContent=eyebrow; $("modalTitle").textContent=title; $("modalBody").innerHTML=html;
  $("closeModal").classList.toggle("hidden",locked); $("modalBackdrop").classList.remove("hidden"); document.body.style.overflow="hidden";
}
function closeModal(){ $("modalBackdrop").classList.add("hidden"); document.body.style.overflow=""; }

function openSetup(cycle) {
  const key=cycleKey(cycle);
  openModal("NEW PAY CYCLE","Set up this cycle",`
    <label class="field"><span>Your name</span><input id="setupName" type="text" placeholder="e.g. Darren" value="${(state.name||"").replace(/"/g,"&quot;")}" autocomplete="given-name" maxlength="30"></label>
    <p class="muted">Choose any weekdays you know you will not work. This only adjusts your daily average—not the cycle target.</p>
    <div class="field"><span>Regular non-working days</span><div class="check-grid">${[1,2,3,4,5].map(d=>`<label class="check-option"><input type="checkbox" name="offDay" value="${d}">${dayNames[d]}</label>`).join("")}</div></div>
    <div class="summary-box"><strong>Already worked this cycle?</strong><p class="muted">Enter an optional opening balance. You can also add detailed past entries afterward.</p><div class="split-fields"><label class="field"><span>Hours</span><input id="openingHours" type="number" min="0" value="0" inputmode="numeric"></label><label class="field"><span>Minutes</span><input id="openingMinutes" type="number" min="0" max="59" value="0" inputmode="numeric"></label></div></div>
    <p id="setupError" class="error-text"></p><button id="saveSetup" class="button button-primary" style="width:100%">Start this pay cycle</button>`,{locked:true});
  $("saveSetup").onclick=()=>{
    const offDays=[...document.querySelectorAll("input[name=offDay]:checked")].map(el=>Number(el.value));
    const hours=Number($("openingHours").value||0), minutes=Number($("openingMinutes").value||0);
    if(hours<0||minutes<0||minutes>59){$("setupError").textContent="Enter a valid opening balance.";return;}
    state.name=$("setupName").value.trim();
    state.cycleSettings[key]={nonWorkingDays:offDays,createdAt:new Date().toISOString()}; state.openingBalances[key]=hours*60+minutes; saveState(); closeModal(); showToast("Pay cycle ready");
  };
}

function timeField(id,label,value="") { return `<label class="field"><span>${label}</span><input id="${id}" type="text" inputmode="numeric" placeholder="e.g. 0715" value="${value}" autocomplete="off"></label>`; }

function openClockIn() {
  openModal("TODAY","Clock in",`${timeField("clockInTime","Clock-in time")}<div class="split-fields"><label class="field"><span>Target hours</span><input id="targetHours" type="number" min="0" value="6" inputmode="numeric"></label><label class="field"><span>Target minutes</span><input id="targetMinutes" type="number" min="0" max="59" value="30" inputmode="numeric"></label></div><div id="clockInPreview" class="summary-box hidden"></div><p id="clockInError" class="error-text"></p><button id="confirmClockIn" class="button button-primary" style="width:100%">Clock in</button>`);
  const preview=()=>{
    const start=parseTime($("clockInTime").value), target=Number($("targetHours").value||0)*60+Number($("targetMinutes").value||0);
    const box=$("clockInPreview"); if(start===null||target<=0){box.classList.add("hidden");return;}
    const targetOut=start+target+(start+target>12*60?30:0); box.classList.remove("hidden"); box.innerHTML=`<div class="summary-line"><span>Target clock-out</span><strong>${timeText(targetOut)}</strong></div><div class="summary-line"><span>Net target</span><strong>${durationText(target)}</strong></div>`;
  };
  ["clockInTime","targetHours","targetMinutes"].forEach(id=>$(id).addEventListener("input",preview));
  $("confirmClockIn").onclick=()=>{
    const start=parseTime($("clockInTime").value), h=Number($("targetHours").value||0), m=Number($("targetMinutes").value||0), target=h*60+m;
    if(start===null){$("clockInError").textContent="Enter a valid clock-in time.";return;} if(target<=0||m>59){$("clockInError").textContent="Enter a valid target duration.";return;}
    const targetOut=start+target+(start+target>12*60?30:0); if(targetOut>=1440){$("clockInError").textContent="The target must finish on the same day.";return;}
    state.entries.push({id:crypto.randomUUID(),date:todayISO(),clockIn:start,targetMinutes:target,targetOut,createdAt:new Date().toISOString()}); saveState(); closeModal(); showToast(`Target clock-out: ${timeText(targetOut)}`);
  };
}

function openClockOut() {
  const entry=todayEntry(); if(!entry)return;
  openModal("TODAY","Preview clock out",`${timeField("clockOutTime","Clock-out time")}<div id="clockOutPreview" class="summary-box highlight hidden"></div><p id="clockOutError" class="error-text"></p><button id="confirmClockOut" class="button button-primary" style="width:100%" disabled>Review and confirm</button>`);
  let result=null;
  $("clockOutTime").addEventListener("input",()=>{ const end=parseTime($("clockOutTime").value); result=workMinutes(entry.clockIn,end); const box=$("clockOutPreview"); if(!result){box.classList.add("hidden");$("confirmClockOut").disabled=true;return;} box.classList.remove("hidden");$("confirmClockOut").disabled=false;box.innerHTML=`<div class="summary-line"><span>Total elapsed</span><strong>${durationText(result.elapsed)}</strong></div><div class="summary-line"><span>Lunch deduction</span><strong>${result.lunch?"− 0h 30m":"None"}</strong></div><div class="summary-line"><span>Net hours worked</span><strong>${durationText(result.net)}</strong></div>`; });
  $("confirmClockOut").onclick=()=>{ if(!result)return; const end=parseTime($("clockOutTime").value); openConfirmClockOut(entry,end,result); };
}

function openConfirmClockOut(entry,end,result) {
  openModal("CONFIRM","Lock in these hours?",`<p class="muted">Check the details before saving. You can edit this record later if needed.</p><div class="summary-box highlight"><div class="summary-line"><span>Clock in</span><strong>${timeText(entry.clockIn)}</strong></div><div class="summary-line"><span>Clock out</span><strong>${timeText(end)}</strong></div><div class="summary-line"><span>Lunch</span><strong>${result.lunch?"30 minutes":"No deduction"}</strong></div><div class="summary-line"><span>Net worked</span><strong>${durationText(result.net)}</strong></div></div><div class="modal-actions"><button id="backToClockOut" class="button button-secondary">Go back</button><button id="lockClockOut" class="button button-primary">Confirm</button></div>`);
  $("backToClockOut").onclick=openClockOut;
  $("lockClockOut").onclick=()=>{Object.assign(entry,{clockOut:end,elapsedMinutes:result.elapsed,lunchMinutes:result.lunch,netMinutes:result.net,confirmedAt:new Date().toISOString()});saveState();closeModal();showToast(`${durationText(result.net)} saved`);};
}

function openEntryForDate(date) {
  const found=state.entries.find(e=>e.date===date); if(found) return openEdit(found.id);
  if(date===todayISO()) return openClockIn(); openManualEntry(date);
}

function openManualEntry(date) {
  openModal("PAST ENTRY",inputDateLabel(date),`${timeField("manualIn","Clock-in time")}${timeField("manualOut","Clock-out time")}<div id="manualPreview" class="summary-box hidden"></div><p id="manualError" class="error-text"></p><button id="saveManual" class="button button-primary" style="width:100%">Preview and save</button>`);
  const preview=()=>{const result=workMinutes($("manualIn").value,$("manualOut").value),box=$("manualPreview");if(!result){box.classList.add("hidden");return null;}box.classList.remove("hidden");box.innerHTML=`<div class="summary-line"><span>Lunch deduction</span><strong>${result.lunch?"30 minutes":"None"}</strong></div><div class="summary-line"><span>Net worked</span><strong>${durationText(result.net)}</strong></div>`;return result;};
  ["manualIn","manualOut"].forEach(id=>$(id).addEventListener("input",preview));
  $("saveManual").onclick=()=>{const start=parseTime($("manualIn").value),end=parseTime($("manualOut").value),result=workMinutes(start,end);if(!result){$("manualError").textContent="Clock-out must be later than clock-in on the same day.";return;}state.entries.push({id:crypto.randomUUID(),date,clockIn:start,clockOut:end,elapsedMinutes:result.elapsed,lunchMinutes:result.lunch,netMinutes:result.net,confirmedAt:new Date().toISOString()});saveState();closeModal();showToast("Entry saved");};
}

function openEdit(id) {
  const entry=state.entries.find(e=>e.id===id);if(!entry)return;
  openModal("EDIT ENTRY",inputDateLabel(entry.date),`${timeField("editIn","Clock-in time",timeText(entry.clockIn))}${timeField("editOut","Clock-out time",entry.clockOut!=null?timeText(entry.clockOut):"")}<div id="editPreview" class="summary-box"></div><p id="editError" class="error-text"></p><div class="modal-actions"><button id="deleteEntry" class="button button-danger">Delete</button><button id="saveEdit" class="button button-primary">Save changes</button></div>`);
  const preview=()=>{const result=workMinutes($("editIn").value,$("editOut").value),box=$("editPreview");box.innerHTML=result?`<div class="summary-line"><span>Lunch deduction</span><strong>${result.lunch?"30 minutes":"None"}</strong></div><div class="summary-line"><span>Net worked</span><strong>${durationText(result.net)}</strong></div>`:`<span>Enter a valid clock-in and clock-out time.</span>`;return result;};preview();
  ["editIn","editOut"].forEach(x=>$(x).addEventListener("input",preview));
  $("saveEdit").onclick=()=>{const start=parseTime($("editIn").value),end=parseTime($("editOut").value),result=workMinutes(start,end);if(!result){$("editError").textContent="Clock-out must be later than clock-in on the same day.";return;}Object.assign(entry,{clockIn:start,clockOut:end,elapsedMinutes:result.elapsed,lunchMinutes:result.lunch,netMinutes:result.net,updatedAt:new Date().toISOString()});saveState();closeModal();showToast("Entry updated");};
  $("deleteEntry").onclick=()=>{if(confirm("Delete this work entry?")){state.entries=state.entries.filter(e=>e.id!==id);saveState();closeModal();showToast("Entry deleted");}};
}

function openSettings() {
  const cycle=cycleFor(today()),key=cycleKey(cycle),settings=currentSettings(cycle)||{nonWorkingDays:[]},balance=openingBalance(cycle);
  openModal("SETTINGS","Current pay cycle",`<label class="field"><span>Your name</span><input id="settingsName" type="text" placeholder="e.g. Darren" value="${(state.name||"").replace(/"/g,"&quot;")}" autocomplete="given-name" maxlength="30"></label><div class="field"><span>Regular non-working days</span><div class="check-grid">${[1,2,3,4,5].map(d=>`<label class="check-option"><input type="checkbox" name="settingsOff" value="${d}" ${settings.nonWorkingDays.includes(d)?"checked":""}>${dayNames[d]}</label>`).join("")}</div></div><div class="split-fields"><label class="field"><span>Opening hours</span><input id="settingsHours" type="number" min="0" value="${Math.floor(balance/60)}"></label><label class="field"><span>Opening minutes</span><input id="settingsMinutes" type="number" min="0" max="59" value="${balance%60}"></label></div><p id="settingsError" class="error-text"></p><button id="saveSettings" class="button button-primary" style="width:100%">Save settings</button>${syncSettingsHTML()}<div class="test-zone"><p class="label">TESTING</p><button id="loadSampleData" class="reset-option test-option"><span><strong>Load sample test data</strong><small>Add example workdays across this cycle</small></span><b>›</b></button><p class="testing-note">Sample entries are marked “Test” and may include future dates. Reset the current cycle when finished.</p></div><div class="danger-zone"><p class="label">RESET DATA</p><button id="resetCycle" class="reset-option"><span><strong>Reset current pay cycle</strong><small>Delete this cycle's hours and setup only</small></span><b>›</b></button><button id="resetAll" class="reset-option"><span><strong>Reset all app data</strong><small>Delete every saved cycle and start over</small></span><b>›</b></button></div>`);
  $("saveSettings").onclick=()=>{const h=Number($("settingsHours").value||0),m=Number($("settingsMinutes").value||0);if(h<0||m<0||m>59){$("settingsError").textContent="Enter a valid opening balance.";return;}state.name=$("settingsName").value.trim();state.cycleSettings[key]={...settings,nonWorkingDays:[...document.querySelectorAll("input[name=settingsOff]:checked")].map(e=>Number(e.value))};state.openingBalances[key]=h*60+m;saveState();closeModal();showToast("Settings saved");};
  $("resetCycle").onclick=()=>openResetConfirmation("cycle",cycle);
  $("resetAll").onclick=()=>openResetConfirmation("all",cycle);
  $("loadSampleData").onclick=()=>openSampleDataConfirmation(cycle);
  wireSyncSettings();
}

/* ------------------------------------------------------------------ sync UI */

const SYNC_LABELS = {
  local:   { text: "Not syncing",        tone: "idle"    },
  offline: { text: "Offline — will sync", tone: "warn"   },
  syncing: { text: "Syncing…",            tone: "busy"   },
  synced:  { text: "Synced",              tone: "ok"     },
  error:   { text: "Sync problem",        tone: "error"  },
};

function syncSettingsHTML() {
  const sync = globalThis.FAJTSync;
  if (!sync?.configured) {
    return `<div class="sync-zone"><p class="label">SYNC</p><p class="testing-note">Cross-device sync is not configured yet. Add your Supabase URL and key to <b>config.js</b> to switch it on.</p></div>`;
  }
  if (!sync.connected) {
    return `<div class="sync-zone"><p class="label">SYNC</p><button id="syncConnect" class="reset-option"><span><strong>Turn on device sync</strong><small>Share your hours between phone and Mac</small></span><b>›</b></button></div>`;
  }
  const label = SYNC_LABELS[sync.status] || SYNC_LABELS.local;
  return `<div class="sync-zone"><p class="label">SYNC</p><p class="testing-note">Status: <b>${label.text}</b>${sync.statusDetail ? ` — ${sync.statusDetail}` : ""}</p><button id="syncNow" class="reset-option"><span><strong>Sync now</strong><small>Pull the latest from your other devices</small></span><b>›</b></button><button id="syncForget" class="reset-option"><span><strong>Stop syncing on this device</strong><small>Your cloud records are kept</small></span><b>›</b></button></div>`;
}

function wireSyncSettings() {
  const sync = globalThis.FAJTSync;
  if (!sync?.configured) return;
  const connect = $("syncConnect");
  if (connect) connect.onclick = () => openPasscodePrompt({ fromSettings: true });
  const now = $("syncNow");
  if (now) now.onclick = async () => { showToast("Syncing…"); await sync.refresh(); showToast(sync.status === "synced" ? "Up to date" : "Could not sync"); };
  const forget = $("syncForget");
  if (forget) forget.onclick = () => { sync.disconnect(); closeModal(); showToast("Sync turned off on this device"); };
}

function openPasscodePrompt({ fromSettings = false } = {}) {
  openModal(
    "SYNC",
    "Enter your sync password",
    `<div class="summary-box"><strong>Sync across your devices</strong><p class="muted">This password is the key to your own private records — use the same one on each device to see your hours everywhere. <b>Make it unique: anyone who enters the same password opens the same records, so skip easy ones like 1234.</b> It is never stored on our side, only used to unlock yours.</p></div><label class="field"><span>Password</span><input id="passcodeInput" type="password" autocomplete="current-password" placeholder="At least 4 characters"></label><p id="passcodeError" class="error-text"></p><button id="passcodeSubmit" class="button button-primary" style="width:100%">Connect this device</button>${fromSettings ? `<div class="modal-actions"><button id="passcodeCancel" class="button button-secondary">Cancel</button></div>` : ""}`
  );
  const input = $("passcodeInput");
  const submit = $("passcodeSubmit");
  const cancel = $("passcodeCancel");
  if (cancel) cancel.onclick = openSettings;
  // On a fresh device, dismissing the boot prompt should fall back to local
  // setup rather than leaving a blank screen. Restore the default X after.
  if (!fromSettings) {
    $("closeModal").onclick = () => { closeModal(); $("closeModal").onclick = closeModal; maybeOpenSetup(); };
  }
  input.focus();
  const go = async () => {
    submit.disabled = true;
    submit.textContent = "Connecting…";
    try {
      await globalThis.FAJTSync.connect(input.value);
      state = loadState();
      closeModal();
      render();
      showToast("Sync is on");
      // If the cloud had nothing for this passcode, this device still needs a
      // cycle set up. If it pulled an existing cycle, settings already exist.
      maybeOpenSetup();
    } catch (error) {
      $("passcodeError").textContent = error.message;
      submit.disabled = false;
      submit.textContent = "Connect this device";
    }
  };
  submit.onclick = go;
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
}

function renderSyncPill(status, detail) {
  const pill = $("syncPill");
  if (!pill) return;
  const sync = globalThis.FAJTSync;
  if (!sync?.configured || (!sync.connected && status === "local")) { pill.classList.add("hidden"); return; }
  const label = SYNC_LABELS[status] || SYNC_LABELS.local;
  pill.classList.remove("hidden");
  pill.dataset.tone = label.tone;
  pill.textContent = label.text;
  pill.title = detail || label.text;
}

function openSampleDataConfirmation(cycle) {
  openModal("TESTING","Load sample workdays?",`<div class="summary-box"><strong>What this adds</strong><p class="muted">Five example weekday entries across the current pay cycle, each with different hours. Existing dates will not be overwritten.</p></div><p class="notice">Some examples may be future dates. They are test records only and will be labelled in the breakdown.</p><div class="modal-actions"><button id="cancelSample" class="button button-secondary">Cancel</button><button id="confirmSample" class="button button-primary">Load samples</button></div>`);
  $("cancelSample").onclick=openSettings;
  $("confirmSample").onclick=()=>{
    const patterns=[
      {clockIn:8*60,clockOut:17*60+30},
      {clockIn:7*60+15,clockOut:17*60+30},
      {clockIn:8*60+30,clockOut:18*60},
      {clockIn:9*60,clockOut:17*60},
      {clockIn:7*60+45,clockOut:18*60+15},
    ];
    const weekdays=[];
    const cursor=new Date(cycle.start);
    while(cursor<=cycle.end) {
      if(cursor.getDay()!==0&&cursor.getDay()!==6) weekdays.push(localISO(cursor));
      cursor.setDate(cursor.getDate()+1);
    }
    const selected=[0,2,5,8,weekdays.length-1].map(index=>weekdays[index]).filter(Boolean);
    let added=0;
    selected.forEach((date,index)=>{
      if(state.entries.some(entry=>entry.date===date)) return;
      const pattern=patterns[index%patterns.length];
      const result=workMinutes(pattern.clockIn,pattern.clockOut);
      state.entries.push({id:crypto.randomUUID(),date,clockIn:pattern.clockIn,clockOut:pattern.clockOut,elapsedMinutes:result.elapsed,lunchMinutes:result.lunch,netMinutes:result.net,isTest:true,confirmedAt:new Date().toISOString()});
      added++;
    });
    saveState();
    closeModal();
    showToast(added?`${added} sample workdays added`:"Sample dates already have entries");
  };
}

function openResetConfirmation(scope, cycle) {
  const isAll=scope==="all";
  openModal("CONFIRM RESET",isAll?"Reset all app data?":"Reset this pay cycle?",`<div class="reset-warning"><strong>${isAll?"Everything saved in this browser will be deleted.":"All entries and settings for the current pay cycle will be deleted."}</strong><p>${isAll?"This includes every pay cycle, opening balance, regular days off, and work entry.":"Older pay cycles will remain untouched."}</p><p>This action cannot be undone.</p></div><label class="field"><span>Type <b>RESET</b> to confirm</span><input id="resetConfirmation" type="text" autocomplete="off" placeholder="RESET"></label><div class="modal-actions"><button id="cancelReset" class="button button-secondary">Cancel</button><button id="confirmReset" class="button button-danger" disabled>${isAll?"Reset everything":"Reset this cycle"}</button></div>`);
  $("cancelReset").onclick=openSettings;
  $("resetConfirmation").addEventListener("input",()=>{$("confirmReset").disabled=$("resetConfirmation").value.trim().toUpperCase()!=="RESET";});
  $("confirmReset").onclick=()=>{
    if(isAll) {
      state=structuredClone(defaultState);
    } else {
      const key=cycleKey(cycle);
      state.entries=state.entries.filter(entry=>!entryInCycle(entry,cycle));
      delete state.openingBalances[key];
      delete state.cycleSettings[key];
    }
    persist();
    closeModal();
    render();
    showToast(isAll?"All app data reset":"Current pay cycle reset");
  };
}

$("clockInButton").onclick=openClockIn; $("clockOutButton").onclick=openClockOut; $("settingsButton").onclick=openSettings; $("closeModal").onclick=closeModal;
$("modalBackdrop").addEventListener("click",e=>{if(e.target===$("modalBackdrop")&&!$("closeModal").classList.contains("hidden"))closeModal();});
$("prevMonth").onclick=()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1);renderCalendar();};
$("nextMonth").onclick=()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1);renderCalendar();};
$("addPastEntry").onclick=()=>{openModal("ADD HOURS","Choose a weekday",`<label class="field"><span>Date</span><input id="pastDate" type="date" max="${todayISO()}"></label><p id="pastDateError" class="error-text"></p><button id="continuePast" class="button button-primary" style="width:100%">Continue</button>`);$("continuePast").onclick=()=>{const value=$("pastDate").value,date=value&&parseISO(value);if(!date||date>today()||isWeekend(date)){$("pastDateError").textContent="Choose a past or current weekday.";return;}if(state.entries.some(e=>e.date===value)){$("pastDateError").textContent="An entry already exists for this date.";return;}openManualEntry(value);};};
if(location.protocol !== "file:" && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});

render();

/* ---------------------------------------------------------------- boot sync */

(async () => {
  const sync = globalThis.FAJTSync;
  if (!sync) return;

  sync.onStatus(renderSyncPill);

  // A device that pulled newer records from the cloud re-renders in place.
  sync.onRemoteUpdate = (merged) => {
    state = { ...defaultState, ...merged };
    render();
  };

  if (!sync.configured) return;

  const restored = await sync.restore();
  if (restored) {
    state = loadState();
    render();
    maybeOpenSetup();
  } else {
    openPasscodePrompt();
  }
})();
