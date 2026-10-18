'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

import { BUILD_ID } from '@/lib/build-id';
import {
  BUILD_CHECK_INTERVAL_MS,
  BUILD_CHECK_PATH,
  createSiteFetch,
  SITE_UPDATED_EVENT,
} from '@/lib/orpc/site-fetch';

/**
 * Offers a reload when the site answers from another release than the one this
 * tab loaded. Until the tab reloads, its calls can fail against procedures the
 * release changed. It cannot be dismissed, so it stays until the tab is on the
 * current release, but it never reloads by itself, since only page forms keep
 * their input across the reload.
 *
 * Most pages render on the server and make no /rpc calls from the tab, so the
 * tab also asks the site for its build every few minutes and whenever it comes
 * back into view.
 */
export default function SiteUpdatedToast() {
  useEffect(() => {
    let updated = false;

    const show = () => {
      updated = true;
      toast('o!TR has been updated', {
        id: SITE_UPDATED_EVENT,
        duration: Infinity,
        dismissible: false,
        action: {
          label: 'Reload',
          onClick: (event) => {
            // Sonner closes a toast after its action unless told not to.
            event.preventDefault();
            window.location.reload();
          },
        },
      });
    };

    const siteFetch = createSiteFetch({
      fetch: (request, init) => fetch(request, init),
      buildId: BUILD_ID,
      onOtherBuild: show,
    });

    const check = () => {
      if (updated || document.visibilityState !== 'visible') {
        return;
      }
      const request = new Request(
        new URL(BUILD_CHECK_PATH, window.location.origin),
        { method: 'HEAD', cache: 'no-store' }
      );
      // A failed check says nothing about the release; the next one retries.
      siteFetch(request).catch(() => {});
    };

    const interval = window.setInterval(check, BUILD_CHECK_INTERVAL_MS);
    window.addEventListener(SITE_UPDATED_EVENT, show);
    document.addEventListener('visibilitychange', check);
    check();

    return () => {
      window.clearInterval(interval);
      window.removeEventListener(SITE_UPDATED_EVENT, show);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  return null;
}
