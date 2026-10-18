import { Ruleset, VerificationStatus } from '@otr/core/osu';
import { describe, expect, it, mock } from 'bun:test';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PlayerBeatmapStats } from '@/lib/orpc/schema/playerBeatmaps';
import type { PlayerTournamentHistoryItem } from '@/lib/orpc/schema/tournament';

// Bun loads SVG imports as file paths, which React cannot render.
mock.module('@/components/icons/RulesetIcon', () => ({
  default: ({ ruleset }: { ruleset: number | 'all' }) => (
    <svg data-ruleset={ruleset} />
  ),
}));

const { TooltipProvider } = await import('@/components/ui/tooltip');
const { default: PlayerBeatmapsList } =
  await import('@/components/player/PlayerBeatmapsList');
const { default: PlayerTournamentsList } =
  await import('@/components/player/PlayerTournamentsList');

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);

function tournament(
  id: number,
  overrides: Partial<PlayerTournamentHistoryItem> = {}
): PlayerTournamentHistoryItem {
  return {
    id,
    created: '2024-07-01T00:00:00.000Z',
    name: `Tournament ${id}`,
    abbreviation: `T${id}`,
    forumUrl: 'https://osu.ppy.sh/community/forums/topics/1',
    rankRangeLowerBound: 1000,
    ruleset: Ruleset.Osu,
    lobbySize: 4,
    startTime: '2024-07-20T00:00:00.000Z',
    endTime: '2024-08-03T00:00:00.000Z',
    verificationStatus: VerificationStatus.Verified,
    rejectionReason: 0,
    isLazer: false,
    submittedByUsername: null,
    verifiedByUsername: null,
    matchesWon: 2,
    matchesLost: 1,
    ...overrides,
  };
}

/** A tournament the player has no stats for, so no record. */
const withoutStats = (id: number, verificationStatus: VerificationStatus) =>
  tournament(id, { verificationStatus, matchesWon: null, matchesLost: null });

function beatmap(id: number): PlayerBeatmapStats {
  return {
    id,
    osuId: 1000 + id,
    rankedStatus: 1,
    diffName: 'Extra',
    totalLength: 124,
    drainLength: 120,
    bpm: 160,
    countCircle: 0,
    countSlider: 0,
    countSpinner: 0,
    cs: 4,
    hp: 5,
    od: 8,
    ar: 9,
    sr: 5.44,
    maxCombo: 1000,
    beatmapsetId: 2000 + id,
    ruleset: Ruleset.Osu,
    artist: 'Brandy',
    title: `Beatmap ${id}`,
    tournamentCount: 3,
    gameCount: 12,
  };
}

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe('PlayerTournamentsList', () => {
  it('shows five tournaments and a Show more footer with the counts in its readout', () => {
    const html = render(
      <PlayerTournamentsList
        tournaments={range(27).map((id) => tournament(id))}
        adjustments={[]}
      />
    );

    expect(html.match(/data-testid="player-tournament-row"/g)).toHaveLength(5);
    expect(html).toContain('data-slot="load-more"');
    expect(html).toContain('Showing 5 of 27');
    expect(html).toContain('>Show more<');
    expect(html).not.toContain('more)');
  });

  it('has no footer when every tournament fits in the first five', () => {
    const html = render(
      <PlayerTournamentsList
        tournaments={range(5).map((id) => tournament(id))}
        adjustments={[]}
      />
    );

    expect(html).not.toContain('data-slot="load-more"');
  });

  it('counts rows without a record in the readout', () => {
    const html = render(
      <PlayerTournamentsList
        tournaments={[
          ...range(4).map((id) => tournament(id)),
          ...range(3).map((id) =>
            withoutStats(10 + id, VerificationStatus.Rejected)
          ),
        ]}
        adjustments={[]}
      />
    );

    expect(html).toContain('Showing 5 of 7');
    expect(html).toContain('7 tournaments');
  });
});

describe('PlayerTournamentCard', () => {
  const renderRow = (row: PlayerTournamentHistoryItem) =>
    render(<PlayerTournamentsList tournaments={[row]} adjustments={[]} />);

  it('shows a rejected row without a record as its name and status only', () => {
    const html = renderRow(withoutStats(1, VerificationStatus.Rejected));

    expect(html).toContain('href="/tournaments/1"');
    expect(html).toContain('data-slot="verification-status-icon"');
    expect(html).toContain('aria-label="Rejected"');
    expect(html).not.toContain('>Record<');
    expect(html).not.toContain('>Rating change<');
    expect(html).not.toContain('Matches in Tournament 1');
    expect(html).not.toContain('data-slot="not-in-ratings"');
  });

  it('says a pre-verified row without a record is not in ratings yet', () => {
    const html = renderRow(withoutStats(1, VerificationStatus.PreVerified));

    expect(html).toContain('data-slot="not-in-ratings"');
    expect(html).toContain('Not in ratings yet');
    expect(html).not.toContain('>Record<');
  });

  it('shows a verified row awaiting stats with neither a record nor the label', () => {
    const html = renderRow(withoutStats(1, VerificationStatus.Verified));

    expect(html).toContain('aria-label="Verified"');
    expect(html).not.toContain('>Record<');
    expect(html).not.toContain('Matches in Tournament 1');
    expect(html).not.toContain('data-slot="not-in-ratings"');
  });

  it('keeps the record and Matches button on a verified row with stats', () => {
    const html = renderRow(tournament(1));

    expect(html).toContain('>Record<');
    expect(html).toContain('2 wins and 1 loss');
    expect(html).toContain('>Rating change<');
    expect(html).toContain('aria-label="Matches in Tournament 1"');
    expect(html).not.toContain('data-slot="not-in-ratings"');
  });
});

describe('PlayerBeatmapsList', () => {
  it('shows the server batch and a Show more footer when more exist', () => {
    const html = render(
      <PlayerBeatmapsList
        playerId={1}
        ruleset={Ruleset.Osu}
        initialBeatmaps={range(3).map(beatmap)}
        totalCount={231}
      />
    );

    expect(html).toContain('Showing 3 of 231');
    expect(html).toContain('>Show more<');
    expect(html).not.toContain('more)');
  });

  it('sets the star rating in tabular figures through the kit badge', () => {
    const html = render(
      <PlayerBeatmapsList
        playerId={1}
        ruleset={Ruleset.Osu}
        initialBeatmaps={[beatmap(1)]}
        totalCount={1}
      />
    );
    const badge = html.match(
      /<[^>]*data-testid="player-beatmap-star-rating"[^>]*>/
    )?.[0];

    expect(badge).toBeDefined();
    expect(badge).toMatch(/class="[^"]*\btabular-nums\b/);
  });

  it('has no footer when the server batch holds every beatmap', () => {
    const html = render(
      <PlayerBeatmapsList
        playerId={1}
        ruleset={Ruleset.Osu}
        initialBeatmaps={range(2).map(beatmap)}
        totalCount={2}
      />
    );

    expect(html).not.toContain('data-slot="load-more"');
  });

  it('shows the empty state and no footer without beatmaps', () => {
    const html = render(
      <PlayerBeatmapsList
        playerId={1}
        ruleset={Ruleset.Osu}
        initialBeatmaps={[]}
        totalCount={0}
      />
    );

    expect(html).toContain('data-testid="player-beatmaps-empty"');
    expect(html).not.toContain('data-slot="load-more"');
  });
});
