import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OsuAvatar } from '@/components/ui/osu-avatar';

describe('OsuAvatar', () => {
  // An avatar that loads slowly, or whose request never ends, fires no error,
  // so a placeholder shown only after an error left the slot empty (#919).
  it('sends the placeholder with the avatar, before the avatar loads', () => {
    const html = renderToStaticMarkup(
      <OsuAvatar osuId={2} username="peppy" size={24} />
    );

    expect(html).toContain('data-slot="avatar-fallback"');
    expect(html).toContain('alt="peppy&#x27;s avatar"');
  });
});
