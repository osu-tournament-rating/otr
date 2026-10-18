import {
  pgTable,
  varchar,
  index,
  uniqueIndex,
  foreignKey,
  integer,
  bigint,
  timestamp,
  jsonb,
  boolean,
  doublePrecision,
  text,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

const tsVector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** Punctuation-stripped text for `to_tsvector`; the query side normalizes the same way. */
export const searchableText = (column: SQL | unknown): SQL =>
  sql`regexp_replace(coalesce(${column}, ''), '[^[:alnum:]]+', ' ', 'g')`;

/** `array_to_string` is only STABLE, which a stored generated column rejects. */
const joinedText = (column: SQL | unknown): SQL =>
  sql`join_text_array(${column})`;

/** `searchableText` with letter/digit runs split, so `OWC2024` indexes as `owc` + `2024`. */
const searchableTextSplitDigits = (column: SQL | unknown): SQL =>
  sql`regexp_replace(regexp_replace(${searchableText(column)}, '([A-Za-z]+)([0-9]+)', '\\1 \\2', 'g'), '([0-9]+)([A-Za-z]+)', '\\1 \\2', 'g')`;

export const efMigrationsHistory = pgTable('__EFMigrationsHistory', {
  migrationId: varchar('migration_id', { length: 150 }).primaryKey().notNull(),
  productVersion: varchar('product_version', { length: 32 }).notNull(),
});

export const auth_users = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    image: text('image'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires'),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
  },
  (table) => [uniqueIndex('auth_users_player_id_key').on(table.playerId)]
);

export const auth_sessions = pgTable('auth_sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => auth_users.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
});

export const auth_accounts = pgTable('auth_accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => auth_users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const auth_verifications = pgTable('auth_verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    name: text('name'),
    start: text('start'),
    prefix: text('prefix'),
    key: text('key').notNull(),
    // Legacy owner column, unread since Better Auth 1.6 replaced it with
    // `referenceId`; droppable once the `reference_id` backfill is confirmed in prod.
    userId: text('user_id').references(() => auth_users.id, {
      onDelete: 'cascade',
    }),
    // Owner of the key, as the Better Auth 1.6 api-key plugin expects it.
    referenceId: text('reference_id')
      .notNull()
      .references(() => auth_users.id, { onDelete: 'cascade' }),
    // Always 'default' here; Better Auth 1.6 keys hashing and verification off it.
    configId: text('config_id').default('default').notNull(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', {
      withTimezone: true,
      mode: 'string',
    }),
    enabled: boolean('enabled').default(true).notNull(),
    rateLimitEnabled: boolean('rate_limit_enabled').default(true).notNull(),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').default(0).notNull(),
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request', {
      withTimezone: true,
      mode: 'string',
    }),
    expiresAt: timestamp('expires_at', {
      withTimezone: true,
      mode: 'string',
    }),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    })
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => sql`CURRENT_TIMESTAMP`)
      .notNull(),
    permissions: text('permissions'),
    metadata: text('metadata'),
  },
  (table) => [
    index('ix_api_keys_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('text_ops')
    ),
  ]
);

export const beatmapsets = pgTable(
  'beatmapsets',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'beatmapsets_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    osuId: bigint('osu_id', { mode: 'number' }).notNull(),
    creatorId: integer('creator_id'),
    artist: varchar({ length: 512 }).notNull(),
    title: varchar({ length: 512 }).notNull(),
    rankedStatus: integer('ranked_status').notNull(),
    rankedDate: timestamp('ranked_date', {
      withTimezone: true,
      mode: 'string',
    }),
    submittedDate: timestamp('submitted_date', {
      withTimezone: true,
      mode: 'string',
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    searchVector: tsVector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', ${searchableText(beatmapsets.artist)}), 'A') || setweight(to_tsvector('simple', ${searchableText(beatmapsets.title)}), 'A')`
      ),
  },
  (table) => [
    index('ix_beatmapsets_creator_id').using(
      'btree',
      table.creatorId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_beatmapsets_osu_id').using(
      'btree',
      table.osuId.asc().nullsLast().op('int8_ops')
    ),
    index('ix_beatmapsets_search_vector').using('gin', table.searchVector),
    index('ix_beatmapsets_artist_trgm').using(
      'gin',
      table.artist.op('gin_trgm_ops')
    ),
    index('ix_beatmapsets_title_trgm').using(
      'gin',
      table.title.op('gin_trgm_ops')
    ),
    foreignKey({
      columns: [table.creatorId],
      foreignColumns: [players.id],
      name: 'fk_beatmapsets_players_creator_id',
    }).onDelete('cascade'),
  ]
);

export const filterReports = pgTable(
  'filter_reports',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'filter_reports_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    userId: integer('user_id').notNull(),
    ruleset: integer().notNull(),
    minRating: integer('min_rating'),
    maxRating: integer('max_rating'),
    tournamentsPlayed: integer('tournaments_played'),
    peakRating: integer('peak_rating'),
    matchesPlayed: integer('matches_played'),
    playersPassed: integer('players_passed').notNull(),
    playersFailed: integer('players_failed').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    maxMatchesPlayed: integer('max_matches_played'),
    maxTournamentsPlayed: integer('max_tournaments_played'),
  },
  (table) => [
    index('ix_filter_reports_user_id').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_filter_reports_users_user_id',
    }).onDelete('cascade'),
  ]
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity({
      name: 'audit_events_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    actionUserId: integer('action_user_id'),
  },
  (table) => [
    index('ix_audit_events_action_user_id').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_audit_events_created').using(
      'btree',
      table.created.asc().nullsLast().op('timestamptz_ops')
    ),
  ]
);

export const gameAudits = pgTable(
  'game_audits',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'game_audits_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    eventId: bigint('event_id', { mode: 'number' }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    referenceIdLock: integer('reference_id_lock').notNull(),
    referenceId: integer('reference_id'),
    actionUserId: integer('action_user_id'),
    actionType: integer('action_type').notNull(),
    changes: jsonb(),
  },
  (table) => [
    index('ix_game_audits_action_user_id').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_audits_action_user_id_created').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops'),
      table.created.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_audits_created').using(
      'btree',
      table.created.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_game_audits_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_audits_reference_id_lock').using(
      'btree',
      table.referenceIdLock.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [auditEvents.id],
      name: 'fk_game_audits_audit_events_event_id',
    }),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [games.id],
      name: 'fk_game_audits_games_reference_id',
    }).onDelete('set null'),
    index('ix_game_audits_changes_gin').using(
      'gin',
      table.changes.op('jsonb_path_ops')
    ),
  ]
);

export const gameRosters = pgTable(
  'game_rosters',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'game_rosters_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    roster: integer().array().notNull(),
    team: integer().notNull(),
    score: integer().notNull(),
    gameId: integer('game_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ix_game_rosters_game_id').using(
      'btree',
      table.gameId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_game_rosters_game_id_roster').using(
      'btree',
      table.gameId.asc().nullsLast().op('int4_ops'),
      table.roster.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_rosters_roster').using(
      'btree',
      table.roster.asc().nullsLast().op('array_ops')
    ),
    foreignKey({
      columns: [table.gameId],
      foreignColumns: [games.id],
      name: 'fk_game_rosters_games_game_id',
    }).onDelete('cascade'),
  ]
);

export const gameScores = pgTable(
  'game_scores',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'game_scores_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    rawScore: integer('raw_score').notNull(),
    adjustedScore: integer('adjusted_score'),
    scoreOverride: integer('score_override'),
    score: integer()
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`COALESCE(${gameScores.scoreOverride}, ${gameScores.adjustedScore}, ${gameScores.rawScore})`
      ),
    placement: integer().notNull(),
    accuracy: doublePrecision().notNull(),
    pp: doublePrecision(),
    maxCombo: integer('max_combo').notNull(),
    pass: boolean().notNull(),
    isPerfectCombo: boolean('is_perfect_combo').notNull(),
    legacyPerfect: boolean('legacy_perfect').notNull(),
    grade: integer().notNull(),
    mods: integer().notNull(),
    statComboBreak: integer('stat_combo_break'),
    statGreat: integer('stat_great'),
    statOk: integer('stat_ok'),
    statMeh: integer('stat_meh'),
    statMiss: integer('stat_miss'),
    statGood: integer('stat_good'),
    statPerfect: integer('stat_perfect'),
    statSliderTailHit: integer('stat_slider_tail_hit'),
    statLargeTickHit: integer('stat_large_tick_hit'),
    statLargeTickMiss: integer('stat_large_tick_miss'),
    statSmallTickHit: integer('stat_small_tick_hit'),
    statSmallTickMiss: integer('stat_small_tick_miss'),
    statLargeBonus: integer('stat_large_bonus'),
    statSmallBonus: integer('stat_small_bonus'),
    statIgnoreHit: integer('stat_ignore_hit'),
    statIgnoreMiss: integer('stat_ignore_miss'),
    statLegacyComboIncrease: integer('stat_legacy_combo_increase'),
    legacyTotalScore: integer('legacy_total_score').notNull(),
    team: integer().notNull(),
    ruleset: integer().notNull(),
    verificationStatus: integer('verification_status').notNull(),
    rejectionReason: integer('rejection_reason').notNull(),
    gameId: integer('game_id').notNull(),
    playerId: integer('player_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('ix_game_scores_game_id').using(
      'btree',
      table.gameId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_scores_player_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_game_scores_player_id_game_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.gameId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_scores_game_verification').using(
      'btree',
      table.gameId.asc().nullsLast().op('int4_ops'),
      table.verificationStatus.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.gameId],
      foreignColumns: [games.id],
      name: 'fk_game_scores_games_game_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_game_scores_players_player_id',
    }).onDelete('cascade'),
  ]
);

export const gameScoreAudits = pgTable(
  'game_score_audits',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'game_score_audits_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    eventId: bigint('event_id', { mode: 'number' }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    referenceIdLock: integer('reference_id_lock').notNull(),
    referenceId: integer('reference_id'),
    actionUserId: integer('action_user_id'),
    actionType: integer('action_type').notNull(),
    changes: jsonb(),
  },
  (table) => [
    index('ix_game_score_audits_action_user_id').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_score_audits_action_user_id_created').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops'),
      table.created.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_score_audits_created').using(
      'btree',
      table.created.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_game_score_audits_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_score_audits_reference_id_lock').using(
      'btree',
      table.referenceIdLock.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [auditEvents.id],
      name: 'fk_game_score_audits_audit_events_event_id',
    }),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [gameScores.id],
      name: 'fk_game_score_audits_game_scores_reference_id',
    }).onDelete('set null'),
    index('ix_game_score_audits_changes_gin').using(
      'gin',
      table.changes.op('jsonb_path_ops')
    ),
  ]
);

export const beatmaps = pgTable(
  'beatmaps',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'beatmaps_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    osuId: bigint('osu_id', { mode: 'number' }).notNull(),
    ruleset: integer().notNull(),
    rankedStatus: integer('ranked_status').notNull(),
    diffName: varchar('diff_name', { length: 512 }).notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    totalLength: bigint('total_length', { mode: 'number' }).notNull(),
    drainLength: integer('drain_length').notNull(),
    bpm: doublePrecision().notNull(),
    countCircle: integer('count_circle').notNull(),
    countSlider: integer('count_slider').notNull(),
    countSpinner: integer('count_spinner').notNull(),
    cs: doublePrecision().notNull(),
    hp: doublePrecision().notNull(),
    od: doublePrecision().notNull(),
    ar: doublePrecision().notNull(),
    sr: doublePrecision().notNull(),
    maxCombo: integer('max_combo'),
    beatmapsetId: integer('beatmapset_id'),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    dataFetchStatus: integer('data_fetch_status').default(0).notNull(),
    // Once set, the osu! API never overwrites this row again.
    manualOverride: boolean('manual_override').default(false).notNull(),
    // Set metadata for a deleted beatmap, which has no beatmapset to carry it.
    // Null everywhere else; readers fall back to the beatmapset.
    titleOverride: varchar('title_override', { length: 512 }),
    artistOverride: varchar('artist_override', { length: 512 }),
    setOwnerIdOverride: integer('set_owner_id_override'),
    searchVector: tsVector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', ${searchableText(beatmaps.diffName)}), 'A') || setweight(to_tsvector('simple', ${searchableText(beatmaps.titleOverride)}), 'A') || setweight(to_tsvector('simple', ${searchableText(beatmaps.artistOverride)}), 'A')`
      ),
  },
  (table) => [
    index('ix_beatmaps_beatmapset_id').using(
      'btree',
      table.beatmapsetId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_beatmaps_osu_id').using(
      'btree',
      table.osuId.asc().nullsLast().op('int8_ops')
    ),
    index('ix_beatmaps_search_vector').using('gin', table.searchVector),
    index('ix_beatmaps_diff_name_trgm').using(
      'gin',
      table.diffName.op('gin_trgm_ops')
    ),
    foreignKey({
      columns: [table.beatmapsetId],
      foreignColumns: [beatmapsets.id],
      name: 'fk_beatmaps_beatmapsets_beatmapset_id',
    }).onDelete('cascade'),
    index('ix_beatmaps_set_owner_id_override').using(
      'btree',
      table.setOwnerIdOverride.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.setOwnerIdOverride],
      foreignColumns: [players.id],
      name: 'fk_beatmaps_players_set_owner_id_override',
    }).onDelete('set null'),
  ]
);

export const beatmapAudits = pgTable(
  'beatmap_audits',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'beatmap_audits_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    eventId: bigint('event_id', { mode: 'number' }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    referenceIdLock: integer('reference_id_lock').notNull(),
    referenceId: integer('reference_id'),
    actionUserId: integer('action_user_id'),
    actionType: integer('action_type').notNull(),
    changes: jsonb(),
  },
  (table) => [
    index('ix_beatmap_audits_action_user_id').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_beatmap_audits_action_user_id_created').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops'),
      table.created.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_beatmap_audits_created').using(
      'btree',
      table.created.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_beatmap_audits_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_beatmap_audits_reference_id_lock').using(
      'btree',
      table.referenceIdLock.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [auditEvents.id],
      name: 'fk_beatmap_audits_audit_events_event_id',
    }),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [beatmaps.id],
      name: 'fk_beatmap_audits_beatmaps_reference_id',
    }).onDelete('set null'),
    index('ix_beatmap_audits_changes_gin').using(
      'gin',
      table.changes.op('jsonb_path_ops')
    ),
  ]
);

export const beatmapAdminNotes = pgTable(
  'beatmap_admin_notes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'beatmap_admin_notes_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    note: text().notNull(),
    referenceId: integer('reference_id').notNull(),
    adminUserId: integer('admin_user_id'),
  },
  (table) => [
    index('ix_beatmap_admin_notes_admin_user_id').using(
      'btree',
      table.adminUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_beatmap_admin_notes_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [beatmaps.id],
      name: 'fk_beatmap_admin_notes_beatmaps_reference_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.adminUserId],
      foreignColumns: [users.id],
      name: 'fk_beatmap_admin_notes_users_admin_user_id',
    }).onDelete('set null'),
  ]
);

export const beatmapStats = pgTable(
  'beatmap_stats',
  {
    beatmapId: integer('beatmap_id')
      .primaryKey()
      .references(() => beatmaps.id, { onDelete: 'cascade' }),
    verifiedGameCount: integer('verified_game_count').notNull().default(0),
    verifiedTournamentCount: integer('verified_tournament_count')
      .notNull()
      .default(0),
    hasVerifiedAppearance: boolean('has_verified_appearance')
      .notNull()
      .default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ix_beatmap_stats_verified_game_count').using(
      'btree',
      table.verifiedGameCount.asc().nullsLast().op('int4_ops')
    ),
    index('ix_beatmap_stats_verified_tournament_count').using(
      'btree',
      table.verifiedTournamentCount.asc().nullsLast().op('int4_ops')
    ),
  ]
);

export const filterReportPlayers = pgTable(
  'filter_report_players',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'filter_report_players_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    filterReportId: integer('filter_report_id').notNull(),
    playerId: integer('player_id').notNull(),
    isSuccess: boolean('is_success').notNull(),
    failureReason: integer('failure_reason'),
    currentRating: doublePrecision('current_rating'),
    tournamentsPlayed: integer('tournaments_played'),
    matchesPlayed: integer('matches_played'),
    peakRating: doublePrecision('peak_rating'),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ix_filter_report_players_filter_report_id').using(
      'btree',
      table.filterReportId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_filter_report_players_filter_report_id_player_id').using(
      'btree',
      table.filterReportId.asc().nullsLast().op('int4_ops'),
      table.playerId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_filter_report_players_player_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.filterReportId],
      foreignColumns: [filterReports.id],
      name: 'fk_filter_report_players_filter_reports_filter_report_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_filter_report_players_players_player_id',
    }).onDelete('cascade'),
  ]
);

export const games = pgTable(
  'games',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'games_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    osuId: bigint('osu_id', { mode: 'number' }).notNull(),
    ruleset: integer().notNull(),
    scoringType: integer('scoring_type').notNull(),
    teamType: integer('team_type').notNull(),
    mods: integer().notNull(),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'string' })
      .default('2007-09-17 00:00:00')
      .notNull(),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'string' })
      .default('2007-09-17 00:00:00')
      .notNull(),
    verificationStatus: integer('verification_status').default(0).notNull(),
    rejectionReason: integer('rejection_reason').default(0).notNull(),
    warningFlags: integer('warning_flags').default(0).notNull(),
    matchId: integer('match_id').notNull(),
    beatmapId: integer('beatmap_id'),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('ix_games_beatmap_id').using(
      'btree',
      table.beatmapId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_games_match_id').using(
      'btree',
      table.matchId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_games_match_id_osu_id').using(
      'btree',
      table.matchId.asc().nullsLast().op('int4_ops'),
      table.osuId.asc().nullsLast().op('int8_ops')
    ),
    index('ix_games_start_time').using(
      'btree',
      table.startTime.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_games_beatmap_verification').using(
      'btree',
      table.beatmapId.asc().nullsLast().op('int4_ops'),
      table.verificationStatus.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.beatmapId],
      foreignColumns: [beatmaps.id],
      name: 'fk_games_beatmaps_beatmap_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.matchId],
      foreignColumns: [matches.id],
      name: 'fk_games_matches_match_id',
    }).onDelete('cascade'),
  ]
);

export const gameAdminNotes = pgTable(
  'game_admin_notes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'game_admin_notes_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    note: text().notNull(),
    referenceId: integer('reference_id').notNull(),
    adminUserId: integer('admin_user_id'),
  },
  (table) => [
    index('ix_game_admin_notes_admin_user_id').using(
      'btree',
      table.adminUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_admin_notes_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [games.id],
      name: 'fk_game_admin_notes_games_reference_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.adminUserId],
      foreignColumns: [users.id],
      name: 'fk_game_admin_notes_users_admin_user_id',
    }).onDelete('set null'),
  ]
);

export const gameScoreAdminNotes = pgTable(
  'game_score_admin_notes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'game_score_admin_notes_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    note: text().notNull(),
    referenceId: integer('reference_id').notNull(),
    adminUserId: integer('admin_user_id'),
  },
  (table) => [
    index('ix_game_score_admin_notes_admin_user_id').using(
      'btree',
      table.adminUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_game_score_admin_notes_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [gameScores.id],
      name: 'fk_game_score_admin_notes_game_scores_reference_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.adminUserId],
      foreignColumns: [users.id],
      name: 'fk_game_score_admin_notes_users_admin_user_id',
    }).onDelete('set null'),
  ]
);

export const matchAudits = pgTable(
  'match_audits',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'match_audits_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    eventId: bigint('event_id', { mode: 'number' }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    referenceIdLock: integer('reference_id_lock').notNull(),
    referenceId: integer('reference_id'),
    actionUserId: integer('action_user_id'),
    actionType: integer('action_type').notNull(),
    changes: jsonb(),
  },
  (table) => [
    index('ix_match_audits_action_user_id').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_match_audits_action_user_id_created').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops'),
      table.created.asc().nullsLast().op('int4_ops')
    ),
    index('ix_match_audits_created').using(
      'btree',
      table.created.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_match_audits_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_match_audits_reference_id_lock').using(
      'btree',
      table.referenceIdLock.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [auditEvents.id],
      name: 'fk_match_audits_audit_events_event_id',
    }),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [matches.id],
      name: 'fk_match_audits_matches_reference_id',
    }).onDelete('set null'),
    index('ix_match_audits_changes_gin').using(
      'gin',
      table.changes.op('jsonb_path_ops')
    ),
  ]
);

export const matchRosters = pgTable(
  'match_rosters',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'match_rosters_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    roster: integer().array().notNull(),
    team: integer().notNull(),
    score: integer().notNull(),
    matchId: integer('match_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ix_match_rosters_match_id').using(
      'btree',
      table.matchId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_match_rosters_match_id_roster').using(
      'btree',
      table.matchId.asc().nullsLast().op('int4_ops'),
      table.roster.asc().nullsLast().op('int4_ops')
    ),
    index('ix_match_rosters_roster').using(
      'btree',
      table.roster.asc().nullsLast().op('array_ops')
    ),
    foreignKey({
      columns: [table.matchId],
      foreignColumns: [matches.id],
      name: 'fk_match_rosters_matches_match_id',
    }).onDelete('cascade'),
  ]
);

export const matchAdminNotes = pgTable(
  'match_admin_notes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'match_admin_notes_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    note: text().notNull(),
    referenceId: integer('reference_id').notNull(),
    adminUserId: integer('admin_user_id'),
  },
  (table) => [
    index('ix_match_admin_notes_admin_user_id').using(
      'btree',
      table.adminUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_match_admin_notes_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [matches.id],
      name: 'fk_match_admin_notes_matches_reference_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.adminUserId],
      foreignColumns: [users.id],
      name: 'fk_match_admin_notes_users_admin_user_id',
    }).onDelete('set null'),
  ]
);

export const matches = pgTable(
  'matches',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'matches_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    osuId: bigint('osu_id', { mode: 'number' }).notNull(),
    name: varchar({ length: 512 }).default('').notNull(),
    searchVector: tsVector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', ${searchableText(matches.name)}), 'A') || setweight(to_tsvector('simple', ${searchableTextSplitDigits(matches.name)}), 'B')`
      ),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'string' }),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'string' }),
    verificationStatus: integer('verification_status').default(0).notNull(),
    rejectionReason: integer('rejection_reason').default(0).notNull(),
    warningFlags: integer('warning_flags').default(0).notNull(),
    isLazer: boolean('is_lazer').default(false).notNull(),
    tournamentId: integer('tournament_id').notNull(),
    submittedByUserId: integer('submitted_by_user_id'),
    verifiedByUserId: integer('verified_by_user_id'),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    dataFetchStatus: integer('data_fetch_status').default(0).notNull(),
  },
  (table) => [
    uniqueIndex('ix_matches_osu_id_is_lazer').using(
      'btree',
      table.osuId.asc().nullsLast().op('int8_ops'),
      table.isLazer.asc().nullsLast().op('bool_ops')
    ),
    index('ix_matches_submitted_by_user_id').using(
      'btree',
      table.submittedByUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_matches_tournament_id').using(
      'btree',
      table.tournamentId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_matches_verified_by_user_id').using(
      'btree',
      table.verifiedByUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_matches_search_vector').using('gin', table.searchVector),
    index('ix_matches_name_trgm').using('gin', table.name.op('gin_trgm_ops')),
    foreignKey({
      columns: [table.tournamentId],
      foreignColumns: [tournaments.id],
      name: 'fk_matches_tournaments_tournament_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.submittedByUserId],
      foreignColumns: [users.id],
      name: 'fk_matches_users_submitted_by_user_id',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.verifiedByUserId],
      foreignColumns: [users.id],
      name: 'fk_matches_users_verified_by_user_id',
    }).onDelete('set null'),
  ]
);

export const playerAdminNotes = pgTable(
  'player_admin_notes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'player_admin_notes_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    note: text().notNull(),
    referenceId: integer('reference_id').notNull(),
    adminUserId: integer('admin_user_id').notNull(),
  },
  (table) => [
    index('ix_player_admin_notes_admin_user_id').using(
      'btree',
      table.adminUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_player_admin_notes_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [players.id],
      name: 'fk_player_admin_notes_players_reference_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.adminUserId],
      foreignColumns: [users.id],
      name: 'fk_player_admin_notes_users_admin_user_id',
    }).onDelete('cascade'),
  ]
);

export const playerHighestRanks = pgTable(
  'player_highest_ranks',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'player_highest_ranks_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    ruleset: integer().notNull(),
    globalRank: integer('global_rank').notNull(),
    globalRankDate: timestamp('global_rank_date', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    countryRank: integer('country_rank').notNull(),
    countryRankDate: timestamp('country_rank_date', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    playerId: integer('player_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('ix_player_highest_ranks_country_rank').using(
      'btree',
      table.countryRank.desc().nullsFirst().op('int4_ops')
    ),
    index('ix_player_highest_ranks_global_rank').using(
      'btree',
      table.globalRank.desc().nullsFirst().op('int4_ops')
    ),
    uniqueIndex('ix_player_highest_ranks_player_id_ruleset').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.ruleset.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_player_highest_ranks_players_player_id',
    }).onDelete('cascade'),
  ]
);

export const playerOsuRulesetData = pgTable(
  'player_osu_ruleset_data',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'player_osu_ruleset_data_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    ruleset: integer().notNull(),
    pp: doublePrecision().notNull(),
    globalRank: integer('global_rank'),
    earliestGlobalRank: integer('earliest_global_rank'),
    earliestGlobalRankDate: timestamp('earliest_global_rank_date', {
      withTimezone: true,
      mode: 'string',
    }),
    playerId: integer('player_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('ix_player_osu_ruleset_data_player_id_ruleset').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.ruleset.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex(
      'ix_player_osu_ruleset_data_player_id_ruleset_global_rank'
    ).using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.ruleset.asc().nullsLast().op('int4_ops'),
      table.globalRank.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_player_osu_ruleset_data_players_player_id',
    }).onDelete('cascade'),
  ]
);

export const ratingAdjustments = pgTable(
  'rating_adjustments',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'rating_adjustments_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    adjustmentType: integer('adjustment_type').notNull(),
    ruleset: integer().notNull(),
    timestamp: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
    ratingBefore: doublePrecision('rating_before').notNull(),
    ratingAfter: doublePrecision('rating_after').notNull(),
    volatilityBefore: doublePrecision('volatility_before').notNull(),
    volatilityAfter: doublePrecision('volatility_after').notNull(),
    playerRatingId: integer('player_rating_id').notNull(),
    playerId: integer('player_id').notNull(),
    matchId: integer('match_id'),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ix_rating_adjustments_match_id').using(
      'btree',
      table.matchId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_rating_adjustments_player_id_match_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.matchId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_rating_adjustments_player_id_timestamp').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.timestamp.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_rating_adjustments_player_rating_id').using(
      'btree',
      table.playerRatingId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.matchId],
      foreignColumns: [matches.id],
      name: 'fk_rating_adjustments_matches_match_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.playerRatingId],
      foreignColumns: [playerRatings.id],
      name: 'fk_rating_adjustments_player_ratings_player_rating_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_rating_adjustments_players_player_id',
    }).onDelete('cascade'),
  ]
);

export const players = pgTable(
  'players',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'players_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    osuId: bigint('osu_id', { mode: 'number' }).notNull(),
    username: varchar({ length: 32 }).default('').notNull(),
    previousUsernames: text('previous_usernames').array().default([]).notNull(),
    searchVector: tsVector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', ${searchableText(players.username)}), 'A') || setweight(to_tsvector('simple', ${searchableText(joinedText(players.previousUsernames))}), 'B')`
      ),
    country: varchar({ length: 4 }).default('').notNull(),
    osuLastFetch: timestamp('osu_last_fetch', {
      withTimezone: true,
      mode: 'string',
    })
      .default('2007-09-17 00:00:00')
      .notNull(),
    osuTrackLastFetch: timestamp('osu_track_last_fetch', {
      withTimezone: true,
      mode: 'string',
    }),
    osuTrackDataFetchStatus: integer('osu_track_data_fetch_status')
      .default(0)
      .notNull(),
    dataFetchStatus: integer('data_fetch_status').default(0).notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('ix_players_country').using(
      'btree',
      table.country.asc().nullsLast().op('text_ops')
    ),
    index('ix_players_search_vector').using('gin', table.searchVector),
    index('ix_players_username_trgm').using(
      'gin',
      table.username.op('gin_trgm_ops')
    ),
    uniqueIndex('ix_players_osu_id').using(
      'btree',
      table.osuId.asc().nullsLast().op('int8_ops')
    ),
  ]
);

export const playerFriends = pgTable(
  'player_friends',
  {
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    friendId: integer('friend_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    mutual: boolean('mutual').default(false).notNull(),
  },
  (table) => [
    index('ix_player_friends_friend_id').using(
      'btree',
      table.friendId.asc().nullsLast().op('int4_ops')
    ),
    primaryKey({
      columns: [table.playerId, table.friendId],
    }),
  ]
);

export const oAuthClients = pgTable(
  'o_auth_clients',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'o_auth_clients_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    secret: varchar({ length: 128 }).notNull(),
    scopes: text().array().notNull(),
    rateLimitOverride: integer('rate_limit_override'),
    userId: integer('user_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index('ix_o_auth_clients_user_id').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_o_auth_clients_users_user_id',
    }).onDelete('cascade'),
  ]
);

export const playerMatchStats = pgTable(
  'player_match_stats',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'player_match_stats_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    matchCost: doublePrecision('match_cost').notNull(),
    averageScore: doublePrecision('average_score').notNull(),
    averagePlacement: doublePrecision('average_placement').notNull(),
    averageMisses: doublePrecision('average_misses').notNull(),
    averageAccuracy: doublePrecision('average_accuracy').notNull(),
    gamesPlayed: integer('games_played').notNull(),
    gamesWon: integer('games_won').notNull(),
    gamesLost: integer('games_lost').notNull(),
    won: boolean().notNull(),
    teammateIds: integer('teammate_ids').array().notNull(),
    opponentIds: integer('opponent_ids').array().notNull(),
    playerId: integer('player_id').notNull(),
    matchId: integer('match_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ix_player_match_stats_match_id').using(
      'btree',
      table.matchId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_player_match_stats_player_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_player_match_stats_player_id_match_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.matchId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_player_match_stats_player_id_won').using(
      'btree',
      table.playerId.asc().nullsLast().op('bool_ops'),
      table.won.asc().nullsLast().op('bool_ops')
    ),
    foreignKey({
      columns: [table.matchId],
      foreignColumns: [matches.id],
      name: 'fk_player_match_stats_matches_match_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_player_match_stats_players_player_id',
    }).onDelete('cascade'),
  ]
);

export const playerRatings = pgTable(
  'player_ratings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'player_ratings_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    ruleset: integer().notNull(),
    rating: doublePrecision().notNull(),
    volatility: doublePrecision().notNull(),
    percentile: doublePrecision().notNull(),
    globalRank: integer('global_rank').notNull(),
    countryRank: integer('country_rank').notNull(),
    playerId: integer('player_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (table) => [
    index('ix_player_ratings_player_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops')
    ),
    uniqueIndex('ix_player_ratings_player_id_ruleset').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.ruleset.asc().nullsLast().op('int4_ops')
    ),
    index('ix_player_ratings_rating').using(
      'btree',
      table.rating.desc().nullsFirst().op('float8_ops')
    ),
    index('ix_player_ratings_ruleset').using(
      'btree',
      table.ruleset.asc().nullsLast().op('int4_ops')
    ),
    index('ix_player_ratings_ruleset_rating').using(
      'btree',
      table.ruleset.asc().nullsLast().op('int4_ops'),
      table.rating.desc().nullsFirst().op('float8_ops')
    ),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_player_ratings_players_player_id',
    }).onDelete('cascade'),
  ]
);

export const playerTournamentStats = pgTable(
  'player_tournament_stats',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'player_tournament_stats_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    averageRatingDelta: doublePrecision('average_rating_delta').notNull(),
    averageMatchCost: doublePrecision('average_match_cost').notNull(),
    averageScore: integer('average_score').notNull(),
    averagePlacement: doublePrecision('average_placement').notNull(),
    averageAccuracy: doublePrecision('average_accuracy').notNull(),
    matchesPlayed: integer('matches_played').notNull(),
    matchesWon: integer('matches_won').notNull(),
    matchesLost: integer('matches_lost').notNull(),
    gamesPlayed: integer('games_played').notNull(),
    gamesWon: integer('games_won').notNull(),
    gamesLost: integer('games_lost').notNull(),
    teammateIds: integer('teammate_ids').array().notNull(),
    playerId: integer('player_id').notNull(),
    tournamentId: integer('tournament_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    matchWinRate: doublePrecision('match_win_rate').default(0).notNull(),
  },
  (table) => [
    uniqueIndex('ix_player_tournament_stats_player_id_tournament_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops'),
      table.tournamentId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_player_tournament_stats_tournament_id').using(
      'btree',
      table.tournamentId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_player_tournament_stats_players_player_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tournamentId],
      foreignColumns: [tournaments.id],
      name: 'fk_player_tournament_stats_tournaments_tournament_id',
    }).onDelete('cascade'),
  ]
);

export const tournamentAdminNotes = pgTable(
  'tournament_admin_notes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'tournament_admin_notes_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    note: text().notNull(),
    referenceId: integer('reference_id').notNull(),
    adminUserId: integer('admin_user_id'),
  },
  (table) => [
    index('ix_tournament_admin_notes_admin_user_id').using(
      'btree',
      table.adminUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_tournament_admin_notes_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [tournaments.id],
      name: 'fk_tournament_admin_notes_tournaments_reference_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.adminUserId],
      foreignColumns: [users.id],
      name: 'fk_tournament_admin_notes_users_admin_user_id',
    }).onDelete('set null'),
  ]
);

export const tournamentAudits = pgTable(
  'tournament_audits',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'tournament_audits_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    eventId: bigint('event_id', { mode: 'number' }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    referenceIdLock: integer('reference_id_lock').notNull(),
    referenceId: integer('reference_id'),
    actionUserId: integer('action_user_id'),
    actionType: integer('action_type').notNull(),
    changes: jsonb(),
  },
  (table) => [
    index('ix_tournament_audits_action_user_id').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_tournament_audits_action_user_id_created').using(
      'btree',
      table.actionUserId.asc().nullsLast().op('int4_ops'),
      table.created.asc().nullsLast().op('int4_ops')
    ),
    index('ix_tournament_audits_created').using(
      'btree',
      table.created.asc().nullsLast().op('timestamptz_ops')
    ),
    index('ix_tournament_audits_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_tournament_audits_reference_id_lock').using(
      'btree',
      table.referenceIdLock.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.eventId],
      foreignColumns: [auditEvents.id],
      name: 'fk_tournament_audits_audit_events_event_id',
    }),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [tournaments.id],
      name: 'fk_tournament_audits_tournaments_reference_id',
    }).onDelete('set null'),
    index('ix_tournament_audits_changes_gin').using(
      'gin',
      table.changes.op('jsonb_path_ops')
    ),
  ]
);

export const tournaments = pgTable(
  'tournaments',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'tournaments_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    name: varchar({ length: 512 }).notNull(),
    abbreviation: varchar({ length: 32 }).notNull(),
    searchVector: tsVector('search_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', ${searchableText(tournaments.name)}), 'A') || setweight(to_tsvector('simple', ${searchableTextSplitDigits(tournaments.name)}), 'B') || setweight(to_tsvector('simple', ${searchableText(tournaments.abbreviation)}), 'A') || setweight(to_tsvector('simple', ${searchableTextSplitDigits(tournaments.abbreviation)}), 'B')`
      ),
    /** `search_vector`'s text, reweighted below a match's own words for match search. */
    matchRankVector: tsVector('match_rank_vector')
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('simple', ${searchableText(tournaments.name)}), 'B') || setweight(to_tsvector('simple', ${searchableTextSplitDigits(tournaments.name)}), 'C') || setweight(to_tsvector('simple', ${searchableText(tournaments.abbreviation)}), 'D') || setweight(to_tsvector('simple', ${searchableTextSplitDigits(tournaments.abbreviation)}), 'D')`
      ),
    forumUrl: varchar('forum_url', { length: 255 }).notNull(),
    rankRangeLowerBound: integer('rank_range_lower_bound').notNull(),
    ruleset: integer().notNull(),
    lobbySize: integer('lobby_size').notNull(),
    verificationStatus: integer('verification_status').default(0).notNull(),
    rejectionReason: integer('rejection_reason').default(0).notNull(),
    isLazer: boolean('is_lazer').default(false).notNull(),
    submittedByUserId: integer('submitted_by_user_id'),
    verifiedByUserId: integer('verified_by_user_id'),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'string' }),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'string' }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('ix_tournaments_name_abbreviation').using(
      'btree',
      table.name.asc().nullsLast().op('text_ops'),
      table.abbreviation.asc().nullsLast().op('text_ops')
    ),
    index('ix_tournaments_ruleset').using(
      'btree',
      table.ruleset.asc().nullsLast().op('int4_ops')
    ),
    index('ix_tournaments_search_vector').using('gin', table.searchVector),
    index('ix_tournaments_name_trgm').using(
      'gin',
      table.name.op('gin_trgm_ops')
    ),
    index('ix_tournaments_abbreviation_trgm').using(
      'gin',
      table.abbreviation.op('gin_trgm_ops')
    ),
    index('ix_tournaments_submitted_by_user_id').using(
      'btree',
      table.submittedByUserId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_tournaments_verified_by_user_id').using(
      'btree',
      table.verifiedByUserId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.submittedByUserId],
      foreignColumns: [users.id],
      name: 'fk_tournaments_users_submitted_by_user_id',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.verifiedByUserId],
      foreignColumns: [users.id],
      name: 'fk_tournaments_users_verified_by_user_id',
    }).onDelete('set null'),
  ]
);

export const userSettings = pgTable(
  'user_settings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'user_settings_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    // Ruleset anyone opening this user's profile sees first. Null means the
    // ruleset they have played most.
    profileRuleset: integer('profile_ruleset'),
    // Ruleset this user's leaderboard and tournament list open in. Null means
    // the ruleset they have played most, whatever profileRuleset says.
    browsingRuleset: integer('browsing_ruleset'),
    userId: integer('user_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('ix_user_settings_user_id').using(
      'btree',
      table.userId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'fk_user_settings_users_user_id',
    }).onDelete('cascade'),
  ]
);

export const beatmapAttributes = pgTable(
  'beatmap_attributes',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'beatmap_attributes_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    mods: integer().notNull(),
    sr: doublePrecision().notNull(),
    // AR and OD include the clock rate of DT; CS and HP only EZ and HR.
    ar: doublePrecision().notNull(),
    cs: doublePrecision().notNull(),
    od: doublePrecision().notNull(),
    hp: doublePrecision().notNull(),
    // Calculator release that produced the row, e.g. rosu-pp-js@4.0.1. Rows
    // from another release are recalculated.
    calculator: varchar({ length: 64 }).notNull(),
    beatmapId: integer('beatmap_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    uniqueIndex('ix_beatmap_attributes_beatmap_id_mods').using(
      'btree',
      table.beatmapId.asc().nullsLast().op('int4_ops'),
      table.mods.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.beatmapId],
      foreignColumns: [beatmaps.id],
      name: 'fk_beatmap_attributes_beatmaps_beatmap_id',
    }).onDelete('cascade'),
  ]
);

/** The beatmap's stored .osu file, which its attributes are calculated from. */
export const beatmapFiles = pgTable(
  'beatmap_files',
  {
    beatmapId: integer('beatmap_id').notNull(),
    // MD5 of the stored file, which names its object. Null when no stored
    // object is known.
    checksum: varchar({ length: 32 }),
    // DataFetchStatus. Fetched: the stored file is usable. NotFound: no file
    // is stored and osu! served nothing on the last download. Error: no file
    // is stored and osu! served something unusable on the last download, or
    // the calculator rejected the stored file.
    fetchStatus: integer('fetch_status').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
  },
  (table) => [
    primaryKey({ columns: [table.beatmapId], name: 'pk_beatmap_files' }),
    foreignKey({
      columns: [table.beatmapId],
      foreignColumns: [beatmaps.id],
      name: 'fk_beatmap_files_beatmaps_beatmap_id',
    }).onDelete('cascade'),
  ]
);

export const users = pgTable(
  'users',
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity({
      name: 'users_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    lastLogin: timestamp('last_login', {
      withTimezone: true,
      mode: 'string',
    }).default(sql`CURRENT_TIMESTAMP`),
    scopes: text().array().default(['RAY']).notNull(),
    playerId: integer('player_id').notNull(),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    lastViewedReportsAt: timestamp('last_viewed_reports_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (table) => [
    uniqueIndex('ix_users_player_id').using(
      'btree',
      table.playerId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.playerId],
      foreignColumns: [players.id],
      name: 'fk_users_players_player_id',
    }).onDelete('set null'),
  ]
);

export const oAuthClientAdminNote = pgTable(
  'o_auth_client_admin_note',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'o_auth_client_admin_note_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updated: timestamp({ withTimezone: true, mode: 'string' }),
    note: text().notNull(),
    referenceId: integer('reference_id').notNull(),
    adminUserId: integer('admin_user_id').notNull(),
  },
  (table) => [
    index('ix_o_auth_client_admin_note_reference_id').using(
      'btree',
      table.referenceId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.referenceId],
      foreignColumns: [oAuthClients.id],
      name: 'fk_o_auth_client_admin_note_o_auth_clients_reference_id',
    }).onDelete('cascade'),
  ]
);

export const joinBeatmapCreators = pgTable(
  'join_beatmap_creators',
  {
    createdBeatmapsId: integer('created_beatmaps_id').notNull(),
    creatorsId: integer('creators_id').notNull(),
  },
  (table) => [
    index('ix_join_beatmap_creators_creators_id').using(
      'btree',
      table.creatorsId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.createdBeatmapsId],
      foreignColumns: [beatmaps.id],
      name: 'fk_join_beatmap_creators_beatmaps_created_beatmaps_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.creatorsId],
      foreignColumns: [players.id],
      name: 'fk_join_beatmap_creators_players_creators_id',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.createdBeatmapsId, table.creatorsId],
      name: 'pk_join_beatmap_creators',
    }),
  ]
);

export const joinPooledBeatmaps = pgTable(
  'join_pooled_beatmaps',
  {
    pooledBeatmapsId: integer('pooled_beatmaps_id').notNull(),
    tournamentsPooledInId: integer('tournaments_pooled_in_id').notNull(),
  },
  (table) => [
    index('ix_join_pooled_beatmaps_tournaments_pooled_in_id').using(
      'btree',
      table.tournamentsPooledInId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.pooledBeatmapsId],
      foreignColumns: [beatmaps.id],
      name: 'fk_join_pooled_beatmaps_beatmaps_pooled_beatmaps_id',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tournamentsPooledInId],
      foreignColumns: [tournaments.id],
      name: 'fk_join_pooled_beatmaps_tournaments_tournaments_pooled_in_id',
    }).onDelete('cascade'),
    primaryKey({
      columns: [table.pooledBeatmapsId, table.tournamentsPooledInId],
      name: 'pk_join_pooled_beatmaps',
    }),
  ]
);

export const dataReports = pgTable(
  'data_reports',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity({
      name: 'data_reports_id_seq',
      startWith: 1,
      increment: 1,
      minValue: 1,
      maxValue: 2147483647,
      cache: 1,
    }),
    entityType: integer('entity_type').notNull(),
    entityId: integer('entity_id').notNull(),
    reasonKey: text('reason_key').default('something-else').notNull(),
    suggestedChanges: jsonb('suggested_changes').notNull(),
    justification: text('justification').notNull(),
    status: integer('status').default(0).notNull(),
    adminNote: text('admin_note'),
    reporterUserId: integer('reporter_user_id'),
    resolvedByUserId: integer('resolved_by_user_id'),
    created: timestamp({ withTimezone: true, mode: 'string' })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    resolvedAt: timestamp('resolved_at', {
      withTimezone: true,
      mode: 'string',
    }),
    reporterViewedAt: timestamp('reporter_viewed_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (table) => [
    index('ix_data_reports_entity_type_entity_id').using(
      'btree',
      table.entityType.asc().nullsLast().op('int4_ops'),
      table.entityId.asc().nullsLast().op('int4_ops')
    ),
    index('ix_data_reports_status').using(
      'btree',
      table.status.asc().nullsLast().op('int4_ops')
    ),
    index('ix_data_reports_reporter_user_id').using(
      'btree',
      table.reporterUserId.asc().nullsLast().op('int4_ops')
    ),
    foreignKey({
      columns: [table.reporterUserId],
      foreignColumns: [users.id],
      name: 'fk_data_reports_users_reporter_user_id',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.resolvedByUserId],
      foreignColumns: [users.id],
      name: 'fk_data_reports_users_resolved_by_user_id',
    }).onDelete('set null'),
  ]
);
