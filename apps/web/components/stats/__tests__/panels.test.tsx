import { describe, expect, it } from 'bun:test';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import TournamentsByLobbySizeChart from '@/components/stats/TournamentsByLobbySizeChart';
import TournamentsByRulesetChart from '@/components/stats/TournamentsByRulesetChart';
import TournamentsByYearChart from '@/components/stats/TournamentsByYearChart';
import TournamentVerificationChart from '@/components/stats/TournamentVerificationChart';
import { TooltipProvider } from '@/components/ui/tooltip';

/** The verification panel's tiles: how fast tournaments were verified lately. */
const SUMMARY = { windowDays: 90, tournaments: 108, medianDays: 4.5 };

/** Section headers carry an info button, which needs the tooltip provider. */
function render(element: React.ReactElement) {
  return renderToStaticMarkup(<TooltipProvider>{element}</TooltipProvider>);
}

describe('stats chart panels', () => {
  it('sit in a kit panel with a sentence-case section header and a count', () => {
    const html = render(
      <TournamentVerificationChart
        verificationCounts={{ '1': 12, '2': 54, '3': 387, '4': 2540 }}
        summary={SUMMARY}
      />
    );

    expect(html).toContain('data-slot="panel"');
    expect(html).toContain('data-testid="chart-tournament-verification"');
    expect(html).toContain('Tournament verification status');
    expect(html).toContain('2,993 tournaments');
    expect(html).toContain('data-slot="chart"');
    expect(html).not.toContain('text-primary');
  });

  it('name the counts with separators and lobby sizes by their field name', () => {
    const year = render(
      <TournamentsByYearChart data={{ '2023': 1413, '2024': 386 }} />
    );
    const lobby = render(<TournamentsByLobbySizeChart data={{ '1': 1166 }} />);

    expect(year).toContain('Tournaments by year');
    expect(year).toContain('1,799 verified');
    expect(lobby).toContain('Tournaments by lobby size');
    expect(lobby).not.toContain('Team size');
  });

  it('keep an info button only where it adds to the chart', () => {
    const verification = render(
      <TournamentVerificationChart
        verificationCounts={{ '4': 2540 }}
        summary={SUMMARY}
      />
    );
    const year = render(<TournamentsByYearChart data={{ '2024': 386 }} />);
    const ruleset = render(<TournamentsByRulesetChart data={{ '0': 12 }} />);
    const lobby = render(<TournamentsByLobbySizeChart data={{ '1': 1166 }} />);

    expect(verification).toContain('About tournament verification status');
    for (const html of [year, ruleset, lobby]) {
      expect(html).not.toContain('About tournaments by');
    }
  });

  it('show the shared empty state instead of an empty plot', () => {
    const verification = render(
      <TournamentVerificationChart verificationCounts={{}} summary={SUMMARY} />
    );
    const ruleset = render(<TournamentsByRulesetChart data={{}} />);

    expect(verification).toContain('data-slot="empty-state"');
    expect(verification).toContain('No verification data');
    expect(verification).not.toContain('data-slot="chart"');
    expect(ruleset).toContain('No verified tournaments yet');
  });
});
