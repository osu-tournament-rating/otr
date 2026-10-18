/** next/link as a plain anchor: the design system has no router. */
import * as React from 'react';

type Href =
  string | { pathname?: string; query?: Record<string, string>; hash?: string };

interface LinkProps extends Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> {
  href?: Href;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
}

/** next/link's own props, which an anchor doesn't take. */
const ROUTER_PROPS = [
  'prefetch',
  'replace',
  'scroll',
  'shallow',
  'passHref',
  'legacyBehavior',
  'locale',
  'onNavigate',
];

function toHref(href: Href | undefined): string {
  if (typeof href === 'string') return href;
  if (!href) return '#';
  const query = href.query ? `?${new URLSearchParams(href.query)}` : '';
  return `${href.pathname ?? ''}${query}${href.hash ? `#${href.hash}` : ''}`;
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, onClick, ...props },
  ref
) {
  const rest: Record<string, unknown> = { ...props };
  for (const key of ROUTER_PROPS) delete rest[key];
  const target = toHref(href);
  return React.createElement('a', {
    ...rest,
    ref,
    href: target,
    // Previews stay on their page; in-page anchors still work.
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (!event.defaultPrevented && !target.startsWith('#')) {
        event.preventDefault();
      }
    },
  });
});

export default Link;
