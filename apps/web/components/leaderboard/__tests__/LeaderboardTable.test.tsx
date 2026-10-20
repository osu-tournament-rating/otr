import { describe, expect, it } from 'bun:test';
import { Ruleset } from '@otr/core/osu';
import { renderToStaticMarkup } from 'react-dom/server';

import { LEADERBOARD_LIST_PARAMS } from '@/app/leaderboard/list-params';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getDefaultListState } from '@/lib/kit/lists/params';
import type { LeaderboardEntry } from '@/lib/orpc/schema/leaderboard';

import LeaderboardTable from '../LeaderboardTable';

function entry(
  id: number,
  username: string,
  country: string,
  globalRank: number
): LeaderboardEntry {
  return {
    ruleset: Ruleset.Osu,
    rating: 2500 - globalRank,
    volatility: 100,
    percentile: 0.99,
    globalRank,
    countryRank: globalRank,
    player: { id, osuId: id * 10, username, country },
    tournamentsPlayed: 12,
    matchesPlayed: 80,
    winRate: 0.625,
    tier: 'grandmaster',
    tierProgress: {
      currentTier: 'Grandmaster',
      currentSubTier: 1,
      nextTier: 'Elite Grandmaster',
      nextSubTier: null,
      ratingForNextTier: 2600,
      ratingForNextMajorTier: 2600,
      nextMajorTier: 'Elite Grandmaster',
      subTierFillPercentage: 0.5,
      majorTierFillPercentage: 0.5,
    },
    lastMatchTime: '2026-10-01T12:00:00.000Z',
    inactive: false,
  };
}

const render = (rows: LeaderboardEntry[]) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <LeaderboardTable
        rows={rows}
        state={getDefaultListState(LEADERBOARD_LIST_PARAMS)}
        currentPlayerId={null}
      />
    </TooltipProvider>
  );

/** The markup of the element whose opening tag carries `attribute`. */
function section(html: string, attribute: string, closing: string): string {
  const start = html.indexOf(attribute);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf(closing, start));
}

describe('LeaderboardTable', () => {
  it('puts the 32px avatar beside the phone row, linking out of the tab order', () => {
    const html = render([entry(1, 'mrekk', 'AU', 2)]);
    const phoneRow = section(
      html,
      'data-testid="leaderboard-phone-row-1"',
      '</li>'
    );

    const leading = section(phoneRow, 'data-slot="phone-row-leading"', '</a>');
    expect(leading).toContain('aria-hidden="true"');
    expect(leading).toContain('href="/players/1?ruleset=0"');
    expect(leading).toContain('tabindex="-1"');
    expect(leading).toContain('width:32px;height:32px');

    // The name's own link holds no second avatar.
    expect(phoneRow.match(/width:24px;height:24px/g)).toBeNull();
  });

  it('keeps the 24px avatar inside the name link in the table', () => {
    const html = render([entry(1, 'mrekk', 'AU', 2)]);
    const tableRow = section(html, 'data-testid="leaderboard-row-1"', '</tr>');
    expect(tableRow).toContain('width:24px;height:24px');
    expect(tableRow).not.toContain('data-slot="phone-row-leading"');
  });

  it('names the country link and hides its flag', () => {
    const html = render([entry(1, 'mrekk', 'AU', 2)]);
    const tableRow = section(html, 'data-testid="leaderboard-row-1"', '</tr>');

    expect(tableRow).toContain('aria-label="#2 in Australia"');
    expect(tableRow).toContain('href="/leaderboard?country=AU"');
    // The link's label names the country, so the flag is decorative.
    expect(tableRow).toMatch(
      /<img[^>]*alt=""[^>]*aria-hidden="true"[^>]*data-slot="country-flag"/
    );
  });

  it('leaves out the country link for a player without a country code', () => {
    const html = render([entry(2, 'nobody', '', 454)]);
    const tableRow = section(html, 'data-testid="leaderboard-row-2"', '</tr>');
    const phoneRow = section(
      html,
      'data-testid="leaderboard-phone-row-2"',
      '</li>'
    );

    for (const row of [tableRow, phoneRow]) {
      expect(row).not.toContain('country=');
      expect(row).not.toContain('data-slot="country-flag"');
    }
  });

  // A button, so the explanation opens on keyboard focus and tap as well
  // as hover.
  it('marks an inactive player with a tooltip button, table and phone', () => {
    const html = render([
      entry(4, 'active', 'PL', 7),
      { ...entry(5, 'idle', 'PL', 9), inactive: true },
    ]);
    const mark =
      /<button[^>]*aria-label="Inactive: no verified match in the last 6 months"/;

    for (const [attribute, closing] of [
      ['data-testid="leaderboard-row-', '</tr>'],
      ['data-testid="leaderboard-phone-row-', '</li>'],
    ]) {
      expect(section(html, `${attribute}5"`, closing)).toMatch(mark);
      expect(section(html, `${attribute}4"`, closing)).not.toMatch(mark);
    }
  });

  it('names a player stored without a username', () => {
    const html = render([entry(3, '', '', 454)]);
    const tableRow = section(html, 'data-testid="leaderboard-row-3"', '</tr>');
    const phoneRow = section(
      html,
      'data-testid="leaderboard-phone-row-3"',
      '</li>'
    );

    for (const row of [tableRow, phoneRow]) {
      expect(row).toContain('Unknown player');
    }
  });
});
