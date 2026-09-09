/**
 * When the console may reload itself, and when it must not.
 *
 * Phase 5.8 P0-A. A real auditor ran a 5 August bundle through September,
 * across at least three production deployments, and never saw the iPhone
 * Finish button fix that had already shipped. The cause was in one file:
 *
 *   if('serviceWorker' in navigator) {
 *     window.addEventListener('load', () => {
 *       navigator.serviceWorker.register('/sw.js', { scope: '/' })
 *     })
 *   }
 *
 * That is the whole of the generated registerSW.js. vite-plugin-pwa emits it
 * when registerType is 'autoUpdate' but the virtual:pwa-register module is
 * never imported, which is what main.jsx did. So:
 *
 *   - registration.update() was never called by the app, and the browser only
 *     checks on a navigation
 *   - an installed iOS PWA is resumed, not relaunched, so it can go weeks with
 *     no navigation and therefore no check
 *   - the worker had skipWaiting and clientsClaim, so a new worker took over
 *     as soon as it was fetched, but the page never reloaded and the old
 *     JavaScript stayed in memory regardless
 *   - nothing ever told the auditor their bundle was old
 *
 * The naive repair is worse than the fault. Wiring autoUpdate up properly
 * would reload the page the moment a new worker activated, and an automatic
 * reload destroys the in-memory write queue from P0-2. So the rule here is
 * that a reload is always the auditor's decision, and is refused outright
 * while anything is unsaved.
 *
 * Everything in this module is pure so it can be tested without a browser,
 * a service worker, or a device that has been left alone for a month.
 */

/** How often to ask the server whether a new build exists. */
export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * How old a running bundle may get before it is called out on its own.
 *
 * The backstop for the failure that actually happened: if the update check is
 * silently not working, "no update available" and "I have not successfully
 * asked in five weeks" look identical from inside the app. Age is measured
 * against the build stamp, so it is true even when every check has failed.
 */
export const STALE_BUILD_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export const UPDATE_STATE = Object.freeze({
  CURRENT: 'current',
  AVAILABLE: 'available',
  BLOCKED: 'blocked',
  STALE: 'stale',
});

/**
 * Is a reload safe right now?
 *
 * Only ever true with nothing outstanding. The queue lives in memory, so a
 * reload with pending writes loses grades the auditor has already made and
 * believes are recorded.
 */
export function canReload({ pendingWrites = 0 } = {}) {
  return pendingWrites === 0;
}

/**
 * Has this build been running long enough that something is probably wrong?
 *
 * Unknown or unparseable build times are never stale. Guessing would put a
 * warning in front of an auditor mid-audit for no reason.
 */
export function isStaleBuild({ buildTime, now = Date.now(), maxAgeMs = STALE_BUILD_AFTER_MS } = {}) {
  if (!buildTime) return false;
  const built = typeof buildTime === 'number' ? buildTime : Date.parse(buildTime);
  if (!Number.isFinite(built)) return false;
  return now - built > maxAgeMs;
}

/** Whole days this build has been running, for the message. */
export function buildAgeDays({ buildTime, now = Date.now() } = {}) {
  if (!buildTime) return null;
  const built = typeof buildTime === 'number' ? buildTime : Date.parse(buildTime);
  if (!Number.isFinite(built)) return null;
  return Math.max(0, Math.floor((now - built) / (24 * 60 * 60 * 1000)));
}

/**
 * What the update banner should say, if anything.
 *
 * A waiting update outranks staleness, because it is the actionable one: the
 * new build is already downloaded and one tap away. Staleness only shows when
 * no update is waiting, which is exactly the case where the check is failing
 * and the auditor would otherwise be told nothing at all.
 */
export function updateBannerState({
  needRefresh = false,
  pendingWrites = 0,
  buildTime = null,
  now = Date.now(),
  maxAgeMs = STALE_BUILD_AFTER_MS,
} = {}) {
  if (needRefresh) {
    return canReload({ pendingWrites }) ? UPDATE_STATE.AVAILABLE : UPDATE_STATE.BLOCKED;
  }
  if (isStaleBuild({ buildTime, now, maxAgeMs })) return UPDATE_STATE.STALE;
  return UPDATE_STATE.CURRENT;
}

/** Should the banner be shown at all? */
export const shouldShowUpdateBanner = (state) => state !== UPDATE_STATE.CURRENT;

/**
 * May the app reload itself, given everything it knows?
 *
 * The answer is always no. There is no argument that makes this true: a
 * reload is offered, never taken. The function exists so the rule is written
 * down once and asserted in the tests, rather than living as the absence of a
 * call somewhere in a component.
 */
export const shouldAutoReload = () => false;

/**
 * Should a visibility, focus or online event trigger an update check?
 *
 * The iOS case this exists for: a PWA that has been resumed rather than
 * relaunched fires visibilitychange and never navigates, so this is the only
 * moment the app gets to ask. Hidden means the app is going away, not coming
 * back, so there is nothing to ask on behalf of.
 */
export function shouldCheckOnVisibility({ visibilityState = 'visible' } = {}) {
  return visibilityState === 'visible';
}

/** Wording for each state. Kept here so the tests can read it. */
export function updateBannerText(state, { pendingWrites = 0, ageDays = null } = {}) {
  switch (state) {
    case UPDATE_STATE.AVAILABLE:
      return 'A new version of the console is ready.';
    case UPDATE_STATE.BLOCKED:
      return `A new version is ready. ${pendingWrites} change${pendingWrites === 1 ? '' : 's'} still to save, so updating is held until ${pendingWrites === 1 ? 'it is' : 'they are'} stored.`;
    case UPDATE_STATE.STALE:
      return ageDays === null
        ? 'This copy of the console may be out of date.'
        : `This copy of the console is ${ageDays} days old and may be missing fixes.`;
    default:
      return '';
  }
}
