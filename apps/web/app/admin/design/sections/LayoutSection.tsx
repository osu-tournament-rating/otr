'use client';

import { Ruleset, VerificationStatus } from '@otr/core/osu';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  ChartCandlestick,
  ChartLine,
  ChevronRight,
  Clock3,
  ExternalLink,
  Gamepad2,
  Gauge,
  Globe,
  History,
  Medal,
  Music2,
  PencilLine,
  Percent,
  Play,
  RotateCcw,
  Swords,
  Target,
  Trash2,
  Trophy,
  Upload,
  UserRound,
  Users,
  WavesLadder,
} from 'lucide-react';
import * as React from 'react';

import { GallerySection, Specimen } from '../gallery';
import BeatmapCover from '@/components/beatmaps/BeatmapCover';
import StarRatingPill from '@/components/beatmaps/StarRatingPill';
import TierIcon from '@/components/icons/TierIcon';
import type { MenuAction } from '@/components/kit/controls/ActionMenu';
import { AdminMenu } from '@/components/kit/controls/AdminMenu';
import { Button } from '@/components/kit/controls/Button';
import { IconButton } from '@/components/kit/controls/IconButton';
import { CountryName } from '@/components/kit/country/CountryFlag';
import { DetailHero, HeroMetaItem } from '@/components/kit/layout/DetailHero';
import { HeroTabs } from '@/components/kit/layout/HeroTabs';
import {
  HeroTabsContent,
  HeroTabsList,
  HeroTabsRoot,
  HeroTabsTrigger,
} from '@/components/kit/layout/HeroTabsList';
import { InfoButton } from '@/components/kit/layout/InfoButton';
import { PageFrame } from '@/components/kit/layout/PageFrame';
import { PageHeader } from '@/components/kit/layout/PageHeader';
import { PageSection } from '@/components/kit/layout/PageSection';
import { Panel, PanelBody } from '@/components/kit/layout/Panel';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { Tile } from '@/components/kit/layout/Tile';
import { Eyebrow, typeScale } from '@/components/kit/layout/Typography';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { RulesetSwitch } from '@/components/kit/lists/RulesetSwitch';
import { SearchField } from '@/components/kit/lists/SearchField';
import { VerificationStatusBadge } from '@/components/kit/status/VerificationStatusBadge';
import { EntityLink } from '@/components/kit/tables/EntityLink';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { formatCountOf } from '@/lib/kit/format/number';
import { cn } from '@/lib/utils';

const KIT = '@/components/kit/layout';

const PLAYERS = [
  { name: 'distantmemory', country: 'United States', rating: '2,215' },
  { name: 'Raikouhou', country: 'Japan', rating: '2,108' },
  { name: 'Yasui', country: 'Japan', rating: '1,996' },
];

// The demo heroes' admin menus; the controls section shows the full menu.
const noop = () => {};

const BEATMAP_ADMIN_ACTIONS: MenuAction[] = [
  { label: 'Edit beatmap data', icon: PencilLine, onSelect: noop },
];

const TOURNAMENT_ADMIN_ACTIONS: MenuAction[] = [
  { label: 'Edit tournament', icon: PencilLine, onSelect: noop },
  { label: 'Reset automated checks', icon: RotateCcw, onSelect: noop },
  {
    label: 'Delete tournament',
    icon: Trash2,
    destructive: true,
    onSelect: noop,
  },
];

/** The beatmap attributes, by the names the beatmap page gives them. */
const BEATMAP_ATTRIBUTES = [
  { short: 'CS', full: 'Circle size', value: 4 },
  { short: 'AR', full: 'Approach rate', value: 8 },
  { short: 'OD', full: 'Overall difficulty', value: 6.5 },
  { short: 'HP', full: 'HP drain', value: 6 },
];

const TOURNAMENTS = [
  {
    name: 'Break The Meta Cup',
    details: 'osu! · 1v1 · Open rank',
    dates: 'Dec 4 – 18, 2021',
  },
  {
    name: 'Merami Household Winter Cup 2021',
    details: 'osu! · 2v2 · 10,000+',
    dates: 'Jan 8 – 30, 2022',
  },
];

/** A list's panel: its toolbar first, then rows that open as a whole. */
function TournamentListDemo() {
  const [query, setQuery] = React.useState('');
  const shown = TOURNAMENTS.filter((tournament) =>
    tournament.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <Panel>
      <ListToolbar
        label="Search and filter tournaments"
        search={
          <SearchField
            label="Search tournaments by name or abbreviation"
            placeholder="Name or abbreviation"
            value={query}
            onSearch={setQuery}
          />
        }
        count={formatCountOf(shown.length, 'tournament')}
      />
      <RowList>
        {shown.map((tournament) => (
          <RowListItem
            key={tournament.name}
            href="#layout-row-list"
            linkLabel={`View ${tournament.name}`}
            title={tournament.name}
            description={tournament.details}
            trailing={
              <span className={typeScale.meta}>{tournament.dates}</span>
            }
          />
        ))}
      </RowList>
    </Panel>
  );
}

/** The profile's hero: avatar, name, country link and ruleset switch. */
function PlayerHeroDemo() {
  const [ruleset, setRuleset] = React.useState<Ruleset>(Ruleset.Osu);

  return (
    <DetailHero
      leading={
        <Avatar className="size-16">
          <AvatarFallback className="text-lg font-semibold">D</AvatarFallback>
        </Avatar>
      }
      title="distantmemory"
      meta={
        <a
          href="#layout-detail-hero-player"
          aria-label="United States leaderboard"
          className="inline-flex min-w-0 rounded-sm transition-colors outline-none hover:text-link focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <CountryName code="US" name="United States" />
        </a>
      }
      actions={
        <IconButton
          variant="outline"
          icon={ExternalLink}
          label="View on osu!"
        />
      }
    >
      <div className="px-4 py-3 sm:px-6">
        <RulesetSwitch value={ruleset} onValueChange={setRuleset} />
      </div>
    </DetailHero>
  );
}

/**
 * A group of panels that follow one control, as the stats page's panels for
 * one ruleset do.
 */
function PageSectionDemo() {
  const [ruleset, setRuleset] = React.useState<Ruleset>(Ruleset.Osu);

  return (
    <PageSection
      icon={Gamepad2}
      title="By ruleset"
      actions={<RulesetSwitch value={ruleset} onValueChange={setRuleset} />}
    >
      <Panel>
        <SectionHeader
          icon={Globe}
          title="Players by country"
          level={3}
          meta="Top 10 of 149 countries"
        />
        <PanelBody className={typeScale.bodyMuted}>Chart</PanelBody>
      </Panel>
    </PageSection>
  );
}

/** HAELEQUIN's cover, as the beatmap hero shows it. */
function HeroArt() {
  return (
    <BeatmapCover
      beatmapsetOsuId={291495}
      alt=""
      sizes="(max-width: 1050px) 100vw, 1050px"
      className="absolute inset-0"
      imageClassName="saturate-75"
    />
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <Panel>
      <PanelBody className={typeScale.bodyMuted}>{label}</PanelBody>
    </Panel>
  );
}

function PlayerAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-8', className)}>
      <AvatarFallback className="text-xs font-medium">
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

export default function LayoutSection() {
  return (
    <GallerySection
      id="layout"
      title="Layout and surfaces"
      description="Page frame, page header, detail hero, tabs, panels, section headers, tiles, rows and the type scale."
    >
      <Specimen
        id="layout-page-frame"
        name="PageFrame"
        importPath={`${KIT}/PageFrame`}
        description="The root of every page, loading screen and error screen. Panels sit 16px apart at every width; the root layout supplies the 16px phone margin and the 40px desktop top offset (dashed here)."
      >
        <div className="rounded-md border border-dashed border-muted-foreground/40 px-4 pt-6 pb-4 sm:px-5 sm:pt-10">
          <PageFrame>
            <Placeholder label="PageHeader or DetailHero" />
            <Placeholder label="Panel" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Placeholder label="Panel" />
              <Placeholder label="Panel" />
            </div>
          </PageFrame>
        </div>
      </Specimen>

      <Specimen
        id="layout-page-header"
        name="PageHeader"
        importPath={`${KIT}/PageHeader`}
        description="Opens every list and tool page: muted icon, the page's h1, one line of description, actions on the right. Actions stack full width on phones."
      >
        <PageHeader
          icon={Trophy}
          title="Tournaments"
          description="Browse tournament submissions and their review status. Only verified data is included in ratings."
          actions={<Button icon={Upload}>Submit</Button>}
        />
      </Specimen>

      <Specimen
        id="layout-page-header-back"
        name="PageHeader with a back link"
        importPath={`${KIT}/PageHeader`}
        description="Pages that belong to one entity, such as its audit history, link back to it instead of showing breadcrumbs."
      >
        <PageHeader
          icon={History}
          title="Break The Meta Cup"
          back={{ href: '#layout-page-header-back', label: 'View tournament' }}
        />
      </Specimen>

      <Specimen
        id="layout-detail-hero-art"
        name="DetailHero with art"
        importPath={`${KIT}/DetailHero`}
        description="The top of a detail page whose entity has cover art. The name is the h1; metadata sits in one row under it; the admin cluster is at the top right and public actions at the bottom right."
        stacked
      >
        <DetailHero
          art={<HeroArt />}
          title="HAELEQUIN"
          titleSuffix="[alacat's Light Insane]"
          meta={
            <>
              <HeroMetaItem icon={Music2}>orangentle</HeroMetaItem>
              <HeroMetaItem icon={UserRound}>
                Mapped by Gamu, alacat
              </HeroMetaItem>
            </>
          }
          adminActions={<AdminMenu onArt actions={BEATMAP_ADMIN_ACTIONS} />}
          actions={
            <Button variant="overlay" size="sm" icon={Play}>
              Preview
            </Button>
          }
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 text-sm font-semibold">
            <StarRatingPill
              starRating={4.28}
              size="md"
              valueClassName="font-bold"
            />
            <HeroMetaItem icon={Activity}>167 BPM</HeroMetaItem>
            <HeroMetaItem icon={Clock3}>2:16</HeroMetaItem>
          </div>
        </DetailHero>
      </Specimen>

      <Specimen
        id="layout-detail-hero-art-status"
        name="DetailHero with art and a status"
        importPath={`${KIT}/DetailHero`}
        description="A status on art: VerificationStatusBadge with the `overlay` variant, AdminMenu with `onArt`, and the public actions (audit history and the forum link) as IconButtons with the `overlay` variant, all white on the dark matte in both themes."
        stacked
      >
        <DetailHero
          art={<HeroArt />}
          title="Break The Meta Cup"
          titleSuffix="BTMC"
          status={
            <VerificationStatusBadge
              status={VerificationStatus.Verified}
              variant="overlay"
              reviewer="apricot"
              tooltip="tap"
            />
          }
          meta={
            <>
              <HeroMetaItem icon={Users}>1v1</HeroMetaItem>
              <HeroMetaItem icon={CalendarDays}>Dec 4 – 18, 2021</HeroMetaItem>
            </>
          }
          adminActions={
            <AdminMenu
              onArt
              notification="Has admin notes"
              actions={TOURNAMENT_ADMIN_ACTIONS}
            />
          }
          actions={
            <>
              <IconButton
                asChild
                variant="overlay"
                icon={History}
                label="View audit history"
              >
                <a href="#layout-detail-hero-art-status" />
              </IconButton>
              <IconButton
                variant="overlay"
                icon={ExternalLink}
                label="View on osu!"
              />
            </>
          }
        />
      </Specimen>

      <Specimen
        id="layout-detail-hero-art-long"
        name="DetailHero with art and a long title"
        importPath={`${KIT}/DetailHero`}
        description="A long name never runs under the Admin pill: the pill's corner row stays clear, and the strip grows past 192px (224px from sm) instead of clipping the name. An InfoButton on art takes `onArt`."
        stacked
      >
        <DetailHero
          art={<HeroArt />}
          title="Merami Household Winter Cup 2021: Double Elimination Bracket Stage"
          titleSuffix="MHWC21"
          status={
            <VerificationStatusBadge
              status={VerificationStatus.PreVerified}
              variant="overlay"
              tooltip="tap"
            />
          }
          meta={
            <>
              <HeroMetaItem icon={Users}>2v2</HeroMetaItem>
              <span className="inline-flex items-center gap-1">
                Manually configured
                <InfoButton onArt label="About manually configured">
                  No longer available in the osu! API
                </InfoButton>
              </span>
              <HeroMetaItem icon={CalendarDays}>Jan 8 – 30, 2022</HeroMetaItem>
            </>
          }
          adminActions={<AdminMenu onArt actions={TOURNAMENT_ADMIN_ACTIONS} />}
          actions={
            <IconButton
              asChild
              variant="overlay"
              icon={History}
              label="View audit history"
            >
              <a href="#layout-detail-hero-art-long" />
            </IconButton>
          }
        />
      </Specimen>

      <Specimen
        id="layout-detail-hero-tabs"
        name="DetailHero with HeroTabs"
        importPath={`${KIT}/HeroTabs`}
        description="Without art the hero is a plain panel. HeroTabs attach along its bottom edge and switch between views of the one entity; each tab is a link, so the view is part of the address."
        stacked
      >
        <DetailHero
          title="Break The Meta Cup"
          titleSuffix="BTMC"
          status={
            <VerificationStatusBadge
              status={VerificationStatus.Verified}
              reviewer="apricot"
              tooltip="tap"
            />
          }
          meta={
            <>
              <HeroMetaItem icon={Gamepad2}>osu!</HeroMetaItem>
              <HeroMetaItem icon={Users}>1v1</HeroMetaItem>
              <HeroMetaItem icon={Target}>Open rank</HeroMetaItem>
              <HeroMetaItem icon={CalendarDays}>Dec 4 – 18, 2021</HeroMetaItem>
            </>
          }
          adminActions={<AdminMenu actions={TOURNAMENT_ADMIN_ACTIONS} />}
          actions={
            <>
              <IconButton
                asChild
                variant="outline"
                icon={History}
                label="View audit history"
              >
                <a href="#layout-detail-hero-tabs" />
              </IconButton>
              <IconButton
                variant="outline"
                icon={ExternalLink}
                label="View on osu!"
              />
            </>
          }
          tabs={
            <HeroTabs
              aria-label="Tournament views"
              value="matches"
              // As on the tournament page: four tabs with counts fit a
              // 360px phone once the counts stay in the names below sm.
              countsFrom="sm"
              items={[
                {
                  value: 'matches',
                  label: 'Matches',
                  count: '124',
                  href: '#layout-detail-hero-tabs',
                },
                {
                  value: 'beatmaps',
                  label: 'Beatmaps',
                  count: '62',
                  href: '#layout-detail-hero-tabs',
                },
                {
                  value: 'ratings',
                  label: 'Ratings',
                  href: '#layout-detail-hero-tabs',
                },
                {
                  value: 'stats',
                  label: 'Stats',
                  href: '#layout-detail-hero-tabs',
                },
              ]}
            />
          }
        />
      </Specimen>

      <Specimen
        id="layout-detail-hero-player"
        name="DetailHero with a leading avatar"
        importPath={`${KIT}/DetailHero`}
        description="The profile puts the 64px avatar in `leading`, before the name, and the country as a CountryName that opens the country's leaderboard. Its ruleset switch is a row under the title block (`children`); the rating tiles follow in their own panel, not inside the hero."
        stacked
      >
        <PlayerHeroDemo />
      </Specimen>

      <Specimen
        id="layout-hero-tabs-panel"
        name="HeroTabs at the top of a panel"
        importPath={`${KIT}/HeroTabs`}
        description="A page with a PageHeader, such as an entity's audit history, puts its view tabs at the top of its one panel, over a divider (a `border-b` className). `compactLabel` and `countsFrom` sm let four tabs with counts fit a 360px phone; the counts stay in each tab's accessible name."
        stacked
      >
        <div className="flex flex-col gap-4">
          <PageHeader
            icon={History}
            title="Corsace Open 2025"
            back={{ href: '#layout-hero-tabs-panel', label: 'View tournament' }}
          />
          <Panel>
            <HeroTabs
              aria-label="Audit history views"
              value="self"
              countsFrom="sm"
              className="border-b"
              items={[
                {
                  value: 'self',
                  label: 'This tournament',
                  compactLabel: 'Tournament',
                  href: '#layout-hero-tabs-panel',
                },
                {
                  value: 'matches',
                  label: 'Matches',
                  count: '412',
                  href: '#layout-hero-tabs-panel',
                },
                {
                  value: 'games',
                  label: 'Games',
                  count: '3,104',
                  href: '#layout-hero-tabs-panel',
                },
                {
                  value: 'scores',
                  label: 'Scores',
                  count: '1,000+',
                  href: '#layout-hero-tabs-panel',
                },
              ]}
            />
            <PanelBody className={typeScale.bodyMuted}>
              Toolbar and events
            </PanelBody>
          </Panel>
        </div>
      </Specimen>

      <Specimen
        id="layout-hero-tabs-in-page"
        name="HeroTabsRoot, HeroTabsList, HeroTabsTrigger and HeroTabsContent"
        importPath={`${KIT}/HeroTabsList`}
        description="The same tabs for views held in component state. HeroTabsRoot wraps the hero and the views; pass `value` and `onValueChange` to control it."
        stacked
      >
        <HeroTabsRoot defaultValue="games">
          <DetailHero
            title="BTMC: (distantmemory) vs (Raikouhou)"
            meta={
              <>
                <HeroMetaItem icon={Trophy}>Break The Meta Cup</HeroMetaItem>
                <HeroMetaItem icon={CalendarDays}>
                  Dec 18, 2021, 19:02 UTC
                </HeroMetaItem>
              </>
            }
            tabs={
              <HeroTabsList aria-label="Match views">
                <HeroTabsTrigger value="games" count="9">
                  Games
                </HeroTabsTrigger>
                <HeroTabsTrigger value="stats">Stats</HeroTabsTrigger>
              </HeroTabsList>
            }
          />
          <HeroTabsContent value="games">
            <Panel>
              <SectionHeader icon={Swords} title="Games" meta="9 games" />
              <PanelBody className={typeScale.bodyMuted}>Rows</PanelBody>
            </Panel>
          </HeroTabsContent>
          <HeroTabsContent value="stats">
            <Panel>
              <SectionHeader icon={ChartLine} title="Match statistics" />
              <PanelBody className={typeScale.bodyMuted}>Tiles</PanelBody>
            </Panel>
          </HeroTabsContent>
        </HeroTabsRoot>
      </Specimen>

      <Specimen
        id="layout-panel"
        name="Panel and PanelBody"
        importPath={`${KIT}/Panel`}
        description="The one surface. A panel starts with a SectionHeader (a list's panel starts with its ListToolbar instead) and holds rows, tiles, a table or a chart, never another card. PanelBody adds the 16px padding."
      >
        <Panel>
          <SectionHeader icon={Gauge} title="Overview" />
          <PanelBody className={typeScale.bodyMuted}>
            Rows, tiles, a table or a chart
          </PanelBody>
        </Panel>
      </Specimen>

      <Specimen
        id="layout-page-section"
        name="PageSection"
        importPath={`${KIT}/PageSection`}
        description="A group of panels on a long page that all follow one control, such as the stats page's panels for one ruleset: a divider, a heading and the control, then the panels, whose section headers take level 3. Most pages have none."
        stacked
      >
        <PageSectionDemo />
      </Specimen>

      <Specimen
        id="layout-section-header"
        name="SectionHeader"
        importPath={`${KIT}/SectionHeader`}
        description="The strip at the top of a panel. The icon is optional and always muted; `infoText` adds an info button; `meta` and `actions` sit on the right."
      >
        <div className="flex flex-col gap-4">
          <Panel>
            <SectionHeader
              icon={Medal}
              title="Tier breakdown"
              infoText="Shows tiers with 5+ scores"
              meta="1,368 of 1,368 scores rated"
            />
            <PanelBody className={typeScale.bodyMuted}>Chart</PanelBody>
          </Panel>
          <Panel>
            <SectionHeader
              icon={ChartCandlestick}
              title="Score distribution"
              meta="1,368 scores"
              actions={
                <Button variant="outline" size="sm">
                  Full range
                </Button>
              }
            />
            <PanelBody className={typeScale.bodyMuted}>Chart</PanelBody>
          </Panel>
          <Panel>
            <SectionHeader
              title="Pooled beatmaps"
              level={3}
              meta="62 beatmaps"
            />
            <PanelBody className={typeScale.bodyMuted}>Rows</PanelBody>
          </Panel>
        </div>
      </Specimen>

      <Specimen
        id="layout-info-button"
        name="InfoButton"
        importPath={`${KIT}/InfoButton`}
        description="The one help button: a muted circled i that opens on hover, keyboard focus and tap. Never a circled question mark or an explanation that opens on hover only."
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">Rank restriction</span>
            <InfoButton label="About rank restriction">
              Best global rank allowed, 1 if open
            </InfoButton>
          </div>
          <div className="flex items-center gap-1">
            <Eyebrow>Peak rating</Eyebrow>
            <InfoButton label="About peak rating" size="sm">
              Highest rating ever reached
            </InfoButton>
          </div>
          {/* onArt: on a hero's dark matte, white in both themes. */}
          <div className="flex items-center gap-1.5 rounded-md bg-black/60 px-3 py-2 text-sm font-medium text-white">
            Rank restriction
            <InfoButton label="About rank restriction" onArt>
              Best global rank allowed, 1 if open
            </InfoButton>
          </div>
        </div>
      </Specimen>

      <Specimen
        id="layout-stat-tile"
        name="StatTile and StatTileGrid"
        importPath={`${KIT}/StatTile`}
        description="One number with its label, in a grid inside a panel. An adornment such as the tier icon sits just left of the value."
      >
        <Panel>
          <SectionHeader icon={ChartLine} title="Rating" />
          <PanelBody>
            <StatTileGrid columns={3}>
              <StatTile
                label="Rating"
                value="2,215"
                adornment={
                  <TierIcon
                    tier="Grandmaster"
                    subTier={2}
                    tooltip
                    width={22}
                    height={22}
                  />
                }
                sub="Peak 2,302"
              />
              <StatTile
                icon={Globe}
                label="Global rank"
                value="#12"
                sub="Country rank #3"
              />
              <StatTile icon={Percent} label="Percentile" value="99th" />
              <StatTile icon={Swords} label="Matches" value="1,204" />
              <StatTile icon={Trophy} label="Tournaments" value="86" />
              <StatTile
                icon={Medal}
                label="Win rate"
                value="61.4%"
                sub="739 of 1,204"
              />
            </StatTileGrid>
          </PanelBody>
        </Panel>
      </Specimen>

      <Specimen
        id="layout-stat-tile-inline"
        name="StatTile, inline layout"
        importPath={`${KIT}/StatTile`}
        description="A short value on the label's line, with room for a gauge underneath. Use it for attribute grids. CS, AR, OD and HP show as plain text; screen readers hear the full name from an sr-only span."
      >
        <StatTileGrid columns={2}>
          {BEATMAP_ATTRIBUTES.map((attribute) => (
            <StatTile
              key={attribute.short}
              layout="inline"
              label={
                <>
                  <span aria-hidden="true">{attribute.short}</span>
                  <span className="sr-only">{attribute.full}</span>
                </>
              }
              value={attribute.value.toFixed(1)}
            >
              <Progress
                aria-hidden
                value={attribute.value * 10}
                className="mt-2.5 h-1.5 bg-muted [&>[data-slot=progress-indicator]]:bg-foreground/60"
              />
            </StatTile>
          ))}
        </StatTileGrid>
      </Specimen>

      <Specimen
        id="layout-tile"
        name="Tile"
        importPath={`${KIT}/Tile`}
        description="The bare tile chrome, for records that are not a single number. `interactive` with `asChild` turns a tile into a button that opens something."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Tile>
            <Eyebrow className="block">Most used in</Eyebrow>
            <a
              href="#layout-tile"
              className="mt-0.5 flex w-fit items-start gap-1 rounded-sm text-sm font-semibold hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Break The Meta Cup
              <ArrowUpRight
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </a>
            <p className={typeScale.meta}>120 scores · 12 games</p>
          </Tile>
          <Tile asChild interactive className="relative">
            <button
              type="button"
              aria-label="Pooled in 62 tournaments, 54 of them verified"
            >
              <Eyebrow className="flex items-center gap-1.5">
                <WavesLadder className="size-3.5 shrink-0" aria-hidden />
                Pooled in
              </Eyebrow>
              <span className="mt-1 block text-xl leading-none font-bold">
                62
              </span>
              <span className="mt-0.5 block text-xs leading-tight text-muted-foreground">
                54 verified
              </span>
              <ChevronRight
                className="absolute top-2.5 right-3 size-3.5 translate-y-px text-muted-foreground"
                aria-hidden
              />
            </button>
          </Tile>
        </div>
      </Specimen>

      <Specimen
        id="layout-row-list"
        name="RowList and RowListItem"
        importPath={`${KIT}/RowList`}
        description="Lists inside a panel are divided rows. Link the name; give a row `href` only on lists whose rows open as a whole (the tournament list, the beatmap list, search results), and say in `linkLabel` whatever the row must say aloud. Such rows get the shared hover tint and their title turns blue on hover."
      >
        <div className="flex flex-col gap-4">
          <Panel>
            <SectionHeader
              icon={Users}
              title="Frequent teammates"
              meta="3 players"
            />
            <RowList>
              {PLAYERS.map((player) => (
                <RowListItem
                  key={player.name}
                  leading={<PlayerAvatar name={player.name} />}
                  title={
                    <EntityLink href="#layout-row-list">
                      {player.name}
                    </EntityLink>
                  }
                  description={player.country}
                  trailing={
                    <span className="font-semibold">{player.rating}</span>
                  }
                />
              ))}
            </RowList>
          </Panel>
          <TournamentListDemo />
        </div>
      </Specimen>

      <Specimen
        id="layout-typography"
        name="Type scale"
        importPath={`${KIT}/Typography`}
        description="Five sizes, all sentence case: page title 30px bold, section title 16px semibold, row title 16px medium, body 14px, labels 12px muted. Use the `typeScale` classes or the small components."
      >
        <dl className="flex flex-col gap-4">
          {(
            [
              ['pageTitle', 'Tournaments', 'PageTitle'],
              ['sectionTitle', 'Tier breakdown', 'SectionTitle'],
              ['rowTitle', 'Break The Meta Cup', 'RowTitle'],
              ['body', 'Only verified data is included in ratings.', null],
              ['bodyMuted', 'osu! · 1v1 · Open rank', null],
              ['label', 'Mod distribution', 'Eyebrow'],
              ['meta', '1,368 scores', null],
            ] as const
          ).map(([key, sample, component]) => (
            <div key={key} className="flex flex-col gap-1">
              <dt className={typeScale.meta}>
                typeScale.{key}
                {component ? ` · <${component}>` : ''}
              </dt>
              <dd className={typeScale[key]}>{sample}</dd>
            </div>
          ))}
        </dl>
      </Specimen>
    </GallerySection>
  );
}
