import { t, tp, uiLanguage, formatNumber, localizeDocument, setRichText } from '../lib/i18n.js';
import { isDirty } from '../lib/sync.js';

const $ = (id) => document.getElementById(id);
const NO_GROUP = -1;
const NOTES_SAVE_DELAY_MS = 500;
const SVG_NS = 'http://www.w3.org/2000/svg';

// Fluent-style line icons, 20x20.
const ICONS = {
    page: '<path d="M5.5 2.5h6l3.5 3.5v11.5h-9.5z"/><path d="M11.5 2.5V6H15"/>',
    list: '<path d="M7.5 6h9M7.5 10h9M7.5 14h9"/><circle cx="4" cy="6" r=".9" fill="currentColor"/><circle cx="4" cy="10" r=".9" fill="currentColor"/><circle cx="4" cy="14" r=".9" fill="currentColor"/>',
    note: '<path d="M5 3.5h7l3.5 3.5v9.5H5z"/><path d="M12 3.5V7h3.5M7.5 10.5h5M7.5 13h3.5"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    grip: '<g fill="currentColor" stroke="none"><circle cx="7.5" cy="5" r="1.2"/><circle cx="12.5" cy="5" r="1.2"/><circle cx="7.5" cy="10" r="1.2"/><circle cx="12.5" cy="10" r="1.2"/><circle cx="7.5" cy="15" r="1.2"/><circle cx="12.5" cy="15" r="1.2"/></g>',
    cloudSynced: '<path d="M6 15.5h8.3a3.3 3.3 0 0 0 .5-6.6A5 5 0 0 0 5.2 9.8 2.9 2.9 0 0 0 6 15.5z"/><path d="M8 11.8l1.5 1.5 2.8-2.9"/>',
    cloudPending: '<path d="M6 15.5h8.3a3.3 3.3 0 0 0 .5-6.6A5 5 0 0 0 5.2 9.8 2.9 2.9 0 0 0 6 15.5z"/><path d="M10 13.6V10M8.4 11.5L10 9.9l1.6 1.6"/>',
    chevron: '<path d="M7.5 5l5 5-5 5"/>',
    star: '<polygon points="10,2.8 12.2,7.4 17.2,7.9 13.4,11.3 14.5,16.3 10,13.7 5.5,16.3 6.6,11.3 2.8,7.9 7.8,7.4"/>',
    trash: '<path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 10h7.4l.8-10M8.5 9v4.5M11.5 9v4.5"/>',
    sync: '<path d="M15.5 8.5A5.8 5.8 0 0 0 5 6.6M4.5 11.5A5.8 5.8 0 0 0 15 13.4"/><path d="M5 3.5v3.3h3.3M15 16.5v-3.3h-3.3"/>',
    gear: '<path d="M8.48 4.3L8.79 2.5L11.21 2.5L11.52 4.3A5.9 5.9 0 0 1 12.96 4.9L14.45 3.84L16.16 5.55L15.1 7.04A5.9 5.9 0 0 1 15.7 8.48L17.5 8.79L17.5 11.21L15.7 11.52A5.9 5.9 0 0 1 15.1 12.96L16.16 14.45L14.45 16.16L12.96 15.1A5.9 5.9 0 0 1 11.52 15.7L11.21 17.5L8.79 17.5L8.48 15.7A5.9 5.9 0 0 1 7.04 15.1L5.55 16.16L3.84 14.45L4.9 12.96A5.9 5.9 0 0 1 4.3 11.52L2.5 11.21L2.5 8.79L4.3 8.48A5.9 5.9 0 0 1 4.9 7.04L3.84 5.55L5.55 3.84L7.04 4.9A5.9 5.9 0 0 1 8.48 4.3Z"/><circle cx="10" cy="10" r="2.4"/>',
    person: '<circle cx="10" cy="7" r="3"/><path d="M4 16.5c.8-3 3.2-4.5 6-4.5s5.2 1.5 6 4.5"/>',
    check: '<circle class="ring" cx="10" cy="10" r="8"/><path class="tick" d="M6.5 10.3l2.3 2.3 4.7-4.9"/>',
    tabs: '<rect x="2.5" y="6" width="15" height="10.5" rx="1.5"/><path d="M2.5 9h15M5 6V4.5c0-.6.4-1 1-1h3c.6 0 1 .4 1 1V6M10 6V4.5c0-.6.4-1 1-1h2c.6 0 1 .4 1 1V6"/><path d="M6 12.5h5M6 14.5h3" stroke-width=".9"/>',
    dismiss: '<path d="M5 5l10 10M15 5L5 15"/>',
    todo: '<circle cx="10" cy="10" r="7.5"/><path d="M6.5 10.2l2.4 2.4 4.8-5"/>',
};

function icon(name, strokeWidth = 1.4) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', strokeWidth);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name];
    return svg;
}

function fillIcons(root = document) {
    for (const el of root.querySelectorAll('[data-icon]')) {
        if (!el.firstElementChild) el.append(icon(el.dataset.icon));
    }
}

function iconButton(name, className, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `icon-btn ${className}`;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.append(icon(name));
    btn.addEventListener('click', onClick);
    return btn;
}

async function send(msg) {
    const res = await chrome.runtime.sendMessage(msg);
    if (!res?.ok) throw new Error(res?.error ?? t('errNoResponse'));
    return res.result;
}

let windowId;
let activeTab = null;
let activeGroup = null;
let showSeq = 0;
let lastStatus = null;

// Enter submits; Shift+Enter (or Enter while an IME is composing) inserts a newline.
const isSubmitKey = (e) => e.key === 'Enter' && !e.shiftKey && !e.isComposing;

function autoGrow(el) {
    el.style.height = 'auto';
    if (el.scrollHeight) el.style.height = `${el.scrollHeight}px`;
}

function reportError(e) {
    console.error(e);
    renderStatus({ state: 'error', message: e.message });
}

// ---- Panes ------------------------------------------------------------------
//
// Every tab has its own notes and tasks, and so does every tab group. A tab in a
// group shows the group's pane above the tab's.

class Pane {
    constructor(root, kind) {
        this.root = root;
        this.kind = kind;
        this.rec = null;
        this.notesTimer = null;
        this.todosStale = false;
        this.completedOpen = localStorage.getItem(`completedOpen.${kind}`) !== 'false';

        root.append($('pane-template').content.cloneNode(true));
        fillIcons(root);
        const q = (sel) => root.querySelector(sel);
        this.el = {
            icon: q('.title-icon'),
            title: q('.pane-title'),
            subtitle: q('.subtitle'),
            notes: q('.notes-input'),
            notesSync: q('.notes-sync'),
            notesDelete: q('.notes-delete'),
            paneDelete: q('.pane-delete'),
            form: q('.add-task'),
            newTodo: q('.new-todo'),
            open: q('.open-tasks'),
            done: q('.done-tasks'),
            toggle: q('.completed-toggle'),
            count: q('.completed-count'),
            tasksToggle: q('.tasks-toggle'),
            tasksBody: q('.tasks-body'),
            tasksCount: q('.tasks-count'),
        };
        this.wire();
        this.wireReorder();
    }

    wire() {
        const { notes, form, newTodo, open, done, toggle, notesDelete, paneDelete } = this.el;
        notes.addEventListener('input', () => {
            autoGrow(notes);
            notesDelete.hidden = !notes.value;
            clearTimeout(this.notesTimer);
            this.notesTimer = setTimeout(() => this.flushNotes(), NOTES_SAVE_DELAY_MS);
        });
        notes.addEventListener('blur', () => this.flushNotes());

        notesDelete.addEventListener('click', async () => {
            const ok = await confirmDialog(t('confirmDeleteNotes'), this.alsoTodoist());
            if (!ok || !this.rec) return;
            clearTimeout(this.notesTimer);
            this.notesTimer = null;
            notes.value = '';
            autoGrow(notes);
            notesDelete.hidden = true;
            send({ type: 'updateNotes', key: this.rec.key, notes: '' }).catch(reportError);
        });
        paneDelete.addEventListener('click', async () => {
            const title = t(this.kind === 'group' ? 'confirmDeleteGroup' : 'confirmDeleteTab');
            const ok = await confirmDialog(title, this.alsoTodoist());
            if (!ok || !this.rec) return;
            clearTimeout(this.notesTimer);
            this.notesTimer = null;
            send({ type: 'clearRecord', key: this.rec.key }).catch(reportError);
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = newTodo.value.trim();
            if (!title || !this.rec) return;
            newTodo.value = '';
            autoGrow(newTodo);
            send({ type: 'addTodo', key: this.rec.key, title }).catch(reportError);
        });
        newTodo.addEventListener('input', () => autoGrow(newTodo));
        newTodo.addEventListener('keydown', (e) => {
            if (!isSubmitKey(e)) return;
            e.preventDefault();
            form.requestSubmit();
        });

        for (const list of [open, done]) {
            list.addEventListener('focusout', () => setTimeout(() => this.todosStale && this.rec && this.renderTodos()));
        }
        toggle.addEventListener('click', () => {
            this.completedOpen = !this.completedOpen;
            localStorage.setItem(`completedOpen.${this.kind}`, String(this.completedOpen));
            this.renderTodos();
        });
        this.el.tasksToggle.addEventListener('click', () => {
            if (!this.rec) return;
            setTasksCollapsed(this.rec.key, !isTasksCollapsed(this.rec.key));
            this.renderTasksToggle();
        });
    }

    setRecord(rec, full) {
        this.rec = rec;
        this.root.hidden = !rec;
        if (rec) this.render(full);
    }

    render(full) {
        const { notes } = this.el;
        if (full || (document.activeElement !== notes && this.notesTimer === null)) {
            if (notes.value !== this.rec.notes) notes.value = this.rec.notes;
            autoGrow(notes);
        }
        this.renderTodos();
        this.renderTasksToggle();
        this.renderHeader();
        this.renderNotesSync();
        const { rec } = this;
        this.el.notesDelete.hidden = !notes.value;
        this.el.paneDelete.hidden = !rec.notes && rec.todos.every((t) => t.deleted) && !rec.remote?.taskId;
    }

    renderTasksToggle() {
        const collapsed = isTasksCollapsed(this.rec.key);
        const open = this.rec.todos.filter((t) => !t.deleted && !t.done).length;
        this.el.tasksToggle.setAttribute('aria-expanded', String(!collapsed));
        this.el.tasksBody.hidden = collapsed;
        // The count matters most when the list is hidden.
        this.el.tasksCount.textContent = open ? formatNumber(open) : '';
    }

    // Extra line for delete confirmations when the item is also in Todoist.
    alsoTodoist() {
        return isSyncedRecord(this.rec) ? t('confirmAlsoTodoist') : '';
    }

    renderNotesSync() {
        const { rec } = this;
        const synced = isSyncedRecord(rec) && (rec.notesUpdatedAt ?? 0) <= (rec.lastSyncAt ?? 0);
        // Nothing to show for empty notes that were never synced.
        const state = !authState.signedIn ? null : synced ? 'synced' : rec.notes ? 'pending' : null;
        this.el.notesSync.replaceChildren(...(state ? [syncBadge(state, rec.remote.taskId)] : []));
    }

    // heading: {icon: Node, title, details: string[]}; open-task count is appended.
    setHeading({ icon: iconNode, title, details }) {
        this.el.icon.replaceChildren(iconNode);
        this.el.title.textContent = title;
        this.el.title.title = title;
        const open = this.rec ? this.rec.todos.filter((t) => !t.deleted && !t.done).length : 0;
        const parts = [...details];
        if (open) parts.push(tp('openTasks', open));
        this.el.subtitle.textContent = parts.join(' \u00b7 ');
    }

    renderHeader() {
        renderHeading(this);
    }

    renderTodos() {
        const { open, done, toggle, count } = this.el;
        if (this.dragging || [open, done].some((l) => l.contains(document.activeElement))) {
            this.todosStale = true;
            return;
        }
        this.todosStale = false;
        const todos = this.rec.todos.filter((t) => !t.deleted);
        const openTodos = todos.filter((t) => !t.done);
        const doneTodos = todos.filter((t) => t.done);

        open.replaceChildren(...openTodos.map((t) => this.todoItem(t)));
        toggle.hidden = doneTodos.length === 0;
        toggle.setAttribute('aria-expanded', String(this.completedOpen));
        count.textContent = doneTodos.length;
        done.hidden = !this.completedOpen;
        done.replaceChildren(...doneTodos.map((t) => this.todoItem(t)));
        // Size multi-line titles once they're in the document.
        for (const el of this.root.querySelectorAll('.task-title')) autoGrow(el);
    }

    todoItem(todo) {
        const li = document.createElement('li');
        li.className = 'task';
        li.dataset.id = todo.id;
        li.classList.toggle('done', todo.done);

        const check = document.createElement('button');
        check.type = 'button';
        check.className = 'check';
        check.setAttribute('role', 'checkbox');
        check.setAttribute('aria-checked', String(todo.done));
        check.title = t(todo.done ? 'markNotCompleted' : 'markCompleted');
        check.append(icon('check', 1.3));
        check.addEventListener('click', () => this.updateTodo(todo.id, { done: !todo.done }));

        const title = document.createElement('textarea');
        title.rows = 1;
        title.className = 'task-title';
        title.value = todo.title;
        title.dir = 'auto';
        title.setAttribute('aria-label', t('taskTitleLabel'));
        if (!todo.done) title.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
        title.addEventListener('input', () => autoGrow(title));
        title.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !todo.done) {
                e.preventDefault();
                this.moveBy(li, e.key === 'ArrowUp' ? -1 : 1);
                title.focus();
                return;
            }
            if (isSubmitKey(e)) {
                e.preventDefault();
                title.blur();
            }
            if (e.key === 'Escape') {
                title.value = todo.title;
                title.blur();
            }
        });
        title.addEventListener('change', () => {
            const value = title.value.trim();
            if (!value) this.deleteTodo(todo.id);
            else if (value !== todo.title) this.updateTodo(todo.id, { title: value });
        });

        const del = iconButton('trash', 'delete', t('deleteTask'), () => this.deleteTodo(todo.id));
        const star = iconButton('star', 'star', t(todo.important ? 'removeImportance' : 'markImportant'), () =>
            this.updateTodo(todo.id, { important: !todo.important })
        );
        star.classList.toggle('on', !!todo.important);
        star.setAttribute('aria-pressed', String(!!todo.important));

        li.append(check, title, del);
        if (!todo.done) li.prepend(this.grip(li));
        if (authState.signedIn) {
            const synced = isSyncedRecord(this.rec) && todo.remoteId && todo.updatedAt <= (this.rec.lastSyncAt ?? 0);
            li.append(syncBadge(synced ? 'synced' : 'pending', todo.remoteId));
        }
        li.append(star);
        return li;
    }

    // ---- Reordering (open tasks only) ----

    // Drag handle. The row is draggable only while the handle is held, so text
    // in the title can still be selected.
    grip(li) {
        const grip = document.createElement('span');
        grip.className = 'grip';
        grip.title = t('reorderTask');
        grip.setAttribute('aria-hidden', 'true');
        grip.append(icon('grip'));
        grip.addEventListener('pointerdown', () => (li.draggable = true));
        grip.addEventListener('pointerup', () => (li.draggable = false));
        li.addEventListener('dragstart', (e) => {
            this.dragging = li;
            li.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', li.dataset.id);
        });
        li.addEventListener('dragend', () => {
            li.draggable = false;
            li.classList.remove('dragging');
            this.dragging = null;
            this.commitOrder();
            if (this.todosStale && !this.el.open.contains(document.activeElement)) this.renderTodos();
        });
        return grip;
    }

    wireReorder() {
        const list = this.el.open;
        list.addEventListener('dragover', (e) => {
            if (!this.dragging) return;
            e.preventDefault();
            const over = e.target.closest?.('.task');
            if (!over || over === this.dragging || over.parentElement !== list) return;
            const { top, height } = over.getBoundingClientRect();
            list.insertBefore(this.dragging, e.clientY < top + height / 2 ? over : over.nextSibling);
        });
        list.addEventListener('drop', (e) => e.preventDefault());
    }

    moveBy(li, delta) {
        const sibling = delta < 0 ? li.previousElementSibling : li.nextElementSibling;
        if (!sibling) return;
        li.parentElement.insertBefore(li, delta < 0 ? sibling : sibling.nextSibling);
        this.commitOrder();
    }

    commitOrder() {
        const ids = [...this.el.open.children].map((el) => el.dataset.id);
        const current = this.rec.todos.filter((t) => !t.deleted && !t.done).map((t) => t.id);
        if (ids.join() === current.join()) return;
        send({ type: 'reorderTodos', key: this.rec.key, ids }).catch(reportError);
    }

    async flushNotes() {
        if (this.notesTimer === null) return;
        clearTimeout(this.notesTimer);
        this.notesTimer = null;
        if (this.rec) await send({ type: 'updateNotes', key: this.rec.key, notes: this.el.notes.value }).catch(reportError);
    }

    updateTodo(id, patch) {
        send({ type: 'updateTodo', key: this.rec.key, id, patch }).catch(reportError);
    }

    deleteTodo(id) {
        send({ type: 'deleteTodo', key: this.rec.key, id }).catch(reportError);
    }
}

// ---- Sync badges ------------------------------------------------------------

// Collapsed task lists, by record key, remembered across sessions.
const COLLAPSED_KEY = 'tasksCollapsed';
const collapsedKeys = new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'));
const isTasksCollapsed = (key) => collapsedKeys.has(key);
function setTasksCollapsed(key, collapsed) {
    if (collapsed) collapsedKeys.add(key);
    else collapsedKeys.delete(key);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedKeys]));
}

/*
    Asks before a destructive action. Resolves true only when the user picks Delete.
*/
function confirmDialog(title, detail = '') {
    const dialog = $('confirm');
    $('confirm-title').textContent = title;
    $('confirm-detail').textContent = detail;
    $('confirm-detail').hidden = !detail;
    dialog.returnValue = '';
    dialog.showModal();
    $('confirm-cancel').focus();
    return new Promise((resolve) => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    });
}

const TODOIST_TASK_URL = 'https://app.todoist.com/app/task/';

const isSyncedRecord = (rec) => rec?.remote?.provider === 'todoist' && !!rec.remote.taskId;

/*
    A small cloud showing whether an item is in Todoist. 'synced' links to the
    Todoist task; 'pending' means the change hasn't been uploaded yet.
*/
function syncBadge(state, taskId) {
    const label = t(state === 'synced' ? 'syncedToTodoist' : 'pendingSync');
    const el = document.createElement(state === 'synced' ? 'a' : 'span');
    el.className = `sync-badge ${state}`;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.append(icon(state === 'synced' ? 'cloudSynced' : 'cloudPending'));
    if (state === 'synced') {
        el.href = TODOIST_TASK_URL + encodeURIComponent(taskId);
        el.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: el.href });
        });
    } else {
        el.setAttribute('role', 'img');
    }
    return el;
}

let groupPane;
let tabPane;
const panes = () => [groupPane, tabPane];
const flushAll = () => Promise.all(panes().map((p) => p.flushNotes()));

// ---- Active tab and group tracking ----------------------------------------

async function refreshActive() {
    const seq = ++showSeq;
    await flushAll();
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    const group = tab && tab.groupId !== NO_GROUP ? await chrome.tabGroups.get(tab.groupId).catch(() => null) : null;
    const [groupRec, tabRec] = await Promise.all([
        group ? send({ type: 'resolveGroup', groupId: group.id }) : null,
        tab ? send({ type: 'resolveTab', tabId: tab.id }) : null,
    ]);
    if (seq !== showSeq) return;

    activeTab = tab ?? null;
    activeGroup = group;
    $('empty').hidden = !!tabRec;
    $('content').hidden = !tabRec;
    document.body.dataset.color = group?.color ?? '';
    groupPane.root.dataset.color = group?.color ?? '';
    groupPane.setRecord(groupRec, true);
    tabPane.setRecord(tabRec, true);
    document.title = group ? group.title || t('untitledGroup') : tabTitle(tab);

    for (const rec of [groupRec, tabRec]) {
        if (rec) send({ type: 'syncNow', key: rec.key }).catch(console.error);
    }
}

function faviconFor(tab) {
    const url = tab?.favIconUrl;
    if (!url || !/^(https?|data):/i.test(url)) return icon('page');
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    img.addEventListener('error', () => img.replaceWith(icon('page')));
    return img;
}

function tabTitle(tab) {
    return tab?.title || tab?.url || t('newTab');
}

function hostOf(url) {
    try {
        const u = new URL(url);
        return u.protocol.startsWith('http') ? u.hostname : u.protocol === 'file:' ? t('localFile') : '';
    } catch {
        return '';
    }
}

async function renderHeading(pane) {
    if (!pane.rec) return;
    if (pane === groupPane) {
        if (!activeGroup) return;
        const tabs = await chrome.tabs.query({ groupId: activeGroup.id }).catch(() => []);
        pane.setHeading({
            icon: icon('list'),
            title: activeGroup.title || t('untitledGroup'),
            details: [tp('tabCount', tabs.length)],
        });
    } else {
        const host = hostOf(activeTab?.url);
        pane.setHeading({ icon: faviconFor(activeTab), title: tabTitle(activeTab), details: host ? [host] : [] });
    }
}
// ---- Sync and account -----------------------------------------------------

function renderStatus(status) {
    if (status) lastStatus = status;
    const el = $('sync-status');
    el.classList.toggle('error', status?.state === 'error');
    $('sync-now').classList.toggle('spinning', status?.state === 'syncing');
    if (!status) return;
    if (status.state === 'syncing') el.textContent = t('syncing');
    else if (status.state === 'error') el.textContent = t('syncFailed', status.message);
    else el.textContent = t('syncedAt', new Date(status.at).toLocaleTimeString(uiLanguage(), { hour: 'numeric', minute: '2-digit' }));
    el.title = el.textContent;
    if ($('setup').open) renderManage();
    renderSyncButtons();
}

/*
    Sync now is only useful when something is waiting to upload, or to retry
    after a failure. Changes made in Todoist are pulled in automatically.
*/
let syncButtonsSeq = 0;
async function renderSyncButtons() {
    const seq = ++syncButtonsSeq;
    const all = await chrome.storage.local.get(null);
    if (seq !== syncButtonsSeq) return;
    const pending = Object.entries(all).some(([k, rec]) => k.startsWith('rec:') && isDirty(rec));
    const syncing = lastStatus?.state === 'syncing';
    const enabled = !syncing && (pending || lastStatus?.state === 'error');
    for (const id of ['sync-now', 'manage-sync']) {
        const button = $(id);
        if (button.classList.contains('busy')) continue;
        button.disabled = !enabled;
        button.title = enabled ? t('syncNow') : syncing ? t('syncing') : t('nothingToSync');
    }
}

function initials(account) {
    const source = account?.name || account?.username || '';
    const words = source.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

let authState = { signedIn: false, needsSignIn: false, account: null };

async function renderAuth() {
    authState = await send({ type: 'authState' });
    const { signedIn, needsSignIn, account } = authState;
    const avatar = $('avatar');
    const text = signedIn ? initials(account) : '';
    avatar.replaceChildren(text || icon('person'));
    avatar.classList.toggle('initials', !!text);

    $('setup-btn').hidden = signedIn;
    $('setup-btn').textContent = t(needsSignIn ? 'signIn' : 'setUpSync');
    $('sync-now').hidden = !signedIn;
    $('settings-btn').hidden = false;

    if (signedIn) {
        $('account-name').textContent = account?.name || account?.username || t('todoBrand');
        $('account-name').title = account?.username ?? '';
        if (lastStatus) renderStatus(lastStatus);
        else $('sync-status').textContent = t('connected');
    } else {
        $('account-name').textContent = t('todoBrand');
        $('sync-status').textContent = t(needsSignIn ? 'signInExpired' : 'syncPitch');
        $('sync-status').classList.remove('error');
    }
    if ($('setup').open) renderManage();
    // Sync badges depend on being signed in.
    for (const pane of [groupPane, tabPane]) if (pane?.rec) pane.render(false);
}

// ---- Setup window ---------------------------------------------------------

function friendlyError(message = '') {
    if (/did not approve|cancel|closed|access_denied/i.test(message)) return t('errCanceled');
    if (/could not be loaded|invalid_client|redirect/i.test(message)) return t('errAuthPage');
    return message || t('errGeneric');
}

function showStep(step) {
    for (const section of $('setup').querySelectorAll('[data-step]')) section.hidden = section.dataset.step !== step;
    $('setup-later').hidden = step === 'done' || step === 'manage';
    $('setup-error').hidden = true;
    if (step === 'manage') {
        $('manage-status').classList.remove('success');
        renderManage();
    }
}

async function openSetup(step) {
    await renderAuth();
    showStep(step ?? (authState.signedIn ? 'manage' : 'connect'));
    if (!$('setup').open) {
        $('setup').showModal();
        $('setup').focus();
    }
}

function setupError(e) {
    $('setup-error').textContent = friendlyError(e?.message);
    $('setup-error').hidden = false;
}

async function withBusy(button, fn) {
    button.classList.add('busy');
    $('setup-error').hidden = true;
    try {
        await fn();
    } catch (e) {
        setupError(e);
    } finally {
        button.classList.remove('busy');
    }
}

async function signInFromSetup() {
    const account = await send({ type: 'signIn' });
    await renderAuth();
    $('done-account').textContent = t('signedInAs', account?.username || account?.name || t('yourAccount'));
    showStep('done');
}

function renderManage() {
    const { account, signedIn } = authState;
    $('manage-account').hidden = !signedIn;
    $('manage-signed-out').hidden = signedIn;
    $('manage-avatar').textContent = initials(account) || '?';
    $('manage-name').textContent = account?.name || t('todoistAccount');
    $('manage-email').textContent = account?.username ?? '';
    const status = $('manage-status');
    const keepSuccess = status.classList.contains('success') && lastStatus?.state === 'ok';
    if (!keepSuccess) {
        status.classList.remove('success');
        status.textContent = $('sync-status').textContent;
        status.classList.toggle('error', lastStatus?.state === 'error');
    }
    send({ type: 'getCloseAction' }).then((action) => {
        for (const radio of document.querySelectorAll('input[name="close-action"]')) radio.checked = radio.value === action;
    }, console.error);
}

// Drops Todoist's **bold** markers from a task name shown inside our own bold text.
const plain = (s) => s.replace(/\*\*/g, '');

function wireSetup() {
    const manifest = chrome.runtime.getManifest();
    $('about').textContent = t('aboutLine', manifest.name, manifest.version, manifest.author);
    setRichText(
        $('done-body'),
        t('doneBody', t('todoistProject'), plain(t('todoistTaskGroup', t('groupNamePlaceholder'))), plain(t('todoistTaskTab', t('pageTitlePlaceholder'))))
    );

    $('setup-btn').addEventListener('click', () => {
        // An expired sign-in only needs the Todoist prompt, not the whole window.
        if (authState.needsSignIn) {
            send({ type: 'signIn' }).then(renderAuth, () => openSetup('connect'));
        } else {
            openSetup();
        }
    });
    $('settings-btn').addEventListener('click', () => openSetup('manage'));

    const close = () => $('setup').close();
    $('setup-close').addEventListener('click', close);
    $('setup-later').addEventListener('click', close);
    $('done-close').addEventListener('click', close);
    $('setup').addEventListener('click', (e) => {
        if (e.target === $('setup')) close(); // backdrop click
    });

    $('connect-sign-in').addEventListener('click', (e) => withBusy(e.currentTarget, signInFromSetup));

    $('manage-sync').addEventListener('click', async (e) => {
        await flushAll();
        const button = e.currentTarget;
        const status = $('manage-status');
        status.classList.remove('success');
        button.classList.add('busy');
        try {
            await send({ type: 'syncNow' });
            status.textContent = t('syncDone');
            status.classList.remove('error');
            status.classList.add('success');
        } catch {
            // The failure is already shown next to the button via the sync status.
        } finally {
            button.classList.remove('busy');
            renderSyncButtons();
        }
    });
    $('manage-sign-out').addEventListener('click', () =>
        send({ type: 'signOut' })
            .then(renderAuth)
            .then(close, setupError)
    );
    $('manage-set-up').addEventListener('click', () => showStep('connect'));
    for (const radio of document.querySelectorAll('input[name="close-action"]')) {
        radio.addEventListener('change', () => send({ type: 'setCloseAction', action: radio.value }).catch(setupError));
    }
}

// ---- Closed tabs ------------------------------------------------------------

let closedShown = [];

async function renderClosed(closed) {
    closed ??= (await chrome.storage.session.get('closedTabs')).closedTabs ?? [];
    closedShown = closed;
    $('closed-banner').hidden = closed.length === 0;
    if (!closed.length) return;
    $('closed-text').textContent =
        closed.length === 1 ? t('closedOne', closed[0].title || t('newTab')) : tp('closedMany', closed.length);
    $('closed-detail').textContent = closed.some((c) => c.synced) ? t('confirmAlsoTodoist') : '';
    $('closed-detail').hidden = !$('closed-detail').textContent;
}

function wireClosed() {
    const resolve = (action) =>
        send({
            type: 'resolveClosed',
            keys: closedShown.map((c) => c.key),
            action,
            remember: $('closed-remember').checked,
        })
            .then(() => ($('closed-remember').checked = false))
            .catch(reportError);
    $('closed-keep').addEventListener('click', () => resolve('keep'));
    $('closed-delete').addEventListener('click', () => resolve('delete'));
}

// Offer setup once, the first time the pane opens.
async function maybePromptSetup() {
    if (authState.signedIn || authState.needsSignIn) return;
    const { setupPrompted } = await chrome.storage.local.get('setupPrompted');
    if (setupPrompted) return;
    await chrome.storage.local.set({ setupPrompted: true });
    openSetup();
}
// ---- Wiring ---------------------------------------------------------------

async function init() {
    localizeDocument();
    fillIcons();
    windowId = (await chrome.windows.getCurrent()).id;
    wireSetup();
    wireClosed();

    groupPane = new Pane($('group-pane'), 'group');
    tabPane = new Pane($('tab-pane'), 'tab');
    $('confirm-ok').addEventListener('click', () => $('confirm').close('ok'));
    $('confirm-cancel').addEventListener('click', () => $('confirm').close());

    $('sync-now').addEventListener('click', async () => {
        await flushAll();
        send({ type: 'syncNow' }).catch(reportError);
    });

    chrome.tabs.onActivated.addListener((info) => {
        if (info.windowId === windowId) refreshActive().catch(reportError);
    });
    chrome.tabs.onUpdated.addListener((_id, change, tab) => {
        if (tab.windowId !== windowId) return;
        if ('groupId' in change) {
            if (tab.active) refreshActive().catch(reportError);
            else groupPane.renderHeader();
        } else if (tab.active && activeTab?.id === tab.id && ('title' in change || 'favIconUrl' in change || 'url' in change)) {
            activeTab = tab;
            tabPane.renderHeader();
        }
    });
    chrome.tabs.onRemoved.addListener(() => groupPane.renderHeader());
    chrome.tabGroups.onUpdated.addListener((group) => {
        // Reload rather than patch: the update can land while refreshActive is
        // still resolving a just-created group.
        if (group.windowId === windowId) refreshActive().catch(reportError);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (Object.keys(changes).some((k) => k.startsWith('rec:'))) renderSyncButtons().catch(console.error);
            for (const pane of panes()) {
                const change = pane.rec && changes[`rec:${pane.rec.key}`];
                if (change?.newValue) pane.setRecord(change.newValue, false);
            }
            if (changes.todoistAuth) renderAuth().catch(console.error);
        } else if (area === 'session') {
            if (changes.syncStatus) renderStatus(changes.syncStatus.newValue);
            if (changes.closedTabs) renderClosed(changes.closedTabs.newValue ?? []).catch(console.error);
            // The tab or group was rebound to an older record (e.g. a new tab
            // navigated to a page that already had notes).
            const bindings = changes.bindings?.newValue;
            if (!bindings) return;
            const stale =
                (activeGroup && groupPane.rec && bindings[`g:${activeGroup.id}`] && bindings[`g:${activeGroup.id}`] !== groupPane.rec.key) ||
                (activeTab && tabPane.rec && bindings[`t:${activeTab.id}`] && bindings[`t:${activeTab.id}`] !== tabPane.rec.key);
            if (stale) refreshActive().catch(reportError);
        }
    });

    window.addEventListener('pagehide', () => flushAll());

    lastStatus = (await chrome.storage.session.get('syncStatus')).syncStatus ?? null;
    await renderAuth();
    await refreshActive();
    await renderSyncButtons();
    await renderClosed();
    await maybePromptSetup();
}

init().catch(reportError);
