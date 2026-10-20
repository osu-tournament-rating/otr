import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Heatmap } from '@/components/kit/charts/Heatmap';

describe('Heatmap', () => {
  it('is one focusable grid whose cells are named with their value', () => {
    const html = renderToStaticMarkup(
      <Heatmap
        aria-label="When matches are played"
        rows={[
          { key: 'sat', label: 'Sat' },
          { key: 'sun', label: 'Sun' },
        ]}
        columns={[
          { key: '13', label: '13:00' },
          { key: '14', label: '14:00' },
        ]}
        values={[
          [12, 1234],
          [0, 7],
        ]}
        valueName="Matches"
        cellTitle={(row, column) => `${row.label}, ${column.label} UTC`}
      />
    );

    expect(html).toContain('role="grid"');
    expect(html).toContain('aria-label="When matches are played"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/role="gridcell"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Sat, 14:00 UTC: Matches 1,234"');
    expect(html).toContain('aria-label="Sun, 13:00 UTC: Matches 0"');
  });
});
