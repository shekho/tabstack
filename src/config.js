// Shown on Todoist's consent screen when the extension registers itself.
export const APP_NAME = 'TabStack';

// data:delete is needed to delete subtasks when todos are deleted here.
export const TODOIST_SCOPES = ['data:read_write', 'data:delete'];

// Locales bundled in _locales/. Todoist project and task names from all of
// them are recognized when matching by name (see src/lib/todoNames.js).
export const SUPPORTED_LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt_BR', 'zh_CN', 'zh_TW'];
export const SYNC_INTERVAL_MINUTES = 5;
export const SYNC_DEBOUNCE_MS = 2000;
