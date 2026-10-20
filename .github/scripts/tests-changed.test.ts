import { describe, expect, it } from 'bun:test';
import {
  type ChangedFile,
  changedTests,
  checkTestsChanged,
} from './tests-changed';

const modified = (filename: string, patch?: string): ChangedFile => ({
  filename,
  status: 'modified',
  deletions: patch === undefined ? 3 : patch.split('\n-').length - 1,
  patch,
});

const body = (testsChanged: string) =>
  `## Summary\n\nWhy.\n\n## Tests changed\n\n<!--\n- Name each test and why.\n-->\n\n${testsChanged}\n\n## Deploy risk\n\n- None\n`;

describe('changedTests', () => {
  it('flags a removed or edited line in each kind of test path', () => {
    const edit =
      '@@ -1,2 +1,2 @@\n-  expect(a).toBe(1);\n+  expect(a).toBe(2);';
    const paths = [
      'apps/web/lib/kit/__tests__/format.test.ts',
      'apps/web/components/__snapshots__/Row.test.tsx.snap',
      '.github/scripts/release-notes.test.ts',
      'apps/web/e2e/leaderboard.e2e.ts',
      'apps/web/e2e/fixtures/auth.ts',
      'apps/web/lib/maintenance-window.test-utils.ts',
      'apps/data-worker/src/automation-checks/test-utils.ts',
      'apps/data-worker/tests/integration/osu-track-fetch.e2e.test.ts',
      'apps/scripts/tests/test_recovery.py',
      'apps/replay/tests/fixtures/releases.json',
      'apps/processor/tests/database/db_tests.rs',
      'apps/processor/src/utils/test_utils.rs',
      'apps/processor/src/messaging/tests.rs',
    ];
    expect(changedTests(paths.map((path) => modified(path, edit)))).toEqual(
      paths
    );
  });

  it('flags a deleted test file', () => {
    expect(
      changedTests([
        {
          filename: 'apps/web/e2e/admin.e2e.ts',
          status: 'removed',
          deletions: 341,
        },
      ])
    ).toEqual(['apps/web/e2e/admin.e2e.ts']);
  });

  it('flags a test moved out of the paths its runner reads', () => {
    expect(
      changedTests([
        {
          filename: 'apps/web/lib/kit/format-cases.ts',
          previous_filename: 'apps/web/lib/kit/__tests__/format.test.ts',
          status: 'renamed',
          deletions: 0,
        },
      ])
    ).toEqual(['apps/web/lib/kit/format-cases.ts']);
  });

  it('ignores new tests, added lines, blank lines, comments, and moves', () => {
    expect(
      changedTests([
        {
          filename: 'apps/web/lib/rpc/__tests__/access.test.ts',
          status: 'added',
          deletions: 0,
          patch: '@@ -0,0 +1 @@\n+it.skip("later", () => {});',
        },
        modified(
          'apps/web/lib/kit/__tests__/format.test.ts',
          '@@ -1,3 +1,3 @@\n context\n+  expect(b).toBe(3);\n-\n+\n-  // Rounds half up.\n-  /* old */\n-   * note'
        ),
        modified(
          'apps/scripts/tests/test_main.py',
          '@@ -1 +1 @@\n-# old note\n+# new note'
        ),
        {
          filename: 'apps/web/lib/kit/__tests__/moved.test.ts',
          previous_filename: 'apps/web/lib/kit/__tests__/old.test.ts',
          status: 'renamed',
          deletions: 0,
        },
        modified(
          'apps/web/lib/kit/format.ts',
          '@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;'
        ),
      ])
    ).toEqual([]);
  });

  it('counts an import line only when the module it names changes', () => {
    expect(
      changedTests([
        modified(
          'apps/web/lib/kit/__tests__/same.test.ts',
          "@@ -1 +1 @@\n-import { a } from '../format';\n+import { a, b } from '../format';"
        ),
        modified(
          'apps/scripts/tests/test_same.py',
          '@@ -1 +1 @@\n-from lib import processor\n+from lib import processor, public_html'
        ),
        modified(
          'apps/web/lib/kit/__tests__/swapped.test.ts',
          "@@ -1 +1 @@\n-import { a } from '../format';\n+import { a } from './fake-format';"
        ),
      ])
    ).toEqual(['apps/web/lib/kit/__tests__/swapped.test.ts']);
  });

  it('flags a marker added to an existing test that skips it or inverts it', () => {
    const markers = [
      'it.skip("works", () => {',
      'test.skip(!row, "no data");',
      'describe.if(false)("suite", () => {',
      'test.failing("works", () => {',
      'xit("works", () => {',
      '#[ignore]',
      '#[cfg_attr(not(feature = "broker"), ignore)]',
      '@pytest.mark.skip(reason="flaky")',
      '@pytest.mark.e2e',
    ];
    const files = markers.map((marker, index) =>
      modified(
        `apps/scripts/tests/test_${index}.py`,
        `@@ -1 +1,2 @@\n context\n+${marker}`
      )
    );
    expect(changedTests(files)).toHaveLength(markers.length);
  });

  it('reads the processor inline tests by the module each hunk falls in', () => {
    expect(
      changedTests([
        modified(
          'apps/processor/src/model/rating_tracker.rs',
          '@@ -375,4 +375,4 @@ mod tests {\n             RatingTracker::calculate_percentile(1, 2).unwrap(),\n-            50.0,\n+            49.0,'
        ),
        modified(
          'apps/processor/src/model/rating_utils.rs',
          '@@ -178,6 +178,6 @@ pub fn mu_from_rank(rank: i32) -> f64 {\n }\n \n #[cfg(test)]\n mod tests {\n-    const EXPECTED: f64 = 1200.0;\n+    const EXPECTED: f64 = 1250.0;'
        ),
        modified(
          'apps/processor/src/messaging/mod.rs',
          '@@ -1,5 +1,3 @@ pub mod config;\n pub mod publisher;\n-#[cfg(test)]\n-mod tests;'
        ),
        modified(
          'apps/processor/src/args.rs',
          '@@ -90 +90 @@\n-        assert!(args.verbose);\n+        assert!(!args.verbose);'
        ),
        modified(
          'apps/processor/src/model/otr_model.rs',
          '@@ -40 +40 @@ impl OtrModel {\n-    let rating = 1.0;\n+    let rating = 2.0;'
        ),
      ])
    ).toEqual([
      'apps/processor/src/model/rating_tracker.rs',
      'apps/processor/src/model/rating_utils.rs',
      'apps/processor/src/messaging/mod.rs',
      'apps/processor/src/args.rs',
    ]);
  });

  it('counts any removed line of a test when the patch is missing', () => {
    expect(
      changedTests([
        modified('apps/web/e2e/beatmaps.e2e.ts'),
        modified('apps/processor/src/model/decay.rs'),
      ])
    ).toEqual(['apps/web/e2e/beatmaps.e2e.ts']);
  });
});

describe('checkTestsChanged', () => {
  const edited = [
    modified(
      'apps/web/lib/kit/__tests__/format.test.ts',
      '@@ -1 +1 @@\n-  expect(a).toBe(1);\n+  expect(a).toBe(2);'
    ),
  ];

  it('passes when the section explains the change', () => {
    expect(
      checkTestsChanged(edited, body('- Format: rounds half up, as asked.'))
    ).toEqual([]);
  });

  it('passes without the section when no existing test changed', () => {
    expect(checkTestsChanged([], '## Summary\n\nWhy.\n')).toEqual([]);
  });

  it('fails when the section is missing, says None, or holds only its comment', () => {
    for (const description of [
      '## Summary\n\nWhy.\n',
      body('- None'),
      body('- N/A'),
      body(''),
      null,
    ]) {
      const errors = checkTestsChanged(edited, description);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('apps/web/lib/kit/__tests__/format.test.ts');
    }
  });

  it('reads bullets only up to the next heading', () => {
    expect(
      checkTestsChanged(
        edited,
        '## Tests changed\n\n## Deploy risk\n\n- The format changes.\n'
      )
    ).toHaveLength(1);
  });
});
