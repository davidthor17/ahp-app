// Phase 5.8 P0-A — the console may offer to update, never take it.
//
// A real auditor ran a 5 August bundle through September, across three
// production deployments, and never received the iPhone Finish button fix that
// had already shipped. The generated registerSW.js was a bare
// navigator.serviceWorker.register with no update handling, because
// registerType 'autoUpdate' was set while virtual:pwa-register was never
// imported. Nothing called registration.update(), the browser only checks on a
// navigation, and a resumed iOS PWA never navigates.
//
// The obvious repair is the dangerous one. autoUpdate, wired correctly,
// reloads the page as soon as a new worker activates, and the write queue is
// in memory: an automatic reload loses grades the auditor has already made and
// believes are saved. So the rules asserted here are:
//
//   nothing reloads on its own, in any state
//   a reload is refused outright while writes are outstanding
//   a bundle that has been running too long says so, even with no update found

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UPDATE_STATE, UPDATE_CHECK_INTERVAL_MS, STALE_BUILD_AFTER_MS,
  canReload, isStaleBuild, buildAgeDays, updateBannerState,
  shouldShowUpdateBanner, shouldAutoReload, shouldCheckOnVisibility,
  updateBannerText,
} from '../src/framework/appUpdate.js';

const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

// ── nothing reloads on its own ──────────────────────────────────────────────

test('the app never reloads itself, whatever is true', () => {
  // The single most important assertion in this file.
  assert.equal(shouldAutoReload(), false);
  assert.equal(shouldAutoReload({ needRefresh: true, pendingWrites: 0 }), false);
  assert.equal(shouldAutoReload({ needRefresh: true, pendingWrites: 5 }), false);
});

test('an available update is an offer, not an action', () => {
  const state = updateBannerState({ needRefresh: true, pendingWrites: 0, now: NOW });
  assert.equal(state, UPDATE_STATE.AVAILABLE);
  assert.equal(shouldShowUpdateBanner(state), true, 'the auditor is told');
  assert.equal(shouldAutoReload(), false, 'and nothing happens until they say so');
});

// ── a reload cannot happen while writes are pending ─────────────────────────

test('a reload is refused while anything is unsaved', () => {
  assert.equal(canReload({ pendingWrites: 1 }), false);
  assert.equal(canReload({ pendingWrites: 12 }), false);
  assert.equal(canReload({ pendingWrites: 0 }), true);
  assert.equal(canReload({}), true);
});

test('an update with pending writes is blocked, not offered', () => {
  const state = updateBannerState({ needRefresh: true, pendingWrites: 3, now: NOW });
  assert.equal(state, UPDATE_STATE.BLOCKED);
  assert.notEqual(state, UPDATE_STATE.AVAILABLE, 'no update button in this state');
  assert.match(updateBannerText(state, { pendingWrites: 3 }), /3 changes still to save/);
});

test('the block clears by itself once the queue drains', () => {
  // The auditor does nothing; the flush does it for them.
  assert.equal(updateBannerState({ needRefresh: true, pendingWrites: 2, now: NOW }), UPDATE_STATE.BLOCKED);
  assert.equal(updateBannerState({ needRefresh: true, pendingWrites: 0, now: NOW }), UPDATE_STATE.AVAILABLE);
});

test('one unsaved change is enough to block, and reads as singular', () => {
  assert.equal(canReload({ pendingWrites: 1 }), false);
  assert.match(updateBannerText(UPDATE_STATE.BLOCKED, { pendingWrites: 1 }), /1 change still to save/);
});

// ── the build-age backstop ──────────────────────────────────────────────────

test('a fresh build is not stale and shows nothing', () => {
  const state = updateBannerState({ needRefresh: false, buildTime: daysAgo(1), now: NOW });
  assert.equal(state, UPDATE_STATE.CURRENT);
  assert.equal(shouldShowUpdateBanner(state), false);
});

test('a bundle older than the threshold says so with no update found', () => {
  // The failure that actually happened: the check was never running, so the
  // app had nothing to report and reported nothing for five weeks.
  const state = updateBannerState({ needRefresh: false, buildTime: daysAgo(35), now: NOW });
  assert.equal(state, UPDATE_STATE.STALE);
  assert.equal(shouldShowUpdateBanner(state), true);
  assert.match(updateBannerText(state, { ageDays: 35 }), /35 days old/);
});

test('the August bundle would have been flagged', () => {
  // 5 August running on 9 September.
  const buildTime = '2026-08-05T00:00:00.000Z';
  assert.equal(isStaleBuild({ buildTime, now: NOW }), true);
  assert.equal(buildAgeDays({ buildTime, now: NOW }), 35);
});

test('the threshold is two weeks and the check interval half an hour', () => {
  assert.equal(STALE_BUILD_AFTER_MS, 14 * 24 * 60 * 60 * 1000);
  assert.equal(UPDATE_CHECK_INTERVAL_MS, 30 * 60 * 1000);
  assert.equal(isStaleBuild({ buildTime: daysAgo(13), now: NOW }), false);
  assert.equal(isStaleBuild({ buildTime: daysAgo(15), now: NOW }), true);
});

test('an unknown or unreadable build time is never called stale', () => {
  // Guessing would put a warning in front of an auditor mid-audit for nothing.
  for (const buildTime of [null, undefined, '', 'not a date', {}]) {
    assert.equal(isStaleBuild({ buildTime, now: NOW }), false, `${JSON.stringify(buildTime)}`);
    assert.equal(buildAgeDays({ buildTime, now: NOW }), null);
  }
});

test('a waiting update outranks staleness, because it is the actionable one', () => {
  const state = updateBannerState({ needRefresh: true, pendingWrites: 0, buildTime: daysAgo(40), now: NOW });
  assert.equal(state, UPDATE_STATE.AVAILABLE);
});

test('a stale bundle with unsaved writes still reports the block first', () => {
  const state = updateBannerState({ needRefresh: true, pendingWrites: 4, buildTime: daysAgo(40), now: NOW });
  assert.equal(state, UPDATE_STATE.BLOCKED);
});

// ── when the app asks ───────────────────────────────────────────────────────

test('a resumed app checks for updates when it becomes visible', () => {
  // The iOS case. A standalone PWA is resumed rather than relaunched, fires
  // visibilitychange and never navigates, so this is the only moment it gets.
  assert.equal(shouldCheckOnVisibility({ visibilityState: 'visible' }), true);
});

test('an app going away does not check on its way out', () => {
  assert.equal(shouldCheckOnVisibility({ visibilityState: 'hidden' }), false);
});

test('the default is to check, so a missing visibilityState does not silence it', () => {
  assert.equal(shouldCheckOnVisibility({}), true);
  assert.equal(shouldCheckOnVisibility(), true);
});

// ── the banner itself ───────────────────────────────────────────────────────

test('every non-current state produces text, and current produces none', () => {
  assert.equal(updateBannerText(UPDATE_STATE.CURRENT), '');
  for (const state of [UPDATE_STATE.AVAILABLE, UPDATE_STATE.BLOCKED, UPDATE_STATE.STALE]) {
    assert.ok(updateBannerText(state, { pendingWrites: 2, ageDays: 30 }).length > 0, state);
  }
});

test('the stale message works without a known age', () => {
  assert.match(updateBannerText(UPDATE_STATE.STALE, { ageDays: null }), /may be out of date/);
});

test('no banner text tells the auditor the app will restart on its own', () => {
  for (const state of [UPDATE_STATE.AVAILABLE, UPDATE_STATE.BLOCKED, UPDATE_STATE.STALE]) {
    const text = updateBannerText(state, { pendingWrites: 2, ageDays: 30 });
    assert.equal(/automatic|will restart|restarting/i.test(text), false, state);
  }
});
