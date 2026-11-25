// Persistent records (one per tab group and one per tab) and their live bindings.
//
// Tab and group IDs only last for a browser session, so records have their own
// stable key. Bindings live in storage.session and are rebuilt after a restart
// by matching group titles and tab URLs.

const REC_PREFIX = 'rec:';

export const KIND_GROUP = 'group';
export const KIND_TAB = 'tab';

export const kindOf = (rec) => rec.kind ?? KIND_GROUP;

export async function getRecord(key) {
    const k = REC_PREFIX + key;
    return (await chrome.storage.local.get(k))[k] ?? null;
}

export async function putRecord(rec) {
    await chrome.storage.local.set({ [REC_PREFIX + rec.key]: rec });
}

export async function deleteRecord(key) {
    await chrome.storage.local.remove(REC_PREFIX + key);
}

export async function allRecords() {
    const all = await chrome.storage.local.get(null);
    return Object.entries(all)
        .filter(([k]) => k.startsWith(REC_PREFIX))
        .map(([, v]) => v);
}

export function newRecord(kind, source) {
    const rec = {
        key: crypto.randomUUID(),
        kind,
        title: source.title ?? '',
        notes: '',
        notesUpdatedAt: 0,
        todos: [],
        lastSyncAt: 0,
        remote: {},
    };
    if (kind === KIND_GROUP) rec.color = source.color;
    else rec.url = source.url ?? '';
    return rec;
}

export function isEmpty(rec) {
    return !rec.notes && rec.todos.every((t) => t.deleted) && !rec.remote?.taskId && !rec.remote?.deleteTaskId;
}

export const hasContent = (rec) => !!rec.notes || rec.todos.some((t) => !t.deleted);

// What to do with a tab's notes and tasks when the tab closes.
export const CLOSE_ASK = 'ask';
export const CLOSE_KEEP = 'keep';
export const CLOSE_DELETE = 'delete';

export async function getCloseAction() {
    return (await chrome.storage.local.get('closeAction')).closeAction ?? CLOSE_ASK;
}

export async function setCloseAction(action) {
    await chrome.storage.local.set({ closeAction: action });
}

// Maps "g:<groupId>" and "t:<tabId>" to record keys.
export async function getBindings() {
    return (await chrome.storage.session.get('bindings')).bindings ?? {};
}

export async function setBindings(bindings) {
    await chrome.storage.session.set({ bindings });
}

export async function getSettings() {
    return (await chrome.storage.local.get('settings')).settings ?? {};
}

export async function setSettings(settings) {
    await chrome.storage.local.set({ settings });
}
