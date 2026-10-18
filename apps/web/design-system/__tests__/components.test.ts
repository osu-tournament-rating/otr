import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMPONENTS } from '../components';

const web = join(import.meta.dir, '../..');
const reference = join(web, '../../.claude/skills/web-design/reference');

/** The `## ` headings of a web-design reference file. */
function headings(file: string): string[] {
  return [
    ...readFileSync(join(reference, file), 'utf8').matchAll(/^## (.+)$/gm),
  ].map((m) => m[1].trim());
}

describe('COMPONENTS', () => {
  it.each(COMPONENTS.map((c) => [c.name, c] as const))(
    '%s has its source, reference sections and preview',
    (name, component) => {
      expect(existsSync(join(web, component.src))).toBe(true);
      for (const ref of component.refs) {
        const [file, heading] = ref.split('#');
        expect(headings(file)).toContain(heading);
      }
      expect(
        existsSync(
          join(web, 'design-system/content/components', name, 'preview.html')
        )
      ).toBe(true);
    }
  );

  it('names each component once', () => {
    const names = COMPONENTS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
