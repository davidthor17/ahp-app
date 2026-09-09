/**
 * The browser half of the update lifecycle.
 *
 * Everything that decides anything lives in framework/appUpdate.js and is
 * tested. This file only talks to the service worker, and is kept small and
 * dependency-light so there is little here that can be wrong.
 *
 * The one job that matters: ask whether a new build exists at moments an
 * installed iOS PWA actually reaches. A resumed PWA fires visibilitychange and
 * never navigates, so the browser's own update check never runs. That is why a
 * 5 August build was still serving in September.
 */

import { registerSW } from 'virtual:pwa-register';
import { UPDATE_CHECK_INTERVAL_MS, shouldCheckOnVisibility } from './framework/appUpdate.js';

/**
 * Register the worker and start watching for new builds.
 *
 * @param {(needRefresh: boolean) => void} onNeedRefresh
 *        called with true when a new build is downloaded and waiting
 * @returns {() => Promise<void>} applies the waiting update and reloads.
 *        Never called by this module: the caller decides, and refuses while
 *        writes are outstanding.
 */
export function initServiceWorkerUpdates(onNeedRefresh) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return async () => {};
  }

  let swRegistration = null;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      onNeedRefresh(true);
    },
    onRegisteredSW(_url, registration) {
      swRegistration = registration || null;
      if (!swRegistration) return;

      const check = () => {
        // update() rejects when offline, which is normal at a property and not
        // worth surfacing. The build-age backstop is what catches a check that
        // has been failing for weeks.
        try { swRegistration.update().catch(() => {}); } catch (e) { /* ignore */ }
      };

      // The periodic check covers a session left open all day.
      setInterval(check, UPDATE_CHECK_INTERVAL_MS);

      // These three cover the cases the interval cannot: an installed PWA that
      // was suspended rather than closed, a tab brought back to the front, and
      // a device that has just regained signal. On iOS the visibility hook is
      // the only one that reliably fires for a standalone app.
      document.addEventListener('visibilitychange', () => {
        if (shouldCheckOnVisibility({ visibilityState: document.visibilityState })) check();
      });
      window.addEventListener('focus', check);
      window.addEventListener('online', check);

      // And once now, because the app may have started on a stale shell.
      check();
    },
  });

  // Resolves after the waiting worker takes over and the page reloads.
  return () => updateSW(true);
}
