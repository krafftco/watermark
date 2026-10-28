// The role (28 Oct): one image, two kinds of process. ROLE unset is the house as it always ran; 'web' runs no chore of
// the house (the governor says so, its boot lane skips, except a web process's own housekeeping marked always);
// 'worker' runs them all. Each role is a fresh process, since the role is read once at require.
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const probe = `
  const express = require('express'); const { mountGovernor } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'governor'))});
  const ROLE = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'role'))});
  const gov = mountGovernor(express(), { bootQuietS: 0.02, bootGapS: 0.01, pauseMs: 1 });
  const ran = []; gov.boot('chore', () => { ran.push('chore'); }); gov.boot('own', () => { ran.push('own'); }, 0, { always: true });
  setTimeout(() => console.log(JSON.stringify({ role: ROLE.role, web: ROLE.web, chores: ROLE.chores, worker: ROLE.worker, split: ROLE.split, gov: gov.chores(), ran })), 150);
`;
const run = role => JSON.parse(execFileSync(process.execPath, ['-e', probe], { env: { ...process.env, ROLE: role || '', NODE_ENV: 'test' }, encoding: 'utf8' }).trim().split('\n').pop());

const all = run(''); assert.deepEqual([all.role, all.web, all.chores, all.worker, all.split, all.gov], ['all', true, true, false, false, true], 'unset: everything in one process'); assert.deepEqual(all.ran.sort(), ['chore', 'own']);
const web = run('web'); assert.deepEqual([web.web, web.chores, web.worker, web.split, web.gov], [true, false, false, true, false], 'web: serves, no chores'); assert.deepEqual(web.ran, ['own'], 'the web keeps only its own housekeeping');
const worker = run('worker'); assert.deepEqual([worker.web, worker.chores, worker.worker, worker.split, worker.gov], [false, true, true, true, true], 'worker: every chore'); assert.deepEqual(worker.ran.sort(), ['chore', 'own']);
console.log('role: all hold');
