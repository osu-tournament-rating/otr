// A pull request that edits or deletes a test that already exists on master
// must say why under `## Tests changed`. A test bent to get a run green then
// has to be named where the reviewer reads, who can judge whether the task
// asked for it. The `testing` skill in .claude/skills/testing/SKILL.md holds
// the rules this enforces.
//
// It runs on every opened, edited, and pushed pull request, so a test edited
// by a later fix, such as one for a failed CI run, is caught too. It catches
// most such edits, not all; the reviewer agent covers the rest.
//
//   gh api --paginate --slurp repos/<owner>/<repo>/pulls/<n>/files |
//     bun .github/scripts/tests-changed.ts check
//     validates PR_BODY against the changed files on stdin

/** A changed file, as the pull request files API returns it. */
export interface ChangedFile {
  filename: string;
  /** `added`, `removed`, `modified`, `renamed`, `copied`, or `changed`. */
  status: string;
  deletions: number;
  /** The unified diff. GitHub leaves it out for very large or binary files. */
  patch?: string;
  /** The old path of a renamed file. */
  previous_filename?: string;
}

/**
 * Paths that hold tests, their fixtures, snapshots (`*.test.ts.snap`), and
 * shared helpers such as `test-utils.ts`.
 */
const TEST_PATHS = [
  /(^|\/)__tests__\//,
  /\.(test|spec|e2e)\.[^/]+$/,
  /(^|[/.])test[-_]utils?\.[^/]+$/,
  /^apps\/web\/e2e\//,
  /^apps\/[^/]+\/tests\//,
  /^apps\/processor\/src\/(?:.+\/)?tests\.rs$/,
];

/**
 * The processor keeps most unit tests inline, in a top-level module declared
 * as `#[cfg(test)]` then `mod tests {`. Each hunk header names the top-level
 * item it falls in, so a hunk inside that module starts `@@ ... @@ mod tests {`.
 */
const INLINE_TEST_SOURCE = /^apps\/processor\/src\/.+\.rs$/;
const TEST_MODULE = /^(?:#\[cfg\(test\)\]|mod \w*tests\b)/;
const TEST_LINE = /#\[(?:tokio::)?test\]|\bassert\w*!/;
const HUNK_HEADER = /^@@ [^@]* @@ ?(.*)$/;

/** Markers that stop a test from running, invert its result, or stop the others. */
const SKIP_MARKER =
  /\b(?:test|it|describe)\.(?:skip|skipIf|if|only|todo|todoIf|fixme|fail|failing|failingIf)\b|\bx(?:it|test|describe)\(|#\[(?:cfg_attr\(.*)?ignore\b|\bpytest\.mark\.(?:skip|skipif|xfail|e2e)\b|\bpytest\.(?:skip|xfail|importorskip)\(|\bunittest\.skip/;

/** A comment line in TypeScript, Rust, or Python, but not a Rust attribute. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*(?:\s|\/|$)|#(?![[!]))/;

/** The module an import line names, in TypeScript or Python. */
const IMPORT_FROM = [
  /\bfrom\s+['"]([^'"]+)['"]/,
  /^\s*import\s+['"]([^'"]+)['"]/,
  /^\s*from\s+(\S+)\s+import\b/,
  /^\s*import\s+([\w.]+)\s*$/,
];

const SECTION = /^##\s+tests changed\s*$/i;
const HEADING = /^#{1,6}\s/;
const BULLET = /^\s*[-*] \S/;
const NONE = /^[-*] (?:none|n\/?a)\.?$/i;

function patchLines(patch: string, sign: '+' | '-'): string[] {
  return patch
    .split('\n')
    .filter((line) => line.startsWith(sign))
    .map((line) => line.slice(1));
}

function importedModule(line: string): string | undefined {
  for (const pattern of IMPORT_FROM) {
    const match = pattern.exec(line);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Whether a removed line changes what a test checks. Blank lines and
 * comments don't, and neither does an import line when the file still
 * imports that module, as when a new test adds a name to the import.
 */
function isMeaningful(line: string, addedModules: Set<string>): boolean {
  if (line.trim() === '' || COMMENT.test(line)) {
    return false;
  }
  const module = importedModule(line);
  return module === undefined || !addedModules.has(module);
}

/** Whether a processor source patch changes a line of an inline test module. */
function changesInlineTest(patch: string): boolean {
  let inTests = false;
  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      inTests = TEST_MODULE.test(header[1]);
      continue;
    }
    if (line.startsWith('+')) {
      continue;
    }

    const text = line.slice(1);
    const removed = line.startsWith('-');
    if (TEST_MODULE.test(text)) {
      if (removed) {
        return true;
      }
      inTests = true;
    } else if (
      removed &&
      (inTests
        ? text.trim() !== '' && !COMMENT.test(text)
        : TEST_LINE.test(text))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a change to this file needs a reason: it changes or removes a
 * meaningful line of an existing test, adds a skip marker to one, or moves a
 * test out of the paths its runner reads. Without a patch, any removed line
 * of a test counts.
 */
function needsReason(file: ChangedFile): boolean {
  const isTest = (path: string) => TEST_PATHS.some((test) => test.test(path));

  if (file.status === 'added') {
    return false;
  }
  if (
    file.previous_filename !== undefined &&
    isTest(file.previous_filename) &&
    !isTest(file.filename)
  ) {
    return true;
  }

  const test = isTest(file.filename);
  const inline = !test && INLINE_TEST_SOURCE.test(file.filename);
  if (!test && !inline) {
    return false;
  }
  if (file.patch === undefined) {
    return test && file.deletions > 0;
  }

  const added = patchLines(file.patch, '+');
  if (added.some((line) => SKIP_MARKER.test(line))) {
    return true;
  }
  if (inline) {
    return changesInlineTest(file.patch);
  }

  const addedModules = new Set(
    added.map(importedModule).filter((module) => module !== undefined)
  );
  return patchLines(file.patch, '-').some((line) =>
    isMeaningful(line, addedModules)
  );
}

/** The files whose test changes the description must explain. */
export function changedTests(files: ChangedFile[]): string[] {
  return files.filter(needsReason).map((file) => file.filename);
}

/** The bullets under `## Tests changed`, without comments. */
function testsChangedBullets(body: string | null): string[] {
  const lines = (body ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n');

  const start = lines.findIndex((line) => SECTION.test(line.trim()));
  if (start === -1) {
    return [];
  }

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => HEADING.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) =>
    BULLET.test(line)
  );
}

export function checkTestsChanged(
  files: ChangedFile[],
  body: string | null
): string[] {
  const tests = changedTests(files);
  const explained = testsChangedBullets(body).some(
    (line) => !NONE.test(line.trim())
  );
  if (tests.length === 0 || explained) {
    return [];
  }

  const shown = tests.slice(0, 20).map((file) => `\`${file}\``);
  if (tests.length > shown.length) {
    shown.push(`and ${tests.length - shown.length} more`);
  }
  return [
    `This pull request edits or deletes existing tests: ${shown.join(', ')}. ` +
      'Add a `## Tests changed` section with a bullet for each test, or each group changed for one reason, saying why the task required the change. ' +
      'If the task did not require it, restore the test and fix the code instead, as .claude/skills/testing/SKILL.md describes.',
  ];
}

if (import.meta.main) {
  const command = Bun.argv[2];

  if (command === 'check') {
    const pages = JSON.parse(await Bun.stdin.text()) as ChangedFile[][];
    const errors = checkTestsChanged(pages.flat(), process.env.PR_BODY ?? '');
    for (const error of errors) {
      console.log(`::error::${error}`);
    }
    process.exit(errors.length === 0 ? 0 : 1);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
}
