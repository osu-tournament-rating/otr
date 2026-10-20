import type { BetterAuthOptions } from 'better-auth';

import { logger } from '@/lib/logger';

const authLibraryLogger = logger.child({ component: 'better-auth' });

/**
 * Cuts the query string and fragment from each URL in `text`. An OAuth
 * callback's query string carries its code and state, and a URL Better Auth
 * refuses, such as a callback URL, comes from the visitor.
 */
const withoutQueryStrings = (text: string): string =>
  text.replace(/((?:[a-z][\w+.-]*:\/\/|\/)[^\s?#"']*)[?#][^\s"']*/gi, '$1');

/**
 * Sends Better Auth's logs through the site's logger, so Grafana's error
 * panels count them. Only errors among its arguments are kept: the others can
 * be a provider's token response or a request's data.
 */
export const betterAuthLogger: NonNullable<BetterAuthOptions['logger']> = {
  log(level, message, ...args) {
    const error = [message, ...args].find((value) => value instanceof Error);
    const text = typeof message === 'string' ? message.trim() : '';

    authLibraryLogger[level](
      withoutQueryStrings(text) || 'Better Auth logged without a message',
      error ? { error } : undefined
    );
  },
};
