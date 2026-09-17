import test from "node:test";
import assert from "node:assert/strict";
await import("./calculations.js");
const { availableDays, cycleFor, parseTime, targetClockOut, totalWorkedMinutes, weekdaysBetween, workMinutes } = globalThis.FAJTCalculations;

test("accepts compact and colon time formats",()=>{
  assert.equal(parseTime("0715"),435); assert.equal(parseTime("7:15"),435); assert.equal(parseTime("800"),480); assert.equal(parseTime("2560"),null);
  assert.equal(parseTime(""),null); assert.equal(parseTime("   "),null); assert.equal(parseTime("0000"),0);
});
test("deducts lunch only after noon",()=>{
  assert.deepEqual(workMinutes("0800","1200"),{elapsed:240,lunch:0,net:240});
  assert.deepEqual(workMinutes("0715","1730"),{elapsed:615,lunch:30,net:585});
  assert.equal(workMinutes("1700","0800"),null);
});
test("calculates July 2026 pay cycle weekday targets",()=>{
  const first=cycleFor(new Date(2026,6,10)); const second=cycleFor(new Date(2026,6,27));
  assert.equal(weekdaysBetween(first.start,first.end),11); assert.equal(weekdaysBetween(second.start,second.end),12);
});
test("remaining days exclude selected regular days off",()=>{
  const cycle=cycleFor(new Date(2026,6,27));
  assert.equal(availableDays(cycle,new Date(2026,6,27),[4],true),3);
  assert.equal(availableDays(cycle,new Date(2026,6,27),[4],false),4);
});
test("includes the final weekday even when today has a time component",()=>{
  const cycle=cycleFor(new Date(2026,6,17,14,30));
  assert.equal(availableDays(cycle,new Date(2026,6,17,14,30),[4],false),9);
  assert.equal(availableDays(cycle,new Date(2026,6,17,14,30),[4],true),8);
});
test("unfinished clock-ins do not corrupt worked totals",()=>{
  const entries=[
    {clockIn:435,targetMinutes:390,targetOut:855},
    {clockIn:480,clockOut:1020,netMinutes:510},
  ];
  assert.equal(totalWorkedMinutes(entries,60),570);
});
test("target clock-out adds lunch only when the target runs past noon",()=>{
  assert.equal(targetClockOut(480,240),720);   // 08:00 + 4h ends exactly at noon, no lunch
  assert.equal(targetClockOut(435,390),855);   // 07:15 + 6h30 crosses noon, +30m lunch
  assert.equal(targetClockOut("0715",390),855);
});
test("target clock-out is null when it would not finish the same day",()=>{
  assert.equal(targetClockOut(1380,120),null); // 23:00 + 2h
  assert.equal(targetClockOut(null,390),null);
});
