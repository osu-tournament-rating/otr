import { sql, type SQL } from 'drizzle-orm';

// Shared by JavaScript and PostgreSQL, so both read a tournament's forum URL
// the same way. Wiki pages and other URLs have no topic. At most nine digits
// keeps the id inside PostgreSQL's integer.
const FORUM_TOPIC_URL_PATTERN =
  '^https://osu\\.ppy\\.sh/community/forums/topics/([0-9]{1,9})(?![0-9])';

const forumTopicUrlRegex = new RegExp(FORUM_TOPIC_URL_PATTERN);

/** The osu! forum topic id in a tournament's forum URL, or null when it links elsewhere. */
export const parseForumTopicId = (forumUrl: string): number | null => {
  const match = forumTopicUrlRegex.exec(forumUrl);
  if (!match) {
    return null;
  }

  const topicId = Number(match[1]);
  return topicId > 0 ? topicId : null;
};

/** `parseForumTopicId` in SQL: an integer topic id, or NULL. */
export const forumTopicIdSql = (forumUrlColumn: SQL | unknown) =>
  sql<
    number | null
  >`nullif((substring(${forumUrlColumn} from ${FORUM_TOPIC_URL_PATTERN}::text))::integer, 0)`;
