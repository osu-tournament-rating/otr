/**
 * The settings panels' static text, shared by the panels and the loading
 * screen, which prints it so each skeleton panel wraps to its loaded height.
 */
export const SETTINGS_COPY = {
  friends: 'Sync your osu! friends list to filter the leaderboard by friends.',
  apiKeys: 'Use o!TR in spreadsheets and other tools via the API.',
  apiKeysReminder:
    'Remember not to leave your keys in sheet templates or other places by mistake.',
  deleteAccount:
    'Permanently delete your account and remove your data from o!TR. Your player profile and the filter reports you created will remain public.',
} as const;
