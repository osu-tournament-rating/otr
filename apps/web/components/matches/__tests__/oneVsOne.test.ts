import { describe, expect, it } from 'bun:test';
import { TeamType } from '@otr/core/osu';

import { getGameTeamTypeLabel } from '@/components/matches/oneVsOne';

describe('getGameTeamTypeLabel', () => {
  it('names no team type for a Team Vs game in a 1v1, which o!TR may have set', () => {
    expect(getGameTeamTypeLabel(TeamType.TeamVs, true)).toBeNull();
  });

  it.each([
    ['a head-to-head game in a 1v1', TeamType.HeadToHead, true],
    ['a tag team game in a 1v1', TeamType.TagTeamVs, true],
    ['a Team Vs game in a team match', TeamType.TeamVs, false],
  ])('names the team type of %s', (_, teamType, oneVsOne) => {
    expect(getGameTeamTypeLabel(teamType, oneVsOne)).not.toBeNull();
  });
});
