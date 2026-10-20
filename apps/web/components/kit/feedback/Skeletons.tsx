import { Info } from 'lucide-react';
import type * as React from 'react';

import {
  heroTabClassName,
  heroTabListClassName,
} from '@/components/kit/layout/HeroTabs';
import { Panel } from '@/components/kit/layout/Panel';
import { ListToolbar } from '@/components/kit/lists/ListToolbar';
import { RowList, RowListItem } from '@/components/kit/layout/RowList';
import { SectionHeader } from '@/components/kit/layout/SectionHeader';
import { StatTile, StatTileGrid } from '@/components/kit/layout/StatTile';
import { typeScale } from '@/components/kit/layout/Typography';
import {
  type ColumnAlign,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@/components/kit/tables/DataTable';
import {
  PhoneRow,
  type PhoneRowAlign,
  PhoneRowList,
} from '@/components/kit/tables/PhoneRow';
import type { KitIcon } from '@/lib/kit/layout/icon';
import type { ColumnBreakpoint } from '@/lib/kit/tables/cell';
import { cn } from '@/lib/utils';

// Fixed, not random, so server and client render the same widths.
const TEXT_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3'] as const;
const pick = (index: number) => TEXT_WIDTHS[index % TEXT_WIDTHS.length];

/**
 * A pulsing bar that stands in for a line of text inside a real component,
 * such as a value in a StatTile or the description under a PageHeader. It is
 * inline, so the line keeps the height of the text it replaces. Set the width
 * (and a height under the line's) with `className`.
 */
export function SkeletonText({
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'>) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'inline-block h-4 w-24 max-w-full animate-pulse rounded-md bg-accent align-middle',
        className
      )}
      {...props}
    />
  );
}

/**
 * A panel on a loading screen. With no children it draws a header strip and
 * a body block, for a chart or any panel whose content is hard to sketch;
 * give it the loaded panel's height. Pass `label` once per loading screen to
 * announce it.
 */
export function PanelSkeleton({
  label,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'ref'> & {
  /** Makes the panel the screen's status region, such as "Loading reports". */
  label?: string;
}) {
  return (
    <Panel
      as="div"
      data-slot="panel-skeleton"
      role={label ? 'status' : undefined}
      aria-label={label}
      className={cn(children ? undefined : 'flex flex-col', className)}
      {...props}
    >
      {children ?? (
        <>
          <SectionHeaderSkeleton />
          <div className="flex flex-1 p-4">
            <span
              data-slot="skeleton"
              aria-hidden="true"
              className="block min-h-24 w-full flex-1 animate-pulse rounded-lg bg-accent"
            />
          </div>
        </>
      )}
    </Panel>
  );
}

/**
 * A block that stands in for a control, such as a 40px search box or a 32px
 * chip. Give it the control's height, width and corners with `className`.
 * For a line of text use SkeletonText, which keeps the line's height.
 */
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('block animate-pulse rounded-md bg-accent', className)}
    />
  );
}

/**
 * A chart's plot area while it loads, under a real SectionHeaderSkeleton in
 * a PanelSkeleton: a full-width block as tall as the loaded plot. Pass the
 * plot's height class, such as `h-60`.
 */
export function ChartPlotSkeleton({ className }: { className: string }) {
  return <SkeletonBlock className={cn('w-full rounded-lg', className)} />;
}

/**
 * The SectionHeader strip while a panel loads. Pass the real `title`,
 * `icon` and `infoText`, which are static, so nothing shifts when the
 * content arrives; without a title the strip draws a bar in its place.
 */
export function SectionHeaderSkeleton({
  icon: Icon,
  title,
  level = 2,
  infoText,
  meta = true,
  actions = 0,
  className,
}: {
  icon?: KitIcon;
  /** The loaded title. */
  title?: string;
  level?: 2 | 3 | 4;
  /**
   * The loaded header's `infoText`. Its info button is drawn (and works),
   * so the title keeps its width and the strip wraps where the loaded one
   * does.
   */
  infoText?: React.ReactNode;
  /**
   * A short bar on the right, where the count goes. Pass a width class,
   * such as `w-36` for "1,368 of 1,368 scores rated", when the loaded meta
   * is long enough to wrap the strip on a phone; `true` is `w-20`.
   */
  meta?: boolean | string;
  /** Button placeholders after the meta, one per section action. */
  actions?: number;
  className?: string;
}) {
  const metaBar = meta ? (
    <SkeletonText
      className={cn('h-3', typeof meta === 'string' ? meta : 'w-20')}
    />
  ) : null;
  const actionBars =
    actions > 0 ? (
      <>
        {Array.from({ length: actions }, (_, index) => (
          <SkeletonText key={index} className="h-8 w-24" />
        ))}
      </>
    ) : null;

  if (title) {
    return (
      <SectionHeader
        icon={Icon}
        title={title}
        level={level}
        infoText={infoText}
        meta={metaBar}
        actions={actionBars}
        className={className}
      />
    );
  }

  return (
    <div
      data-slot="section-header-skeleton"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3',
        className
      )}
    >
      <div className="flex h-6 min-w-0 items-center gap-2">
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
        <SkeletonText className="w-36" />
        {infoText ? (
          // The info button's 20px box, without a title to name it.
          <Info
            className="box-content size-4 shrink-0 p-0.5 text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      {metaBar || actionBars ? (
        <div className="flex h-6 shrink-0 items-center gap-3">
          {metaBar}
          {actionBars}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A StatTileGrid while it loads: the real tiles with their static labels and
 * bars for the values, so the grid keeps its exact size.
 */
export function StatTileGridSkeleton({
  labels,
  columns = 3,
  sub = false,
  className,
}: {
  /** The loaded tiles' labels, in order. One tile per label. */
  labels: readonly string[];
  /** Columns from `sm` up, as on the loaded grid. */
  columns?: 2 | 3 | 4;
  /** Adds the muted line under each value. */
  sub?: boolean;
  className?: string;
}) {
  return (
    <StatTileGrid columns={columns} className={className}>
      {labels.map((label) => (
        <StatTile
          key={label}
          label={label}
          // Under the value's 20px line: a 20px bar, centred, would add 2px.
          value={<SkeletonText className="w-20" />}
          sub={sub ? <SkeletonText className="h-3 w-14" /> : undefined}
        />
      ))}
    </StatTileGrid>
  );
}

export interface TableSkeletonColumn {
  /** The loaded header text. Without it the header cell is a bar. */
  label?: string;
  /** A width class such as `w-24`. Columns without one share the free space. */
  width?: string;
  /** `end` for numbers, as on the loaded column. */
  align?: ColumnAlign;
  /** Hides the column below this breakpoint, as on the loaded column. */
  showFrom?: ColumnBreakpoint;
}

function defaultColumns(count: number): TableSkeletonColumn[] {
  return Array.from({ length: count }, (_, index) =>
    index === 0
      ? {}
      : { width: 'w-24', align: index === count - 1 ? 'end' : 'start' }
  );
}

/**
 * A DataTable while it loads, edge to edge inside a panel: the real header
 * strip with the loaded table's labels, and rows of bars in its columns.
 * Pass `phoneRows` (a PhoneRowListSkeleton) when the loaded table has phone
 * rows, as DataTable does.
 */
export function TableSkeleton({
  columns = 4,
  rows = 8,
  header = true,
  cellHeight = 'h-6',
  phoneRows,
  className,
}: {
  /** A column count, or the loaded table's columns. */
  columns?: number | readonly TableSkeletonColumn[];
  rows?: number;
  /** Draws the header row. */
  header?: boolean;
  /**
   * The height of the tallest thing in a loaded cell, which sets the row
   * height. `h-6` fits a 24px avatar or badge, as in the beatmap tables;
   * `h-5` plain text, `h-8` a 32px avatar, `h-9` a two-line cell.
   */
  cellHeight?: string;
  /** Shown instead of the table below tablet width, as on the loaded DataTable. */
  phoneRows?: React.ReactNode;
  /** Classes for the wrapper around the table. */
  className?: string;
}) {
  const cols = typeof columns === 'number' ? defaultColumns(columns) : columns;

  return (
    <DataTable
      fixed
      data-slot="table-skeleton"
      aria-hidden="true"
      phoneRows={phoneRows}
      containerClassName={className}
    >
      {header ? (
        <DataTableHeader>
          <DataTableRow>
            {cols.map((column, index) => (
              <DataTableHead
                key={index}
                align={column.align}
                showFrom={column.showFrom}
                className={column.width}
              >
                {column.label ?? <SkeletonText className="h-3 w-12" />}
              </DataTableHead>
            ))}
          </DataTableRow>
        </DataTableHeader>
      ) : null}
      <DataTableBody>
        {Array.from({ length: rows }, (_, row) => (
          <DataTableRow key={row}>
            {cols.map((column, index) => (
              <DataTableCell
                key={index}
                align={column.align}
                showFrom={column.showFrom}
                empty={false}
                className={column.width}
              >
                <span
                  className={cn(
                    'flex items-center',
                    column.align === 'end' && 'justify-end',
                    cellHeight
                  )}
                >
                  <SkeletonText
                    className={column.width ? 'w-4/5' : pick(row + index)}
                  />
                </span>
              </DataTableCell>
            ))}
          </DataTableRow>
        ))}
      </DataTableBody>
    </DataTable>
  );
}

/**
 * What sits on the right of a loaded phone row: `text` a number on the
 * 20px line, `button` a 32px button such as View, `badge` a 20px badge.
 */
export type PhoneRowSkeletonValue = 'text' | 'button' | 'badge';

/** What the muted line under the name holds: `text`, or `badge` and text. */
export type PhoneRowSkeletonDescription = 'text' | 'badge';

const PHONE_VALUE_BARS: Record<PhoneRowSkeletonValue, React.ReactNode> = {
  // In a span, so the row keeps the 20px text line.
  text: (
    <span>
      <SkeletonText className="w-12" />
    </span>
  ),
  button: <SkeletonBlock className="h-8 w-14" />,
  badge: <SkeletonBlock className="h-5 w-16" />,
};

/**
 * PhoneRows while a table loads on a phone. Give it to TableSkeleton's
 * `phoneRows`, as the loaded DataTable takes a PhoneRowList, with the same
 * parts as the loaded rows so each row keeps its height.
 */
export function PhoneRowListSkeleton({
  rows = 5,
  rank = false,
  avatar = false,
  leading,
  description = true,
  value = true,
  valueDescription = false,
  align,
  className,
}: {
  rows?: number;
  /** Adds the rank column, for ranked lists such as the leaderboard. */
  rank?: boolean;
  /** Adds the 24px avatar inside the name. */
  avatar?: boolean;
  /** Adds a round `leading` avatar of this size (24 or 32px) beside the name and its line. */
  leading?: 24 | 32;
  /**
   * Adds the muted line under the name: `true` or `text` a 12px line,
   * `badge` a 20px badge before the text, as the reports' status line.
   */
  description?: boolean | PhoneRowSkeletonDescription;
  /**
   * Adds what sits on the right: `true` or `text` the key number, `button`
   * a 32px button such as View, `badge` a 20px badge.
   */
  value?: boolean | PhoneRowSkeletonValue;
  /** Adds the muted line under the number. */
  valueDescription?: boolean;
  /** The loaded rows' `align`. */
  align?: PhoneRowAlign;
  className?: string;
}) {
  const valueKind: PhoneRowSkeletonValue | null =
    value === true ? 'text' : value === false ? null : value;
  const descriptionKind: PhoneRowSkeletonDescription | null =
    description === true ? 'text' : description === false ? null : description;

  return (
    <PhoneRowList
      data-slot="phone-row-list-skeleton"
      aria-hidden="true"
      className={className}
    >
      {Array.from({ length: rows }, (_, row) => (
        <PhoneRow
          key={row}
          align={align}
          // Each bar sits in a span so the row keeps the 20px text line.
          rank={rank ? <SkeletonText className="w-6" /> : undefined}
          leading={
            leading ? (
              <SkeletonBlock
                className={cn(
                  'rounded-full',
                  leading === 32 ? 'size-8' : 'size-6'
                )}
              />
            ) : undefined
          }
          title={
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {avatar ? (
                <span
                  data-slot="skeleton"
                  className="block size-6 shrink-0 animate-pulse rounded-full bg-accent"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <SkeletonText className={pick(row)} />
              </span>
            </span>
          }
          description={
            descriptionKind === 'badge' ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <SkeletonBlock className="h-5 w-16 shrink-0" />
                <SkeletonText className={cn('h-3', pick(row + 2))} />
              </span>
            ) : descriptionKind === 'text' ? (
              <SkeletonText className={cn('h-3', pick(row + 2))} />
            ) : undefined
          }
          value={valueKind ? PHONE_VALUE_BARS[valueKind] : undefined}
          valueDescription={
            valueDescription ? <SkeletonText className="h-3 w-10" /> : undefined
          }
        />
      ))}
    </PhoneRowList>
  );
}

// The loaded chips' widths, so the blocks wrap onto as many lines as the
// chips: RulesetChips' All, then each rated ruleset in RATED_RULESETS order
// (osu!, taiko, catch, mania 4K, mania 7K). A RulesetSwitch has no All.
const ALL_CHIP_WIDTH = 'w-15';
const RULESET_CHIP_WIDTHS = ['w-18', 'w-19', 'w-20', 'w-27', 'w-27'] as const;

/** The 32px chip blocks, laid out like RulesetChips and RulesetSwitch. */
function RulesetChipBlocks({
  count,
  all,
  className,
}: {
  count: number;
  all: boolean;
  className?: string;
}) {
  const widths: readonly string[] = all
    ? [ALL_CHIP_WIDTH, ...RULESET_CHIP_WIDTHS]
    : RULESET_CHIP_WIDTHS;

  return (
    <span
      aria-hidden="true"
      className={cn('flex min-w-0 flex-wrap gap-1.5', className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonBlock
          key={index}
          className={cn('h-8 rounded-full', widths[index % widths.length])}
        />
      ))}
    </span>
  );
}

/**
 * A RulesetSwitch while it loads, outside a ListToolbar, such as the stats
 * page's "By ruleset" heading: one chip block per ruleset, as wide as the
 * loaded chip, so the blocks wrap where the chips do. Inside a toolbar, use
 * ListToolbarSkeleton's `rulesets` with `rulesetsAll={false}`.
 */
export function RulesetSwitchSkeleton({
  count = RULESET_CHIP_WIDTHS.length,
  className,
}: {
  /** How many chips; defaults to the five rated rulesets. */
  count?: number;
  className?: string;
}) {
  return <RulesetChipBlocks count={count} all={false} className={className} />;
}

/**
 * A list's ListToolbar while the list loads: the real toolbar strip with
 * blocks the size of each control, so the rows below start where the loaded
 * ones will. Turn on the slots the loaded toolbar has; the blocks land on
 * the same rows, and wrap the same way on phones.
 */
export function ListToolbarSkeleton({
  leading,
  search = false,
  sort = false,
  filters = false,
  scope,
  rulesets,
  rulesetsAll = true,
  view,
  count = false,
  className,
}: {
  /** A width class for the `leading` control's 40px block, such as `w-40`. */
  leading?: string;
  /** The 40px search box. */
  search?: boolean;
  /** The 40px sort dropdown and its direction button. */
  sort?: boolean;
  /** The 40px Filters button. */
  filters?: boolean;
  /** A width class for the 32px scope switch, such as `w-32` for All / Friends. */
  scope?: string;
  /**
   * How many 32px ruleset chips, "All" included when there is one: 6 for
   * RulesetChips with every rated ruleset, 5 for a RulesetSwitch.
   */
  rulesets?: number;
  /**
   * Starts the chips with RulesetChips' "All". Pass `false` for a
   * RulesetSwitch (the leaderboard), which has no All chip, so each block
   * takes its own ruleset's width.
   */
  rulesetsAll?: boolean;
  /** How many 32px view toggles. */
  view?: number;
  /** The result count's bar. */
  count?: boolean;
  className?: string;
}) {
  return (
    <ListToolbar
      label="Loading"
      aria-hidden="true"
      data-slot="list-toolbar-skeleton"
      className={className}
      leading={
        leading ? <SkeletonBlock className={cn('h-10', leading)} /> : null
      }
      search={search ? <SkeletonBlock className="h-10 w-full" /> : null}
      sort={
        sort ? (
          <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 md:flex">
            <SkeletonBlock className="h-10 w-full md:w-48" />
            <SkeletonBlock className="size-10" />
          </span>
        ) : null
      }
      filters={filters ? <SkeletonBlock className="h-10 w-28" /> : null}
      scope={scope ? <SkeletonBlock className={cn('h-8', scope)} /> : null}
      rulesets={
        rulesets ? (
          <RulesetChipBlocks count={rulesets} all={rulesetsAll} />
        ) : null
      }
      view={
        view ? (
          <span className="flex gap-1">
            {Array.from({ length: view }, (_, index) => (
              <SkeletonBlock key={index} className="size-8" />
            ))}
          </span>
        ) : null
      }
      count={count ? <SkeletonText className="h-3 w-20" /> : null}
    />
  );
}

const LEADING_CLASSES = {
  avatar: 'size-8 rounded-full',
  square: 'size-10 rounded-md',
  cover: 'h-10 w-18 rounded-md',
} as const;

/** A second muted line under the description: plain text, or a badge first. */
export type RowListSkeletonMeta = 'text' | 'badge';

/**
 * RowList rows while a list loads: the real rows with an avatar or cover,
 * bars for the title and detail line, and the key number on the right. A
 * loading table's phone rows are PhoneRowListSkeleton instead.
 *
 * Rows with more than one detail line take `meta`; rows with small stats
 * (a 12px label over a 14px value) take `stats`, which sit under the text
 * on phones and on the right from `sm`, as the profile's tournament history.
 */
export function RowListSkeleton({
  rows = 5,
  leading = 'avatar',
  description = true,
  meta = false,
  trailing = true,
  stats = 0,
  statsAction = false,
  className,
}: {
  rows?: number;
  /** The shape before the title, or `none`. */
  leading?: keyof typeof LEADING_CLASSES | 'none';
  /** Adds the muted line under the title. */
  description?: boolean;
  /**
   * Adds a second muted 20px line under the description, 6px below it, such
   * as a beatmap row's metrics: `true` or `text` a bar, `badge` a 20px badge
   * and then a bar.
   */
  meta?: boolean | RowListSkeletonMeta;
  /** Adds the right-aligned number. Ignored with `stats`. */
  trailing?: boolean;
  /**
   * How many small stats (a 12px label over a 14px value) the loaded row
   * has. They go under the text on phones, as the loaded rows stack there,
   * and on the right from `sm`.
   */
  stats?: number;
  /** Adds a 32px button after the stats, such as a row's Matches toggle. */
  statsAction?: boolean;
  className?: string;
}) {
  const metaKind: RowListSkeletonMeta | null =
    meta === true ? 'text' : meta === false ? null : meta;

  const leadingBlock = (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'block animate-pulse bg-accent',
        leading === 'none' ? undefined : LEADING_CLASSES[leading]
      )}
    />
  );

  const metaLine = (row: number) =>
    metaKind ? (
      <div className="mt-1.5 flex h-5 min-w-0 items-center gap-3">
        {metaKind === 'badge' ? (
          <SkeletonBlock className="h-5 w-14 shrink-0" />
        ) : null}
        <SkeletonText className={cn('h-3', pick(row + 1))} />
      </div>
    ) : null;

  if (stats > 0 || statsAction) {
    return (
      <RowList data-slot="row-list-skeleton" className={className}>
        {Array.from({ length: rows }, (_, row) => (
          <RowListItem key={row}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {leading === 'none' ? null : (
                  <div className="shrink-0">{leadingBlock}</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className={cn(typeScale.rowTitle, 'flex h-6')}>
                    <SkeletonText className={cn('self-center', pick(row))} />
                  </div>
                  {description ? (
                    <div className={cn('mt-1 flex h-5', typeScale.bodyMuted)}>
                      <SkeletonText
                        className={cn('h-3.5 self-center', pick(row + 2))}
                      />
                    </div>
                  ) : null}
                  {metaLine(row)}
                </div>
              </div>
              <div className="flex items-center justify-between gap-4 sm:justify-end">
                <div className="flex items-center gap-4">
                  {Array.from({ length: stats }, (_, index) => (
                    <span
                      key={index}
                      className="flex min-w-14 flex-col sm:items-end"
                    >
                      <span className="flex h-4 items-center">
                        <SkeletonText className="h-3 w-12" />
                      </span>
                      <span className="flex h-5 items-center">
                        <SkeletonText className="h-3.5 w-10" />
                      </span>
                    </span>
                  ))}
                </div>
                {statsAction ? <SkeletonBlock className="h-8 w-24" /> : null}
              </div>
            </div>
          </RowListItem>
        ))}
      </RowList>
    );
  }

  return (
    <RowList data-slot="row-list-skeleton" className={className}>
      {Array.from({ length: rows }, (_, row) => (
        <RowListItem
          key={row}
          leading={leading === 'none' ? undefined : leadingBlock}
          title={<SkeletonText className={pick(row)} />}
          description={
            description ? (
              <SkeletonText className={cn('h-3.5', pick(row + 2))} />
            ) : undefined
          }
          trailing={trailing ? <SkeletonText className="w-12" /> : undefined}
        >
          {metaLine(row)}
        </RowListItem>
      ))}
    </RowList>
  );
}

/**
 * A hero tab strip while its page loads: 44px tabs, each with its real
 * label when it is static, or a bar when it depends on the data (an audit
 * history's tabs follow the entity). Inside a panel, pass `border-b` with
 * `className`, as the loaded strip has.
 */
export function HeroTabsSkeleton({
  tabs = 2,
  labels,
  className,
}: {
  /** How many tabs, when `labels` is not given. */
  tabs?: number;
  /** The loaded tabs' labels, in order, when they are static. */
  labels?: readonly string[];
  className?: string;
}) {
  const count = labels?.length ?? tabs;

  return (
    <div
      data-slot="hero-tabs-skeleton"
      aria-hidden="true"
      className={cn(heroTabListClassName, className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={cn(heroTabClassName, 'pointer-events-none')}
        >
          {labels?.[index] ?? (
            <SkeletonText
              className={cn('h-3.5', index % 2 ? 'w-20' : 'w-16')}
            />
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * LoadMore's footer while its list loads: the tinted strip with a bar for
 * the readout and a 32px block for the button, 57px tall like the loaded
 * one. Put it after the RowListSkeleton when the loaded list has a LoadMore
 * that shows on first load.
 */
export function LoadMoreSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="load-more-skeleton"
      aria-hidden="true"
      className={cn(
        'flex items-center justify-between gap-4 border-t bg-muted/20 px-4 py-3 dark:bg-muted',
        className
      )}
    >
      <SkeletonText className="h-3 w-28" />
      <SkeletonBlock className="h-8 w-24" />
    </div>
  );
}
