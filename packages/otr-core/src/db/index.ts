import * as schema from './schema';
import * as relations from './relations';

export const dbSchema = {
  ...schema,
  ...relations,
};

export { schema, relations };
export * from './rejection-cascade';
export * from './verification-cascade';
export { syncTournamentDateRange } from './sync-tournament-date-range';
export { setAuditUserId, withAuditUserId } from './audit';
export {
  findMatchHoldingGames,
  mergeMatchesInto,
  type MergedMatch,
} from './match-merge';
export {
  ADMIN_EDIT_FIELD_GROUPS,
  adminEditColumns,
  editedFieldGroups,
  type AdminEditField,
  type AdminEditTable,
} from './admin-edits';
export { withoutEditLocks, withoutEditedFields } from './admin-edit-locks';
export { excludeMergedGames } from './fetch-exclusions';
