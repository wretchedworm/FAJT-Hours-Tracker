import test from "node:test";
import assert from "node:assert/strict";
await import("./calculations.js");
const { availableDays, cycleFor, parseTime, totalWorkedMinutes, weekdaysBetween, workMinutes } = globalThis.FAJTCalculations;

test("accepts compact and colon time formats",()=>{
  assert.equal(parseTime("0715"),435); assert.equal(parseTime("7:15"),435); assert.equal(parseTime("800"),480); assert.equal(parseTime("2560"),null);
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
