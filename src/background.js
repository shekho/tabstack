import * as store from './lib/store.js';
import * as auth from './lib/auth.js';
import { createTodoist } from './lib/todoist.js';
import { syncRecord, isDirty, ensureProject } from './lib/sync.js';
import { todoNamesFor } from './lib/todoNames.js';
import { t } from './lib/i18n.js';
import { SYNC_INTERVAL_MINUTES, SYNC_DEBOUNCE_MS } from './config.js';


// ---- Locks ---------------------------------------------------------------
// All writes to a record go through its lock so a sync (which spans network
// calls) never overwrites an edit made while it was running.

const locks = new Map();

function withLock(name, fn) {
    const prev = locks.get(name) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => {});
    locks.set(name, tail);
    tail.then(() => {
        if (locks.get(name) === tail) locks.delete(name);
    });
    return run;
}

const recLock = (key, fn) => withLock(`rec:${key}`, fn);
const mapLock = (fn) => withLock('map', fn);

// ---- Setup ---------------------------------------------------------------

function setup() {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
    chrome.alarms.create('sync', { periodInMinutes: SYNC_INTERVAL_MINUTES });
}

chrome.runtime.onInstalled.addListener(() => {
    setup();
    // Leftovers from the Microsoft To Do version.
    chrome.storage.local.remove('auth').catch(console.error);
    // After an install, update, or reload, bring every existing Todoist task up to date.
    syncAllQuietly({ everything: true });
});
chrome.runtime.onStartup.addListener(() => {
    setup();
    // Bindings don't survive a restart; drop records that never got content.
    mapLock(async () => {
        const bound = new Set(Object.values(await store.getBindings()));
        for (const rec of await store.allRecords()) {
            if (!bound.has(rec.key) && store.isEmpty(rec)) await store.deleteRecord(rec.key);
        }
    }).catch(console.error);
});

// ---- Binding tabs and groups to records -----------------------------------
//
// Groups and tabs each get their own record. Browser IDs only last for a
// session, so after a restart (or when a closed group/page is reopened) an
// unbound record is reattached by group title or by tab URL.

const bindingKey = (kind, id) => `${kind === store.KIND_TAB ? 't' : 'g'}:${id}`;

// Only reattach real pages; every new tab would otherwise pick up the notes
// of the last edge://newtab.
const rematchableUrl = (url) => /^(https?|file):/i.test(url ?? '');

async function findUnbound(kind, bindings, match) {
    const bound = new Set(Object.values(bindings));
    const candidates = (await store.allRecords()).filter(
        (r) => store.kindOf(r) === kind && !bound.has(r.key) && match(r)
    );
    candidates.sort((a, b) => (b.notesUpdatedAt ?? 0) - (a.notesUpdatedAt ?? 0));
    return candidates[0] ?? null;
}

const findUnboundGroup = (bindings, title) =>
    title ? findUnbound(store.KIND_GROUP, bindings, (r) => r.title === title) : null;

const findUnboundTab = (bindings, url) =>
    rematchableUrl(url) ? findUnbound(store.KIND_TAB, bindings, (r) => r.url === url) : null;

function metaFor(kind, rec, source) {
    if (kind === store.KIND_GROUP) return { title: source.title ?? '', color: source.color };
    // A tab's Todoist task is named after the page it was on when it got its first
    // note or task; later navigation doesn't rename it.
    return { title: store.isEmpty(rec) ? source.title || source.url || '' : rec.title, url: source.url ?? rec.url };
}

// Title, color, and URL aren't touched by sync, so this doesn't need the record lock.
async function updateMeta(kind, rec, source) {
    const meta = metaFor(kind, rec, source);
    if (Object.entries(meta).every(([k, v]) => rec[k] === v)) return rec;
    const cur = (await store.getRecord(rec.key)) ?? rec;
    const next = { ...cur, ...metaFor(kind, cur, source) };
    await store.putRecord(next);
    return next;
}

function resolve(kind, id) {
    return mapLock(async () => {
        const source = kind === store.KIND_TAB ? await chrome.tabs.get(id) : await chrome.tabGroups.get(id);
        const bindings = await store.getBindings();
        const bkey = bindingKey(kind, id);
        let rec = bindings[bkey] ? await store.getRecord(bindings[bkey]) : null;
        if (!rec) {
            rec =
                (kind === store.KIND_TAB
                    ? await findUnboundTab(bindings, source.url)
                    : await findUnboundGroup(bindings, source.title)) ?? store.newRecord(kind, source);
            await store.putRecord(rec);
            bindings[bkey] = rec.key;
            await store.setBindings(bindings);
        }
        return updateMeta(kind, rec, source);
    });
}

// When a bound record is still empty and the group/tab now matches an older
// record (a new group given an old title, a new tab navigated to an old page),
// switch to the older record.
async function rebindIfEmpty(kind, id, rec, bindings, match) {
    if (!store.isEmpty(rec) || !match || match.key === rec.key) return rec;
    bindings[bindingKey(kind, id)] = match.key;
    await store.setBindings(bindings);
    await store.deleteRecord(rec.key);
    return match;
}

function onSourceUpdated(kind, id, source) {
    return mapLock(async () => {
        const bindings = await store.getBindings();
        const key = bindings[bindingKey(kind, id)];
        let rec = key ? await store.getRecord(key) : null;
        if (!rec) return;
        const match =
            kind === store.KIND_TAB
                ? source.url !== rec.url && (await findUnboundTab(bindings, source.url))
                : source.title !== rec.title && (await findUnboundGroup(bindings, source.title));
        rec = await rebindIfEmpty(kind, id, rec, bindings, match);
        const before = rec.title;
        rec = await updateMeta(kind, rec, source);
        if (before !== rec.title && rec.remote?.listId) scheduleSync(rec.key);
    }).catch(console.error);
}

function onSourceRemoved(kind, id, info) {
    return mapLock(async () => {
        const bindings = await store.getBindings();
        const bkey = bindingKey(kind, id);
        const key = bindings[bkey];
        if (!key) return;
        delete bindings[bkey];
        await store.setBindings(bindings);
        const rec = await store.getRecord(key);
        if (!rec) return;
        if (store.isEmpty(rec)) {
            await store.deleteRecord(key);
            return;
        }
        // Only closed tabs prompt. Closing a whole window keeps everything, and
        // a group's removal can't be told apart from ungrouping its last tab.
        if (kind !== store.KIND_TAB || info?.isWindowClosing || !store.hasContent(rec)) return;
        const action = await store.getCloseAction();
        if (action === store.CLOSE_DELETE) await deleteClosed([key]);
        else if (action === store.CLOSE_ASK) await queueClosed(rec);
    }).catch(console.error);
}

// ---- Closed tabs ----------------------------------------------------------
// Tabs closed under the "ask" setting wait in storage.session until the side
// pane asks about them (now, or the next time it opens).

async function getClosed() {
    return (await chrome.storage.session.get('closedTabs')).closedTabs ?? [];
}

async function queueClosed(rec) {
    const closed = (await getClosed()).filter((c) => c.key !== rec.key);
    closed.push({ key: rec.key, title: rec.title || rec.url || '', synced: !!rec.remote?.taskId });
    await chrome.storage.session.set({ closedTabs: closed });
}

// Deletes the notes and tasks of closed tabs here and (on the next sync) in Todoist.
async function deleteClosed(keys) {
    for (const key of keys) {
        const rec = await store.getRecord(key);
        if (!rec) continue;
        await ops.clearRecord({ key });
        const cleared = await store.getRecord(key);
        if (cleared && store.isEmpty(cleared)) await store.deleteRecord(key);
    }
}

async function resolveClosed({ keys, action, remember }) {
    if (remember) await store.setCloseAction(action === 'delete' ? store.CLOSE_DELETE : store.CLOSE_KEEP);
    // Reopened tabs (rebound to their record) are no longer closed.
    const bound = new Set(Object.values(await store.getBindings()));
    const target = keys.filter((k) => !bound.has(k));
    if (action === 'delete') await deleteClosed(target);
    const remaining = (await getClosed()).filter((c) => !keys.includes(c.key));
    await chrome.storage.session.set({ closedTabs: remaining });
}

chrome.tabGroups.onUpdated.addListener((group) => onSourceUpdated(store.KIND_GROUP, group.id, group));
chrome.tabGroups.onRemoved.addListener((group) => onSourceRemoved(store.KIND_GROUP, group.id));

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if ('url' in change || 'title' in change) onSourceUpdated(store.KIND_TAB, tabId, tab);
    // Moved into, out of, or between groups: move its Todoist task to match.
    if ('groupId' in change) {
        store.getBindings().then(async (bindings) => {
            const key = bindings[bindingKey(store.KIND_TAB, tabId)];
            const rec = key ? await store.getRecord(key) : null;
            if (rec && !store.isEmpty(rec)) scheduleSync(key);
        }, console.error);
    }
});
chrome.tabs.onRemoved.addListener((tabId, info) => onSourceRemoved(store.KIND_TAB, tabId, info));

// Prerendering and discarding can swap a tab's ID.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
    mapLock(async () => {
        const bindings = await store.getBindings();
        const key = bindings[bindingKey(store.KIND_TAB, removedTabId)];
        if (!key) return;
        delete bindings[bindingKey(store.KIND_TAB, removedTabId)];
        bindings[bindingKey(store.KIND_TAB, addedTabId)] = key;
        await store.setBindings(bindings);
    }).catch(console.error)
);
// ---- Edits ---------------------------------------------------------------

function edit(key, mutate) {
    return recLock(key, async () => {
        const rec = await store.getRecord(key);
        if (!rec) throw new Error(t('errNotesGone'));
        mutate(rec, Date.now());
        await store.putRecord(rec);
        scheduleSync(key);
        return rec;
    });
}

const ops = {
    updateNotes: ({ key, notes }) =>
        edit(key, (rec, now) => {
            rec.notes = notes;
            rec.notesUpdatedAt = now;
        }),
    addTodo: ({ key, title }) =>
        edit(key, (rec, now) => {
            rec.todos.push({ id: crypto.randomUUID(), title, done: false, updatedAt: now });
        }),
    updateTodo: ({ key, id, patch }) =>
        edit(key, (rec, now) => {
            const todo = rec.todos.find((t) => t.id === id);
            if (!todo) return;
            Object.assign(todo, {
                title: patch.title ?? todo.title,
                done: patch.done ?? todo.done,
                important: patch.important ?? todo.important ?? false,
                updatedAt: now,
            });
        }),
    // ids: the open todos in their new order. Other todos keep their slots.
    reorderTodos: ({ key, ids }) =>
        edit(key, (rec, now) => {
            const pos = new Map(ids.map((id, i) => [id, i]));
            const moving = rec.todos.filter((t) => pos.has(t.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
            let i = 0;
            rec.todos = rec.todos.map((t) => (pos.has(t.id) ? moving[i++] : t));
            rec.orderUpdatedAt = now;
        }),
    deleteTodo: ({ key, id }) =>
        edit(key, (rec, now) => {
            const todo = rec.todos.find((t) => t.id === id);
            if (!todo) return;
            // Keep a tombstone until the delete reaches Todoist.
            if (todo.remoteId) Object.assign(todo, { deleted: true, updatedAt: now });
            else rec.todos = rec.todos.filter((t) => t !== todo);
        }),
    // Deletes a tab's or group's notes and tasks. The Todoist task is deleted on
    // the next sync (right away when signed in).
    clearRecord: ({ key }) =>
        edit(key, (rec) => {
            const synced = rec.remote?.provider === 'todoist';
            const taskId = synced ? (rec.remote.taskId ?? rec.remote.deleteTaskId) : undefined;
            Object.assign(rec, {
                notes: '',
                notesUpdatedAt: 0,
                todos: [],
                lastSyncAt: 0,
                remote: { provider: 'todoist', ...(taskId ? { deleteTaskId: taskId } : {}) },
            });
        }),
    resolveGroup: ({ groupId }) => resolve(store.KIND_GROUP, groupId),
    resolveTab: ({ tabId }) => resolve(store.KIND_TAB, tabId),
    syncNow: ({ key }) => (key ? syncKey(key) : syncAll()),
    authState: () => auth.getState(),
    signIn: async () => {
        const account = await auth.signIn(async (token) => {
            const user = await createTodoist(async () => token).getUser();
            return { name: user.full_name, username: user.email };
        });
        syncAllQuietly();
        return account;
    },
    signOut: async () => {
        await auth.signOut();
        projectId = null;
    },
    getCloseAction: () => store.getCloseAction(),
    setCloseAction: ({ action }) => store.setCloseAction(action),
    resolveClosed: (msg) => mapLock(() => resolveClosed(msg)),
};
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const op = ops[msg?.type];
    if (!op) return false;
    Promise.resolve()
        .then(() => op(msg))
        .then(
            (result) => sendResponse({ ok: true, result }),
            (e) => sendResponse({ ok: false, error: e?.message ?? String(e) })
        );
    return true;
});

// ---- Sync ----------------------------------------------------------------

const todoist = () => createTodoist((opts) => auth.getAccessToken(opts));

// The extension's Todoist project, checked once per service-worker lifetime.
let projectId = null;

async function getProjectId(provider) {
    if (projectId) return projectId;
    const settings = await store.getSettings();
    projectId = await ensureProject(provider, await todoNamesFor(store.KIND_GROUP), settings.todoistProjectId);
    if (projectId !== settings.todoistProjectId) await store.setSettings({ ...settings, todoistProjectId: projectId });
    return projectId;
}
async function setStatus(state, message = '') {
    await chrome.storage.session.set({ syncStatus: { state, message, at: Date.now() } });
}

const timers = new Map();

function scheduleSync(key) {
    clearTimeout(timers.get(key));
    timers.set(
        key,
        setTimeout(() => {
            timers.delete(key);
            syncKey(key);
        }, SYNC_DEBOUNCE_MS)
    );
}

async function syncKey(key) {
    if (!(await auth.getState()).signedIn) return;
    try {
        await setStatus('syncing');
        // One sync at a time: a tab's sync also syncs its group, and a group's
        // sync must see every tab task created before it.
        await withLock('sync', () => syncOne(key));
        await setStatus('ok');
    } catch (e) {
        console.error('Sync failed', e);
        await setStatus('error', e?.message ?? String(e));
    }
}

/*
    Returns the key of the group record for a tab record's current group, or
    null. A closed tab keeps the group it was last synced under.
*/
async function currentGroupKey(rec) {
    const bindings = await store.getBindings();
    const binding = Object.keys(bindings).find((b) => b.startsWith('t:') && bindings[b] === rec.key);
    const tab = binding ? await chrome.tabs.get(Number(binding.slice(2))).catch(() => null) : null;
    if (!tab) return rec.groupKey ?? null;
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
    return (await resolve(store.KIND_GROUP, tab.groupId).catch(() => null))?.key ?? rec.groupKey ?? null;
}

async function allTabTaskIds() {
    const ids = new Set();
    for (const r of await store.allRecords()) {
        if (store.kindOf(r) !== store.KIND_TAB) continue;
        if (r.remote?.taskId) ids.add(r.remote.taskId);
        if (r.remote?.deleteTaskId) ids.add(r.remote.deleteTaskId);
    }
    return ids;
}

// force: create the group's task even when it has no notes or todos, because a
// tab under it needs a parent.
function syncOne(key, { force = false } = {}) {
    return recLock(key, async () => {
        const rec = await store.getRecord(key);
        if (!rec) return null;
        const kind = store.kindOf(rec);
        // Only groups adopt an existing Todoist task by name, so an empty tab
        // has nothing to sync yet.
        if (kind === store.KIND_TAB && store.isEmpty(rec)) return rec;

        const provider = todoist();
        const names = await todoNamesFor(kind);
        let parentTaskId = null;
        let groupKey = null;
        if (kind === store.KIND_TAB) {
            groupKey = await currentGroupKey(rec);
            if (groupKey) parentTaskId = (await syncOne(groupKey, { force: true }))?.remote?.taskId ?? null;
        }
        let synced;
        try {
            synced = await syncRecord(rec, provider, {
                now: Date.now(),
                names,
                projectId: await getProjectId(provider),
                parentTaskId,
                force,
                tabTaskIds: kind === store.KIND_GROUP ? await allTabTaskIds() : new Set(),
            });
        } catch (e) {
            // The project may have been deleted or archived; check it again next time.
            projectId = null;
            throw e;
        }
        const cur = await store.getRecord(key);
        if (!cur) return synced;
        const next = { ...synced, title: cur.title, color: cur.color, url: cur.url };
        if (kind === store.KIND_TAB) next.groupKey = groupKey;
        await store.putRecord(next);
        // A closed tab whose notes were deleted: nothing left to keep.
        if (store.isEmpty(next) && !Object.values(await store.getBindings()).includes(key)) {
            await store.deleteRecord(key);
        }
        return next;
    });
}

/*
    Syncs every open tab and group with notes, plus anything with changes
    waiting. Reports one status for the whole run and throws the first error,
    so "Sync now" can say whether it worked.
*/
// everything: also sync closed tabs and groups that already have a Todoist task,
// so a new version can update them (for example, rename tasks to a new format).
async function syncAll({ everything = false } = {}) {
    if (!(await auth.getState()).signedIn) return;
    await setStatus('syncing');
    let error = null;
    const bound = new Set(Object.values(await store.getBindings()));
    for (const rec of await store.allRecords()) {
        const wanted = (bound.has(rec.key) && !store.isEmpty(rec)) || isDirty(rec) || (everything && !!rec.remote?.taskId);
        if (!wanted) continue;
        try {
            await withLock('sync', () => syncOne(rec.key));
        } catch (e) {
            console.error('Sync failed', e);
            error ??= e;
        }
    }
    await setStatus(error ? 'error' : 'ok', error?.message ?? '');
    if (error) throw error;
}

const syncAllQuietly = (opts) => syncAll(opts).catch(() => {});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'sync') syncAllQuietly();
});
