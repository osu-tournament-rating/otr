'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

import { SITE_UPDATED_EVENT } from '@/lib/orpc/site-fetch';

/**
 * Offers a reload, once per page, when the site answers from another release
 * than the one this tab loaded. Until the tab reloads, its calls can fail
 * against procedures the release changed. It stays until dismissed, since only
 * page forms keep their input across the reload.
 */
export default function SiteUpdatedToast() {
  useEffect(() => {
    const show = () =>
      toast('o!TR has been updated', {
        id: SITE_UPDATED_EVENT,
        duration: Infinity,
        closeButton: true,
        action: {
          label: 'Reload',
          onClick: () => window.location.reload(),
        },
      });

    window.addEventListener(SITE_UPDATED_EVENT, show, { once: true });
    return () => window.removeEventListener(SITE_UPDATED_EVENT, show);
  }, []);

  return null;
}
