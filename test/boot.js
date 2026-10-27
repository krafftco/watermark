// The quiet boot (27 Oct): the house's start-up chores run after a quiet spell, one at a time, in order, through the lane,
// and are skipped when the chores are held.
const assert = require('assert');
const express = require('express');
const { mountGovernor } = require('../src/governor');
(async () => {
  const app = express(); const gov = mountGovernor(app, { bootQuietS: 0.05, bootGapS: 0.02, pauseMs: 1 });
  const ran = [];
  gov.boot('one', async () => { await new Promise(r => setTimeout(r, 40)); ran.push('one'); });
  gov.boot('two', () => { ran.push('two'); });
  gov.boot('three', () => { throw new Error('a chore that fails'); });
  gov.boot('four', () => { ran.push('four'); });
  await new Promise(r => setTimeout(r, 400));
  assert.deepEqual(ran, ['one', 'two', 'four'], 'in order, one at a time, a failure contained: ' + ran);
  assert.deepEqual(gov.state().boots, ['one', 'two', 'three', 'four']);
  gov.hold(true); const held = []; gov.boot('five', () => { held.push('five'); });
  await new Promise(r => setTimeout(r, 200)); assert.deepEqual(held, [], 'held: skipped');
  gov.hold(false);
  assert.ok(gov.state().limit > 0, 'a memory line');
  console.log('boot: all hold');
})().catch(e => { console.error(e); process.exit(1); });
