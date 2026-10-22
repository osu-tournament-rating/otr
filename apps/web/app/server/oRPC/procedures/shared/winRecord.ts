import { VerificationStatus } from '@otr/core/osu';

import type { MatchRoster } from '@/lib/orpc/schema/match';

type WinRecordRoster = Pick<MatchRoster, 'roster' | 'team' | 'score'>;

export function deriveWinRecord(matchId: number, rosters: WinRecordRoster[]) {
  if (rosters.length < 2) {
    return null;
  }

  const sorted = [...rosters].sort((a, b) => b.score - a.score);
  const topScore = sorted[0]?.score ?? 0;
  const tied = sorted.filter((roster) => roster.score === topScore);

  if (tied.length > 1) {
    return {
      matchId,
      isTied: true,
      loserRoster: null,
      winnerRoster: null,
      loserPoints: topScore,
      winnerPoints: topScore,
      loserTeam: null,
      winnerTeam: null,
    } as const;
  }

  const winner = sorted[0];
  const loser = sorted[1];

  return {
    matchId,
    isTied: false,
    loserRoster: loser?.roster ?? null,
    winnerRoster: winner?.roster ?? null,
    loserPoints: loser?.score ?? 0,
    winnerPoints: winner?.score ?? 0,
    loserTeam: loser?.team ?? null,
    winnerTeam: winner?.team ?? null,
  } as const;
}

// Rosters outlive the verified state they were computed for.
export function deriveVerifiedWinRecord(
  matchId: number,
  verificationStatus: number,
  rosters: WinRecordRoster[]
) {
  if (verificationStatus !== VerificationStatus.Verified) {
    return null;
  }

  return deriveWinRecord(matchId, rosters);
}
