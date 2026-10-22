'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type * as React from 'react';

import { ChartTooltipCard } from '@/components/kit/charts/ChartTooltip';
import { formatCountTick } from '@/lib/kit/charts/format';
import {
  HEATMAP_STEPS,
  type HeatmapCell,
  getHeatmapLevel,
  getHeatmapMax,
  getHeatmapPeak,
  getHeatmapStrength,
  moveHeatmapCell,
} from '@/lib/kit/charts/heatmap';
import { seriesColor } from '@/lib/kit/color/categorical';
import { cn } from '@/lib/utils';

/** One row or column of a heatmap. */
export interface HeatmapAxisItem {
  key: string;
  /** What the axis prints: `Mon`, `05:00`. Keep row labels short. */
  label: string;
}

/** A shade's fill: the series colour mixed with nothing, so it works on any surface. */
function shadeOf(color: string, level: number): string | undefined {
  if (level === 0) return undefined;
  const strength = getHeatmapStrength(level);
  return strength >= 100
    ? color
    : `color-mix(in oklab, ${color} ${strength}%, transparent)`;
}

/** The scale above the grid: the shades from fewest to most, between two words. */
function HeatmapScale({
  color,
  labels,
}: {
  color: string;
  labels: readonly [string, string];
}) {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <span>{labels[0]}</span>
      <span className="flex gap-0.5">
        {Array.from({ length: HEATMAP_STEPS + 1 }, (_, level) => (
          <span
            key={level}
            className={cn('size-2.5 rounded-[2px]', level === 0 && 'bg-muted')}
            style={{ backgroundColor: shadeOf(color, level) }}
          />
        ))}
      </span>
      <span>{labels[1]}</span>
    </div>
  );
}

interface ActiveCell extends HeatmapCell {
  /**
   * Set by a tap, click or key: the readout stays when the pointer leaves.
   * Hover alone shows it only while the pointer is over the grid.
   */
  pinned: boolean;
}

/** Where the readout sits in the grid's box, from the active cell's own box. */
interface ReadoutPosition {
  left: number;
  top: number;
  transform: string;
}

/**
 * A grid of counts by two categories, such as matches by weekday and hour,
 * each cell shaded by its share of the largest. Hover, tap or keyboard
 * focus (arrow keys, Home and End) shows a cell's readout in the chart
 * tooltip card. One series colour, slot 1 unless you pass another; put it
 * in a Panel under a SectionHeader that names what is counted.
 */
export function Heatmap({
  rows,
  columns,
  values,
  columnTicks,
  valueName,
  valueFormatter = formatCountTick,
  cellTitle,
  footer,
  scaleLabels = ['Fewer', 'More'],
  color = seriesColor(0),
  className,
  'aria-label': ariaLabel,
}: {
  rows: readonly HeatmapAxisItem[];
  columns: readonly HeatmapAxisItem[];
  /** One array per row, one value per column. */
  values: readonly (readonly number[])[];
  /**
   * The column keys to label, when not every label fits. From
   * `getCategoryTicks` over the columns' numbers. Every label shows without it.
   */
  columnTicks?: readonly string[];
  /** What a value counts, the readout row's name: `Matches`. */
  valueName: string;
  valueFormatter?: (value: number) => string;
  /** The readout's title and the cell's accessible name: `Saturday, 14:00–15:00 UTC`. */
  cellTitle: (row: HeatmapAxisItem, column: HeatmapAxisItem) => string;
  /** A readout footer for the cell, such as its share of the total. */
  footer?: (value: number) => React.ReactNode;
  /** The words either side of the shade scale. */
  scaleLabels?: readonly [string, string];
  color?: string;
  className?: string;
  /** Names the grid for screen readers, usually the panel's title. */
  'aria-label': string;
}) {
  const id = useId();
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [position, setPosition] = useState<ReadoutPosition | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);
  const max = getHeatmapMax(values);
  const ticks = columnTicks ? new Set(columnTicks) : null;
  const cellId = (cell: HeatmapCell) => `${id}-${cell.row}-${cell.column}`;
  const valueAt = (cell: HeatmapCell) => values[cell.row]?.[cell.column] ?? 0;

  const activeRow = active ? rows[active.row] : undefined;
  const activeColumn = active ? columns[active.column] : undefined;
  const activeValue = active ? valueAt(active) : 0;

  // Measured after each move, so the readout follows the cell at any width.
  useLayoutEffect(() => {
    const container = box.current;
    const target = active
      ? document.getElementById(`${id}-${active.row}-${active.column}`)
      : null;
    setPosition(
      container && target && active
        ? readoutPosition(
            container.getBoundingClientRect(),
            target.getBoundingClientRect(),
            active.row < rows.length / 2
          )
        : null
    );
  }, [active, id, rows.length]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    const from = active ?? getHeatmapPeak(values) ?? { row: 0, column: 0 };
    const next = moveHeatmapCell(from, event.key, {
      rows: rows.length,
      columns: columns.length,
      ctrlKey: event.ctrlKey || event.metaKey,
    });
    if (!next) return;
    event.preventDefault();
    setActive({ ...next, pinned: true });
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <HeatmapScale color={color} labels={scaleLabels} />
      <div ref={box} className="relative">
        <table
          role="grid"
          aria-label={ariaLabel}
          aria-activedescendant={active ? cellId(active) : undefined}
          tabIndex={0}
          className="w-full border-separate border-spacing-0.5 rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          onKeyDown={onKeyDown}
          onPointerDown={() => {
            pointerDown.current = true;
          }}
          onFocus={() => {
            // A tap focuses the grid before it picks a cell; only the keyboard
            // starts on the busiest one.
            if (!pointerDown.current && !active) {
              const peak = getHeatmapPeak(values);
              if (peak) setActive({ ...peak, pinned: true });
            }
            pointerDown.current = false;
          }}
          onBlur={() => setActive(null)}
          onPointerLeave={() =>
            setActive((current) => (current?.pinned ? current : null))
          }
        >
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.key}>
                <th
                  scope="row"
                  className="w-px pr-1.5 text-left text-xs font-normal whitespace-nowrap text-muted-foreground"
                >
                  {row.label}
                </th>
                {columns.map((column, columnIndex) => {
                  const cell = { row: rowIndex, column: columnIndex };
                  const value = valueAt(cell);
                  const level = getHeatmapLevel(value, max);
                  const isActive =
                    active?.row === rowIndex && active.column === columnIndex;

                  return (
                    <td
                      key={column.key}
                      id={cellId(cell)}
                      role="gridcell"
                      aria-selected={isActive}
                      aria-label={`${cellTitle(row, column)}: ${valueName} ${valueFormatter(value)}`}
                      className="p-0"
                      onPointerEnter={(event) => {
                        if (event.pointerType !== 'touch') {
                          setActive({ ...cell, pinned: false });
                        }
                      }}
                      onClick={() => setActive({ ...cell, pinned: true })}
                    >
                      <div
                        className={cn(
                          'h-5 rounded-[3px] sm:h-7',
                          level === 0 && 'bg-muted',
                          isActive &&
                            'outline-2 outline-offset-1 outline-foreground'
                        )}
                        style={{ backgroundColor: shadeOf(color, level) }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot aria-hidden="true">
            <tr>
              <td />
              {columns.map((column) => (
                <td key={column.key} className="relative h-5 p-0">
                  {!ticks || ticks.has(column.key) ? (
                    <span className="absolute top-1 left-1/2 -translate-x-1/2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {column.label}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
        {active && activeRow && activeColumn && position ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 w-max"
            style={position}
          >
            <ChartTooltipCard
              title={cellTitle(activeRow, activeColumn)}
              rows={[
                {
                  key: 'value',
                  label: valueName,
                  value: valueFormatter(activeValue),
                  color: shadeOf(
                    color,
                    Math.max(1, getHeatmapLevel(activeValue, max))
                  ),
                },
              ]}
              footer={footer?.(activeValue)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Places the readout beside the active cell, inside the grid's box: below a
 * cell in the top half and above one in the bottom half, and toward the
 * middle from a cell near either side, so the panel never clips it.
 */
function readoutPosition(
  container: DOMRect,
  cell: DOMRect,
  below: boolean
): ReadoutPosition {
  const center = cell.left + cell.width / 2 - container.left;
  const share = container.width > 0 ? center / container.width : 0.5;
  const x = share < 0.25 ? '0%' : share > 0.75 ? '-100%' : '-50%';

  return {
    left:
      share < 0.25
        ? cell.left - container.left
        : share > 0.75
          ? cell.right - container.left
          : center,
    top: (below ? cell.bottom : cell.top) - container.top,
    transform: `translate(${x}, ${below ? '6px' : 'calc(-100% - 6px)'})`,
  };
}
