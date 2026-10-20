/** Each key has its own rate limit, so the cap bounds one account's API use. */
export const MAX_API_KEYS_PER_USER = 3;
export const API_KEY_LIMIT_ERROR_CODE = 'API_KEY_LIMIT_REACHED';
export const API_KEY_LIMIT_MESSAGE = `You can create up to ${MAX_API_KEYS_PER_USER} API keys`;
