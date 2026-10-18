'use client';

import { Info, RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/kit/controls/Button';
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
      toast.custom(() => <SiteUpdatedNotice />, {
        id: SITE_UPDATED_EVENT,
        duration: Infinity,
        dismissible: false,
        position: 'bottom-center',
        // The notice draws its own pill, so the toast around it fills the
        // stack to centre it and drops the Toaster's surface.
        className: 'w-full bg-transparent! shadow-none!',
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

/**
 * A pill centred under the page, set apart from the action toasts in the
 * corner. The reload icon turns every few seconds to draw the eye, and stays
 * still for visitors who ask for reduced motion.
 */
function SiteUpdatedNotice() {
  return (
    <div className="flex w-full justify-center">
      {/* rounded-3xl, not full: on the narrowest phones the text wraps. */}
      <div className="flex max-w-full items-center gap-4 rounded-3xl border bg-background py-2 pr-2 pl-4 text-foreground shadow-lg dark:bg-popover">
        <div className="flex min-w-0 items-center gap-2">
          <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">o!TR has been updated</span>
        </div>
        <Button
          icon={RotateCw}
          className="shrink-0 rounded-full motion-safe:[&_svg]:animate-spin-pause"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
