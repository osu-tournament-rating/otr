import { describe, expect, it } from 'bun:test';
import { VerificationStatus } from '@otr/core/osu';
import { Check } from 'lucide-react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Badge } from '@/components/kit/status/Badge';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';
import {
  OVERLAY_DISC_ALPHA,
  VerificationStatusIcon,
} from '@/components/kit/status/VerificationStatusIcon';
import { VerificationStatusDetails } from '@/components/kit/status/VerificationStatusTooltip';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  CONTRAST_MARK,
  composite,
  contrastRatio,
  parseColor,
  toHex,
} from '@/lib/kit/color/contrast';
import { VERIFICATION_COLORS } from '@/lib/kit/color/verification';
import { formatBadgeCount } from '@/lib/kit/status/count';

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

/** The class attribute of the first element. */
const rootClass = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? '';

describe('Badge', () => {
  it('sets counts in tabular figures', () => {
    for (const count of [3, formatBadgeCount(1_204, 9_999), '99+']) {
      const html = render(
        <Badge variant="solid" tone="primary" size="sm">
          {count}
        </Badge>
      );

      expect(rootClass(html).split(' ')).toContain('tabular-nums');
    }
  });

  it('keeps a count tabular when a screen-reader label follows it', () => {
    // The header's Admin › Reports count.
    const html = render(
      <Badge variant="solid" tone="primary" size="sm">
        {formatBadgeCount(3)}
        <span className="sr-only"> unseen</span>
      </Badge>
    );

    expect(rootClass(html).split(' ')).toContain('tabular-nums');
  });

  it('leaves words in proportional figures', () => {
    // Tabular figures widen Inter's hyphen: "Pre - verified".
    for (const label of ['Pre-verified', 'mania 4K', 'lazer']) {
      expect(rootClass(render(<Badge>{label}</Badge>))).not.toContain(
        'tabular-nums'
      );
    }

    expect(
      rootClass(
        render(
          <Badge tone="success">
            <Check />
            Passed
          </Badge>
        )
      )
    ).not.toContain('tabular-nums');
  });
});

describe('VerificationStatusBadge', () => {
  it('names the status without any figure override', () => {
    const html = render(
      <VerificationStatusBadge status={VerificationStatus.PreVerified} />
    );

    expect(html).toContain('Pre-verified');
    expect(html).not.toContain('tabular-nums');
    expect(html).not.toContain('proportional-nums');
  });
});

describe('VerificationStatusIcon overlay', () => {
  it('sets the glyph on a dark disc in the dark theme', () => {
    const html = render(
      <VerificationStatusIcon
        status={VerificationStatus.Verified}
        variant="overlay"
      />
    );
    const classes = rootClass(html).split(' ');

    expect(html).toContain('data-variant="overlay"');
    expect(classes).toContain('dark');
    expect(classes).toContain('rounded-full');
    expect(classes).toContain(`bg-black/${OVERLAY_DISC_ALPHA * 100}`);
    // A 16px glyph and 4px padding: a 24px disc and tap target.
    expect(classes).toContain('p-1');
  });

  it('keeps every glyph colour at 3:1 on the disc over white art', () => {
    const disc = toHex(
      composite(
        { ...parseColor('#000000'), alpha: OVERLAY_DISC_ALPHA },
        parseColor('#ffffff')
      )
    );
    for (const color of Object.values(VERIFICATION_COLORS)) {
      expect(contrastRatio(color.dark, disc)).toBeGreaterThanOrEqual(
        CONTRAST_MARK
      );
    }
  });

  it('adds no disc by default', () => {
    const html = render(
      <VerificationStatusIcon status={VerificationStatus.Rejected} />
    );
    expect(html).toContain('data-variant="default"');
    expect(html).not.toContain('bg-black');
  });
});

describe('VerificationStatusDetails', () => {
  /** The bubble's text, one entry per line. */
  const lines = (html: string) =>
    [...html.matchAll(/<(?:p|li)[^>]*>(.*?)<\/(?:p|li)>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, '')
    );

  it('heads the bubble with its context only when asked', () => {
    const details = {
      status: VerificationStatus.PreVerified,
      context: 'Game 3',
    };

    expect(lines(render(<VerificationStatusDetails {...details} />))).toEqual([
      'Pre-verified',
    ]);
    expect(
      lines(render(<VerificationStatusDetails {...details} showContext />))
    ).toEqual(['Game 3', 'Pre-verified']);
  });

  it('ends the status line with a colon when reasons or warnings follow', () => {
    const html = render(
      <VerificationStatusDetails
        status={VerificationStatus.Rejected}
        reviewer="apricot"
        rejectionReasons={['Prefix mismatch']}
        warnings={['Low game count']}
      />
    );

    expect(lines(html)).toEqual([
      'Rejected by apricot:',
      'Prefix mismatch',
      'Low game count',
    ]);
  });

  it('ends the status line with a colon before warnings alone', () => {
    const html = render(
      <VerificationStatusDetails
        status={VerificationStatus.PreVerified}
        warnings={['Low game count']}
      />
    );

    expect(lines(html)).toEqual(['Pre-verified:', 'Low game count']);
  });
});
