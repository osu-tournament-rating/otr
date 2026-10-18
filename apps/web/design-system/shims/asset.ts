/**
 * The site serves its images from `public/`, at paths such as
 * `/icons/tiers/Gold1.svg`. In the design system they are uploads with their
 * own URLs, which the build injects as `__OTR_ASSETS__`, and every public path
 * in the bundled source is routed through `assetUrl`.
 */
declare const __OTR_ASSETS__: Record<string, string>;

export function assetUrl(path: string): string {
  let key = path;
  try {
    key = decodeURIComponent(path);
  } catch {
    // Keep the path as written.
  }
  return __OTR_ASSETS__[key] ?? path;
}
