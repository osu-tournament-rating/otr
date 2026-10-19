import { Mods, Ruleset, VerificationStatus } from '@otr/core/osu';
import { ChevronDown, ShieldCheck, StickyNote, User } from 'lucide-react';
import Image from 'next/image';
import type * as React from 'react';

import { GallerySection, Specimen } from '../gallery';
import RulesetIcon from '@/components/icons/RulesetIcon';
import { IconButton } from '@/components/kit/controls/IconButton';
import { FilterButton } from '@/components/kit/lists/FilterButton';
import { Badge } from '@/components/kit/status/Badge';
import { NotificationDot } from '@/components/kit/status/NotificationDot';
import { NotInRatings } from '@/components/kit/status/NotInRatings';
import { ReportStatusBadge } from '@/components/kit/status/ReportStatusBadge';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';
import { VerificationStatusIcon } from '@/components/kit/status/VerificationStatusIcon';
import { VerificationStatusDetails } from '@/components/kit/status/VerificationStatusTooltip';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MOD_FILL_FOREGROUND, getModPaletteColor } from '@/lib/kit/color/mods';
import { ACCENT_SURFACE_CLASSES } from '@/lib/kit/color/tokens';
import { getTierColor } from '@/lib/kit/color/tiers';
import { formatLobbySize, formatRankRange } from '@/lib/kit/format/fields';
import { formatCount, formatCountOf } from '@/lib/kit/format/number';
import { RATED_RULESETS, getRulesetLabel } from '@/lib/kit/format/ruleset';
import { formatBadgeCount } from '@/lib/kit/status/count';
import { REPORT_STATUS_ORDER } from '@/lib/kit/status/report';
import {
  RATINGS_GROUPS,
  VERIFICATION_STATUS_ORDER,
  getVerificationStatusCopy,
  getVerificationStatusLine,
} from '@/lib/kit/status/verification';
import { cn } from '@/lib/utils';
import { getBeatmapModLabel } from '@/lib/utils/mods';

const KIT = '@/components/kit/status';

/** The admin who verified or rejected the demo data. */
const REVIEWER = 'apricot';

const DEMO_MODS = [
  Mods.None,
  Mods.Hidden,
  Mods.HardRock,
  Mods.DoubleTime,
  Mods.Flashlight,
  Mods.Easy,
  Mods.Hidden | Mods.HardRock,
];

/** A tournament row's meta line, written with the format family's helpers. */
function tournamentMeta(
  ruleset: Ruleset,
  lobbySize: number,
  rankRangeLowerBound: number,
  matches: number
) {
  return [
    getRulesetLabel(ruleset),
    formatLobbySize(lobbySize),
    formatRankRange(rankRangeLowerBound),
    formatCountOf(matches, 'match', 'matches'),
  ].join(' · ');
}

const DEMO_TOURNAMENTS = [
  {
    name: 'osu! World Cup 2025',
    meta: tournamentMeta(Ruleset.Osu, 4, 1, 112),
    status: VerificationStatus.Verified,
  },
  {
    name: 'Oceania Taiko Cup 2026',
    meta: tournamentMeta(Ruleset.Taiko, 2, 10000, 96),
    status: VerificationStatus.PreVerified,
  },
  {
    name: 'Mania 4K World Cup 2026',
    meta: tournamentMeta(Ruleset.Mania4k, 4, 1, 118),
    status: VerificationStatus.None,
  },
  {
    name: 'Catch the Beat Spring League',
    meta: tournamentMeta(Ruleset.Catch, 1, 1000, 58),
    status: VerificationStatus.PreRejected,
  },
];

const DEMO_GAMES = [
  { status: VerificationStatus.Verified },
  { status: VerificationStatus.Verified },
  {
    status: VerificationStatus.PreVerified,
    warnings: ['Beatmap only used once'],
  },
  { status: VerificationStatus.Verified },
  {
    status: VerificationStatus.Rejected,
    rejectionReasons: ['Beatmap not pooled'],
    reviewer: REVIEWER,
  },
  { status: VerificationStatus.Verified },
  {
    status: VerificationStatus.PreRejected,
    rejectionReasons: ['No valid scores'],
  },
];

/** A label column for the rows of a specimen. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function StatusSheet() {
  return (
    <div className="flex flex-col gap-4">
      {RATINGS_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {group.label}
          </p>
          <ul className="divide-y rounded-lg border">
            {VERIFICATION_STATUS_ORDER.filter((status) =>
              group.statuses.includes(status)
            ).map((status) => {
              const { name } = getVerificationStatusCopy(status);
              return (
                <li
                  key={status}
                  className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="flex w-44 shrink-0 items-center gap-2">
                    <VerificationStatusIcon status={status} size="lg" />
                    <span className="inline-flex grayscale">
                      <VerificationStatusIcon
                        status={status}
                        size="lg"
                        decorative
                      />
                    </span>
                    <span className="font-medium">{name}</span>
                  </div>
                  {/* Only a decision names its reviewer; the rest read as the name. */}
                  {status === VerificationStatus.Verified ||
                  status === VerificationStatus.Rejected ? (
                    <p className="text-sm text-pretty text-muted-foreground">
                      {getVerificationStatusLine(status, {
                        reviewer: REVIEWER,
                      })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Stands in for the header's Admin dropdown; the real one lives in the header. */
function AdminMenuDemo() {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="-mx-2 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-accent"
        >
          Admin
          <NotificationDot label="Unseen reports" />
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem>Admin</DropdownMenuItem>
        <DropdownMenuItem className="justify-between">
          Reports
          <Badge variant="solid" tone="primary" size="sm">
            {formatBadgeCount(3)}
            <span className="sr-only"> unseen</span>
          </Badge>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function StatusSection() {
  return (
    <GallerySection
      id="status"
      title="Status and badges"
      description="Verification status, badges and notification dots."
    >
      <Specimen
        id="status-sheet"
        name="Status sheet"
        description="The five verification states. The glyph carries the outcome, a dashed outline means an automated check, and colour only reinforces: the greyscale copy must stay readable. Pending, Pre-verified and Pre-rejected are always grouped as “Not in ratings yet”."
        stacked
      >
        <StatusSheet />
      </Specimen>

      <Specimen
        id="status-verification-icon"
        name="VerificationStatusIcon"
        importPath={`${KIT}/VerificationStatusIcon`}
        description="Status without its name, for table cells, game pips and dense rows. Give it a tooltip wherever the name is not written beside it; warnings add a small triangle instead of recolouring the icon. On cover art, the overlay variant sets the glyph on a dark disc so it reads over bright covers."
      >
        <div className="flex flex-col gap-4">
          <Row label="In text (sm)">
            <p className="text-sm">
              {REVIEWER} verified{' '}
              <VerificationStatusIcon
                status={VerificationStatus.Verified}
                size="sm"
                reviewer={REVIEWER}
                tooltip="tap"
              />{' '}
              Corsace Open 2025
            </p>
          </Row>
          <Row label="Rows (md)">
            {/* 8px apart, so each 16px tap target keeps a 24px tap area. */}
            <ul aria-label="Games" className="flex items-center gap-2">
              {DEMO_GAMES.map((game, index) => (
                <li key={index} className="inline-flex">
                  <VerificationStatusIcon
                    status={game.status}
                    warnings={game.warnings}
                    rejectionReasons={game.rejectionReasons}
                    reviewer={game.reviewer}
                    context={`Game ${index + 1}`}
                    showContext
                    tooltip="tap"
                  />
                </li>
              ))}
            </ul>
          </Row>
          <Row label="Headers (lg)">
            <span className="inline-flex items-center gap-2 font-semibold">
              <VerificationStatusIcon
                status={VerificationStatus.PreVerified}
                size="lg"
                warnings={['Low game count']}
                tooltip="tap"
              />
              CO25: (Mafumafu) vs (Rafis)
            </span>
          </Row>
          <Row label="All states">
            {VERIFICATION_STATUS_ORDER.map((status) => (
              <VerificationStatusIcon
                key={status}
                status={status}
                tooltip="tap"
              />
            ))}
          </Row>
          <Row label="Greyscale">
            <span className="flex items-center gap-2 grayscale">
              {VERIFICATION_STATUS_ORDER.map((status) => (
                <VerificationStatusIcon
                  key={status}
                  status={status}
                  tooltip="tap"
                />
              ))}
            </span>
          </Row>
          <Row label="Warnings">
            <VerificationStatusIcon
              status={VerificationStatus.PreVerified}
              warnings={['Low game count']}
              tooltip="tap"
            />
            <VerificationStatusIcon
              status={VerificationStatus.Verified}
              warnings={['Overlapping rosters found']}
              reviewer={REVIEWER}
              tooltip="tap"
            />
          </Row>
          <Row label="On cover art">
            {/* The game card header: cover art under its scrim, then a dark disc per icon. */}
            <div className="relative flex h-16 w-full max-w-72 items-start overflow-hidden rounded-lg p-2">
              <Image
                src="/images/beatmap-background-narrow.png"
                alt=""
                fill
                sizes="288px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/70" />
              <ul
                aria-label="Games"
                className="dark relative flex items-center gap-2"
              >
                {DEMO_GAMES.slice(2, 7).map((game, index) => (
                  <li key={index} className="inline-flex">
                    <VerificationStatusIcon
                      status={game.status}
                      variant="overlay"
                      warnings={game.warnings}
                      rejectionReasons={game.rejectionReasons}
                      reviewer={game.reviewer}
                      context={`Game ${index + 3}`}
                      showContext
                      tooltip="tap"
                    />
                  </li>
                ))}
              </ul>
            </div>
          </Row>
          <Row label="On white">
            {/* The hardest case the disc is built for: a bright, flat cover. */}
            <span className="flex items-center gap-2 rounded-lg bg-white p-2">
              {VERIFICATION_STATUS_ORDER.map((status) => (
                <VerificationStatusIcon
                  key={status}
                  status={status}
                  variant="overlay"
                  tooltip="tap"
                />
              ))}
            </span>
          </Row>
        </div>
      </Specimen>

      <Specimen
        id="status-verification-badge"
        name="VerificationStatusBadge"
        importPath={`${KIT}/VerificationStatusBadge`}
        description="Status with its name, for heroes, headers and dialogs. The hue follows the outcome; an admin's decision is filled and an automated check is a dashed outline. Use the overlay variant only on cover art."
      >
        <div className="flex flex-col gap-4">
          <Row label="States">
            {VERIFICATION_STATUS_ORDER.map((status) => (
              <VerificationStatusBadge key={status} status={status} />
            ))}
          </Row>
          <Row label="Sizes">
            <VerificationStatusBadge
              status={VerificationStatus.PreVerified}
              size="sm"
            />
            <VerificationStatusBadge
              status={VerificationStatus.PreVerified}
              size="md"
            />
            <VerificationStatusBadge
              status={VerificationStatus.PreVerified}
              size="lg"
            />
          </Row>
          <Row label="Tooltip">
            <VerificationStatusBadge
              status={VerificationStatus.Verified}
              reviewer={REVIEWER}
              tooltip="tap"
            />
            <VerificationStatusBadge
              status={VerificationStatus.PreVerified}
              warnings={['Low game count', 'Unexpected name format']}
              tooltip="tap"
            />
            <VerificationStatusBadge
              status={VerificationStatus.Rejected}
              rejectionReasons={['Abnormal win condition']}
              reviewer={REVIEWER}
              tooltip="tap"
            />
          </Row>
          {/* VerificationStatusDetails is the tooltip's body on its own, for
              a chart tooltip or a popover; here on the tooltip's surface. */}
          <Row label="Tooltip body">
            <div
              className={cn(
                'rounded-md px-3 py-1.5 text-xs',
                ACCENT_SURFACE_CLASSES
              )}
            >
              <VerificationStatusDetails
                status={VerificationStatus.Rejected}
                rejectionReasons={['Abnormal win condition']}
                reviewer={REVIEWER}
              />
            </div>
          </Row>
          <Row label="On cover art">
            <div className="relative flex h-24 w-full max-w-72 items-start overflow-hidden rounded-lg p-2">
              <Image
                src="/images/beatmap-background-narrow.png"
                alt=""
                fill
                sizes="288px"
                className="object-cover"
              />
              {/* The match card's scrim over its cover art */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/50 to-black/70" />
              <div className="dark relative">
                <VerificationStatusBadge
                  status={VerificationStatus.Verified}
                  variant="overlay"
                />
              </div>
            </div>
          </Row>
        </div>
      </Specimen>

      <Specimen
        id="status-not-in-ratings"
        name="NotInRatings"
        importPath={`${KIT}/NotInRatings`}
        description="Says data does not count toward ratings yet, for Pending, Pre-verified and Pre-rejected, and renders nothing otherwise. The label goes in list rows; the notice goes once under a tournament's header and links to the Rating FAQ."
      >
        <div className="flex flex-col gap-4">
          <ul className="divide-y overflow-clip rounded-xl border bg-card shadow-sm dark:bg-muted/75 dark:shadow-none">
            {DEMO_TOURNAMENTS.map((tournament) => (
              <li
                key={tournament.name}
                className="flex flex-col gap-0.5 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <VerificationStatusIcon
                    status={tournament.status}
                    tooltip="tap"
                  />
                  <a
                    href="#status-not-in-ratings"
                    className="truncate font-medium hover:underline"
                  >
                    {tournament.name}
                  </a>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 pl-6">
                  <span className="text-sm text-muted-foreground">
                    {tournament.meta}
                  </span>
                  <NotInRatings status={tournament.status} />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm dark:bg-muted/75 dark:shadow-none">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h4 className="text-xl font-bold tracking-tight">
                Oceania Taiko Cup 2026
              </h4>
              <VerificationStatusBadge
                status={VerificationStatus.PreVerified}
                tooltip="tap"
              />
            </div>
            <NotInRatings
              status={VerificationStatus.PreVerified}
              variant="notice"
            />
          </div>
        </div>
      </Specimen>

      <Specimen
        id="status-badge"
        name="Badge"
        importPath={`${KIT}/Badge`}
        description="The one small label. Soft is the default; outline sits quieter on tinted surfaces; solid is for counts. Warning and red never fill solid. Pills everywhere, rounded corners only where a pill would read as a button."
      >
        <div className="flex flex-col gap-4">
          <Row label="Soft">
            <Badge>Neutral</Badge>
            <Badge tone="primary">Primary</Badge>
            <Badge tone="success">Success</Badge>
            <Badge tone="warning">Warning</Badge>
            <Badge tone="destructive">Destructive</Badge>
          </Row>
          <Row label="Outline">
            <Badge variant="outline">Neutral</Badge>
            <Badge variant="outline" tone="primary">
              Primary
            </Badge>
            <Badge variant="outline" tone="success">
              Success
            </Badge>
            <Badge variant="outline" tone="warning">
              Warning
            </Badge>
            <Badge variant="outline" tone="destructive">
              Destructive
            </Badge>
          </Row>
          <Row label="Solid">
            <Badge variant="solid">Neutral</Badge>
            <Badge variant="solid" tone="primary">
              Primary
            </Badge>
            <Badge variant="solid" tone="success">
              Success
            </Badge>
          </Row>
          <Row label="Sizes">
            <Badge size="sm">Small</Badge>
            <Badge size="md">Medium</Badge>
            <Badge size="lg">Large</Badge>
          </Row>
          <Row label="Shapes">
            <Badge shape="pill">Pill</Badge>
            <Badge shape="rounded">Rounded</Badge>
          </Row>
        </div>
      </Specimen>

      <Specimen
        id="status-badge-uses"
        name="Badge uses"
        importPath={`${KIT}/Badge`}
        description='Mods and tiers keep their own palettes, through customColor for a solid fill or swatch for the small chip. Rulesets, roles and tags stay neutral; a notice such as "Includes unverified" is a CalloutChip, not a badge. Counts always have thousands separators.'
      >
        <div className="flex flex-col gap-4">
          <Row label="Mods">
            {DEMO_MODS.map((mods) => (
              <Badge
                key={mods}
                customColor={{
                  background: getModPaletteColor(mods),
                  foreground: MOD_FILL_FOREGROUND,
                }}
              >
                {getBeatmapModLabel(mods)}
              </Badge>
            ))}
          </Row>
          <Row label="Mod share">
            <Badge variant="outline" swatch={getModPaletteColor(Mods.HardRock)}>
              HR {formatCount(1204)}
            </Badge>
            <Badge variant="outline" swatch={getModPaletteColor(Mods.Hidden)}>
              HD {formatCount(871)}
            </Badge>
          </Row>
          <Row label="Rulesets">
            {RATED_RULESETS.map((ruleset) => (
              <Badge key={ruleset}>
                <RulesetIcon
                  ruleset={ruleset}
                  className="fill-current"
                  aria-hidden="true"
                />
                {getRulesetLabel(ruleset)}
              </Badge>
            ))}
          </Row>
          <Row label="Roles">
            <Badge>
              <ShieldCheck aria-hidden="true" />
              Admin
            </Badge>
          </Row>
          <Row label="Tags">
            <Badge variant="outline">lazer</Badge>
          </Row>
          <Row label="Tiers">
            <Badge swatch={getTierColor('Platinum')}>Platinum II</Badge>
            <Badge swatch={getTierColor('Gold')}>Gold III</Badge>
          </Row>
          <Row label="Counts">
            <FilterButton count={2} />
            <Badge variant="solid" tone="primary" size="sm">
              {formatBadgeCount(140)}
            </Badge>
            <Badge size="sm">{formatCountOf(1204, 'match', 'matches')}</Badge>
          </Row>
        </div>
      </Specimen>

      <Specimen
        id="status-report-badge"
        name="ReportStatusBadge"
        importPath={`${KIT}/ReportStatusBadge`}
        description="A data report's state on My reports and the admin queue: a clock while it waits, then a green check or a red cross for the admin's outcome."
      >
        <Row label="States">
          {REPORT_STATUS_ORDER.map((status) => (
            <ReportStatusBadge key={status} status={status} />
          ))}
        </Row>
      </Specimen>

      <Specimen
        id="status-notification-dot"
        name="NotificationDot"
        importPath={`${KIT}/NotificationDot`}
        description="The one colour for “something new”: unseen reports on the Admin menu item, unread report updates. Inline after a label, or on the corner of an icon or avatar. Always give it a label for screen readers."
      >
        <div className="flex flex-col gap-4">
          <Row label="Admin menu">
            <AdminMenuDemo />
          </Row>
          <Row label="Inline">
            <span className="inline-flex items-center gap-2 text-sm">
              CO25: (Mafumafu) vs (Rafis)
              <NotificationDot label="Unread admin update" />
            </span>
          </Row>
          <Row label="Corner">
            <span className="relative inline-flex">
              <Avatar className="size-9">
                <AvatarFallback>
                  <User className="size-4" aria-hidden="true" />
                </AvatarFallback>
              </Avatar>
              <NotificationDot
                placement="corner"
                label="Unread report updates"
              />
            </span>
            <IconButton
              variant="outline"
              icon={StickyNote}
              label="Admin notes (has notes)"
              tooltip="Admin notes"
              className="relative"
            >
              <NotificationDot placement="corner" label="Has notes" />
            </IconButton>
          </Row>
        </div>
      </Specimen>
    </GallerySection>
  );
}
