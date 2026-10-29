'use client';

import { ChevronDown, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavigationMenu as NavigationMenuPrimitive } from 'radix-ui';

import { Badge } from '@/components/kit/status/Badge';
import { NotificationDot } from '@/components/kit/status/NotificationDot';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuList,
} from '@/components/ui/navigation-menu';
import { formatBadgeCount } from '@/lib/kit/status/count';
import { cn } from '@/lib/utils';

import {
  isMenuActive,
  isMenuLinkActive,
  isNavLinkActive,
  type NavEntry,
  type NavMenuLink,
} from './navigation';

/**
 * A top-level item: plain text that fills on hover. The current one turns
 * blue and semibold, so it does not rely on colour alone.
 */
export const NAV_ITEM_CLASSES =
  'inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-active:font-semibold data-active:text-link';

/** A link inside a dropdown or a mobile group, with its muted icon. */
export const NAV_MENU_LINK_CLASSES =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm whitespace-nowrap text-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-active:font-medium data-active:text-link';

/** The navigation bar from laptop width (1024px) up. */
export default function DesktopNav({ entries }: { entries: NavEntry[] }) {
  const pathname = usePathname();

  return (
    <NavigationMenu
      viewport={false}
      aria-label="Main"
      className="hidden flex-none lg:flex"
    >
      <NavigationMenuList className="gap-0.5">
        {entries.map((entry) =>
          entry.kind === 'link' ? (
            <NavigationMenuItem key={entry.title}>
              <NavigationMenuPrimitive.Link
                asChild
                active={isNavLinkActive(pathname, entry.href)}
              >
                <Link
                  href={entry.href}
                  data-testid={entry.testId}
                  aria-current={
                    isNavLinkActive(pathname, entry.href) ? 'page' : undefined
                  }
                  className={NAV_ITEM_CLASSES}
                >
                  {entry.title}
                </Link>
              </NavigationMenuPrimitive.Link>
            </NavigationMenuItem>
          ) : (
            <NavigationMenuItem key={entry.title}>
              <NavigationMenuPrimitive.Trigger
                data-testid={entry.testId}
                data-active={isMenuActive(pathname, entry) ? '' : undefined}
                className={cn(
                  NAV_ITEM_CLASSES,
                  'group cursor-pointer data-[state=open]:bg-accent data-[state=open]:text-accent-foreground'
                )}
                // Hover opens the menu; a mouse click right after would close it again.
                onPointerDown={(event) => {
                  if (event.pointerType === 'mouse') {
                    event.preventDefault();
                  }
                }}
              >
                {entry.title}
                {entry.notification ? (
                  <NotificationDot label={entry.notification} />
                ) : null}
                <ChevronDown
                  aria-hidden="true"
                  className="size-3 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
                />
              </NavigationMenuPrimitive.Trigger>
              {/* As wide as its longest link, and never narrower than
                  its trigger. */}
              <NavigationMenuContent className="min-w-full rounded-lg p-1 pr-1">
                <ul className="flex flex-col">
                  {entry.links.map((link) => (
                    <li key={link.href}>
                      <NavMenuLinkContent
                        link={link}
                        active={isMenuLinkActive(pathname, link)}
                      />
                    </li>
                  ))}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
          )
        )}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

function NavMenuLinkContent({
  link,
  active,
}: {
  link: NavMenuLink;
  active: boolean;
}) {
  return (
    <NavigationMenuPrimitive.Link asChild active={active}>
      <NavMenuAnchor link={link} active={active} />
    </NavigationMenuPrimitive.Link>
  );
}

/**
 * The anchor for a dropdown or mobile-group link: internal links use
 * `next/link`, outside sites open in a new tab and say so.
 */
export function NavMenuAnchor({
  link,
  active,
  className,
  ...props
}: {
  link: NavMenuLink;
  active: boolean;
  className?: string;
} & Omit<React.ComponentProps<'a'>, 'href' | 'children'>) {
  const { title, href, icon: Icon, external, count, countLabel, testId } = link;
  const content = (
    <>
      <Icon
        aria-hidden
        className={cn(
          'size-4 shrink-0',
          active ? 'text-primary' : 'text-muted-foreground'
        )}
      />
      <span className="flex-1">{title}</span>
      {count !== undefined && count > 0 ? (
        <Badge variant="solid" tone="primary" size="sm">
          {formatBadgeCount(count)}
          {countLabel ? <span className="sr-only"> {countLabel}</span> : null}
        </Badge>
      ) : null}
      {external ? (
        <>
          <ExternalLink
            aria-hidden
            className="ml-2 size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      ) : null}
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={testId}
        className={cn(NAV_MENU_LINK_CLASSES, className)}
        {...props}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={href}
      prefetch={false}
      data-testid={testId}
      data-active={active ? '' : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(NAV_MENU_LINK_CLASSES, className)}
      {...props}
    >
      {content}
    </Link>
  );
}
