// Names the extension gives the Todoist project and record tasks it creates.
//
// They're created in the user's UI language, but existing ones are found by ID,
// and when they have to be found by name (first sync, or after the ID was lost)
// any bundled language's name is accepted. So a user who switches browser
// language keeps their tasks instead of getting duplicates.

import { t } from './i18n.js';
import { SUPPORTED_LOCALES } from '../config.js';

const KEYS = {
    // legacy: earlier task-name formats, kept so existing tasks are found and renamed.
    group: { task: 'todoistTaskGroup', legacy: ['todoistTaskGroupLegacy1'], untitled: 'untitledGroup' },
    tab: { task: 'todoistTaskTab', legacy: ['todoistTaskTabLegacy1'], untitled: 'untitledPage' },
};
const PROJECT_KEY = 'todoistProject';
// Earlier project names, kept in each language's messages so existing projects
// are found and renamed rather than duplicated.
const LEGACY_PROJECT_KEYS = ['todoistProjectLegacy1'];

let catalogs = null;

async function loadCatalogs() {
    catalogs ??= Promise.all(
        SUPPORTED_LOCALES.map((locale) =>
            fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`))
                .then((res) => res.json())
                .catch(() => null)
        )
    ).then((all) => all.filter(Boolean));
    return catalogs;
}

// Mirrors chrome.i18n.getMessage for raw catalog entries: $1 substitution and
// $$ for a literal dollar sign.
export function formatRaw(entry, ...subs) {
    if (!entry?.message) return null;
    return entry.message.replace(/\$(\$|[1-9])/g, (m, d) => (d === '$' ? '$' : subs[Number(d) - 1] ?? ''));
}

const unique = (values) => [...new Set(values.filter(Boolean))];

/*
    Returns the names sync.js needs for a record kind ('group' or 'tab').
*/
export async function todoNamesFor(kind) {
    const keys = KEYS[kind];
    const all = await loadCatalogs();
    const legacyProjectNames = unique(LEGACY_PROJECT_KEYS.flatMap((key) => [t(key), ...all.map((c) => formatRaw(c[key]))]));
    const legacyTaskNames = (title) =>
        unique(keys.legacy.flatMap((key) => [t(key, title), ...all.map((c) => formatRaw(c[key], title))]));
    return {
        untitled: t(keys.untitled),
        taskName: (title) => t(keys.task, title),
        taskNames: (title) =>
            unique([t(keys.task, title), ...all.map((c) => formatRaw(c[keys.task], title)), ...legacyTaskNames(title)]),
        legacyTaskNames,
        projectName: t(PROJECT_KEY),
        projectNames: unique([t(PROJECT_KEY), ...all.map((c) => formatRaw(c[PROJECT_KEY])), ...legacyProjectNames]),
        legacyProjectNames,
    };
}
