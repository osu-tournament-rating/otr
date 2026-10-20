import type * as React from 'react';

import { Timestamp } from '@/components/kit/format/Timestamp';
import { ApprovalStatusBadge } from '@/components/kit/status/ApprovalStatusBadge';
import { Badge } from '@/components/kit/status/Badge';
import { MissingValue } from '@/components/kit/tables/MissingValue';
import { ReportDetailRow } from '@/components/reports/ReportDetails';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatCount, formatId, formatRating } from '@/lib/kit/format/number';
import { getRulesetLabel } from '@/lib/kit/format/ruleset';
import { formatUnknownShare } from '@/components/filtering/unknownShare';
import type { AdminFilterRequest } from '@/lib/orpc/schema/filtering';
import type { AdminTournamentSubmission } from '@/lib/orpc/schema/tournamentSubmission';

const LONG_TEXT = 'wrap-anywhere whitespace-pre-wrap';

const osuMatchUrl = (osuId: number, isLazer: boolean) =>
  isLazer
    ? `https://osu.ppy.sh/multiplayer/rooms/${osuId}`
    : `https://osu.ppy.sh/community/matches/${osuId}`;

const osuBeatmapUrl = (osuId: number) => `https://osu.ppy.sh/b/${osuId}`;

/** A list of osu! IDs, each linking to osu!, in a box that scrolls past a few lines. */
function OsuIdList({
  label,
  ids,
  href,
}: {
  label: string;
  ids: readonly number[];
  href?: (id: number) => string;
}) {
  if (ids.length === 0) {
    return <MissingValue label="None" />;
  }

  return (
    <ul
      aria-label={label}
      className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-sm tabular-nums"
    >
      {ids.map((id) => (
        <li key={id}>
          {href ? (
            <a
              href={href(id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link hover:underline"
            >
              {formatId(id)}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            formatId(id)
          )}
        </li>
      ))}
    </ul>
  );
}

function DetailList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
      {children}
    </dl>
  );
}

/**
 * A held tournament submission in the approval queue: who sent it and when,
 * then the tournament as submitted, with every match and beatmap ID.
 */
export function SubmissionDetails({
  submission,
  submitter,
}: {
  submission: AdminTournamentSubmission;
  submitter: React.ReactNode;
}) {
  return (
    <DetailList>
      <ReportDetailRow label="Status">
        <ApprovalStatusBadge status={submission.status} size="sm" />
      </ReportDetailRow>
      <ReportDetailRow label="Submitter">{submitter}</ReportDetailRow>
      <ReportDetailRow label="Submitted">
        <Timestamp date={submission.created} />
      </ReportDetailRow>
      <ReportDetailRow label="Name">
        <span className="font-medium wrap-anywhere">{submission.name}</span>
      </ReportDetailRow>
      <ReportDetailRow label="Abbreviation">
        {submission.abbreviation}
      </ReportDetailRow>
      <ReportDetailRow label="Forum post URL">
        <a
          href={submission.forumUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="wrap-anywhere text-link hover:underline"
        >
          {submission.forumUrl}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </ReportDetailRow>
      <ReportDetailRow label="Ruleset">
        <span className="inline-flex items-center gap-2">
          {getRulesetLabel(submission.ruleset)}
          {submission.isLazer ? (
            <Badge variant="outline" size="sm">
              lazer
            </Badge>
          ) : null}
        </span>
      </ReportDetailRow>
      <ReportDetailRow label="Lobby size">
        {formatLobbySize(submission.lobbySize)}
      </ReportDetailRow>
      <ReportDetailRow label="Rank restriction">
        {formatRankRange(submission.rankRangeLowerBound)}
      </ReportDetailRow>
      <ReportDetailRow
        label={`Matches (${formatCount(submission.matchIds.length)})`}
      >
        <OsuIdList
          label="Match IDs"
          ids={submission.matchIds}
          href={(id) => osuMatchUrl(id, submission.isLazer)}
        />
      </ReportDetailRow>
      <ReportDetailRow
        label={`Beatmaps (${formatCount(submission.beatmapIds.length)})`}
      >
        <OsuIdList
          label="Beatmap IDs"
          ids={submission.beatmapIds}
          href={osuBeatmapUrl}
        />
      </ReportDetailRow>
    </DetailList>
  );
}

/**
 * A held filter request in the approval queue: who sent it and why, the
 * criteria, and every osu! ID it would look up.
 */
export function FilterRequestDetails({
  request,
  requester,
}: {
  request: AdminFilterRequest;
  requester: React.ReactNode;
}) {
  const rating = (value: number | null) =>
    value == null ? <MissingValue label="Not set" /> : formatRating(value);

  return (
    <DetailList>
      <ReportDetailRow label="Status">
        <ApprovalStatusBadge status={request.status} size="sm" />
      </ReportDetailRow>
      <ReportDetailRow label="Requester">{requester}</ReportDetailRow>
      <ReportDetailRow label="Submitted">
        <Timestamp date={request.created} />
      </ReportDetailRow>
      <ReportDetailRow label="Justification">
        <span className={LONG_TEXT}>{request.justification}</span>
      </ReportDetailRow>
      <ReportDetailRow label="Not in o!TR">
        {formatUnknownShare(request.unknownPlayerCount, request.playerCount)}
      </ReportDetailRow>
      <ReportDetailRow label="Ruleset">
        {getRulesetLabel(request.ruleset)}
      </ReportDetailRow>
      <ReportDetailRow label="Minimum rating">
        {rating(request.minRating)}
      </ReportDetailRow>
      <ReportDetailRow label="Maximum rating">
        {rating(request.maxRating)}
      </ReportDetailRow>
      <ReportDetailRow
        label={`osu! player IDs (${formatCount(request.osuPlayerIds.length)})`}
      >
        <OsuIdList
          label="osu! player IDs"
          ids={request.osuPlayerIds}
          href={(id) => `https://osu.ppy.sh/users/${id}`}
        />
      </ReportDetailRow>
    </DetailList>
  );
}
