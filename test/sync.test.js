import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncRecord, ensureProject, fixedNames } from '../src/lib/sync.js';

const NAMES = fixedNames('Tab group: ');
const PROJECT = 'P1';

// In-memory Todoist. Completed tasks stay retrievable by ID but aren't listed,
// like the real API.
function fakeTodoist() {
    const tasks = new Map();
    const projects = new Map([[PROJECT, { id: PROJECT, name: 'Tab Group Notes' }]]);
    let seq = 0;
    const stamp = () => `2026-01-01T00:00:${String(++seq).padStart(2, '0')}Z`;
    const touch = (t) => Object.assign(t, { updated_at: stamp() });
    const clone = (t) => structuredClone(t);

    const p = {
        tasks,
        projects,
        calls: [],
        async getProject(id) {
            return projects.get(id) ?? null;
        },
        async listProjects() {
            return [...projects.values()];
        },
        async createProject(name) {
            const project = { id: `P${++seq}`, name };
            projects.set(project.id, project);
            return project;
        },
        async renameProject(id, name) {
            projects.get(id).name = name;
        },
        async getTask(id) {
            return tasks.has(id) ? clone(tasks.get(id)) : null;
        },
        async listTasks({ projectId, parentId }) {
            return [...tasks.values()]
                .filter((t) => !t.checked)
                .filter((t) => (projectId ? t.project_id === projectId : true) && (parentId ? t.parent_id === parentId : true))
                .map(clone);
        },
        async createTask(body) {
            p.calls.push('create');
            const siblings = [...tasks.values()].filter((t) => (t.parent_id ?? null) === (body.parent_id ?? null));
            const task = touch({ id: `T${++seq}`, description: '', priority: 1, checked: false, parent_id: null, child_order: siblings.length + 1, ...body });
            tasks.set(task.id, task);
            return clone(task);
        },
        async updateTask(id, patch) {
            p.calls.push('update');
            return clone(touch(Object.assign(tasks.get(id), patch)));
        },
        async closeTask(id) {
            p.calls.push('close');
            touch(tasks.get(id)).checked = true;
            // Closing a task closes its subtasks.
            for (const t of tasks.values()) if (t.parent_id === id) touch(t).checked = true;
        },
        async reopenTask(id) {
            p.calls.push('reopen');
            touch(tasks.get(id)).checked = false;
        },
        async moveTask(id, { parent_id: parentId, project_id: projectId }) {
            p.calls.push('move');
            const t = touch(tasks.get(id));
            t.parent_id = parentId ?? null;
            if (projectId) t.project_id = projectId;
        },
        async deleteTask(id) {
            p.calls.push('delete');
            tasks.delete(id);
            for (const t of [...tasks.values()]) if (t.parent_id === id) tasks.delete(t.id);
        },
        // Simulates edits made in Todoist.
        remoteEdit(id, patch) {
            touch(Object.assign(tasks.get(id), patch));
        },
        remoteAdd(body) {
            const task = touch({ id: `T${++seq}`, description: '', priority: 1, checked: false, parent_id: null, project_id: PROJECT, ...body });
            tasks.set(task.id, task);
            return task;
        },
        subtasks(parentId) {
            return [...tasks.values()].filter((t) => t.parent_id === parentId);
        },
    };
    return p;
}

function record(overrides = {}) {
    return { key: 'k', title: 'Project X', notes: '', notesUpdatedAt: 0, todos: [], lastSyncAt: 0, remote: {}, ...overrides };
}

const todo = (title, extra = {}) => ({ id: title, title, done: false, updatedAt: 1, ...extra });
const sync = (rec, p, now, names = NAMES) => syncRecord(rec, p, { now, names, projectId: PROJECT });

test('first sync creates the record task with notes and a subtask per todo', async () => {
    const p = fakeTodoist();
    const rec = await sync(record({ notes: 'hello', notesUpdatedAt: 1, todos: [todo('a', { important: true }), todo('b', { done: true })] }), p, 10);

    const parent = p.tasks.get(rec.remote.taskId);
    assert.equal(parent.content, 'Tab group: Project X');
    assert.equal(parent.description, 'hello');
    assert.equal(parent.project_id, PROJECT);
    const subs = p.subtasks(parent.id);
    assert.deepEqual(subs.map((t) => [t.content, t.priority, t.checked]), [['a', 4, false], ['b', 1, true]]);
    assert.equal(rec.lastSyncAt, 10);
});

test('an empty record does not create a task', async () => {
    const p = fakeTodoist();
    const rec = await sync(record(), p, 10);
    assert.equal(p.tasks.size, 0);
    assert.equal(rec.remote.taskId, undefined);
});

test('an existing record task with the same name is adopted and pulled', async () => {
    const p = fakeTodoist();
    const parent = p.remoteAdd({ content: 'Tab group: Project X', description: 'from Todoist' });
    p.remoteAdd({ content: 'remote task', parent_id: parent.id, priority: 3 });

    const rec = await sync(record(), p, 10);
    assert.equal(rec.remote.taskId, parent.id);
    assert.equal(rec.notes, 'from Todoist');
    assert.deepEqual(rec.todos.map((t) => [t.title, t.done, t.important]), [['remote task', false, true]]);
});

test('remote edits are pulled and local edits are pushed', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ notes: 'n1', notesUpdatedAt: 1, todos: [todo('a'), todo('b')] }), p, 10);

    p.remoteEdit(rec.todos[0].remoteId, { content: 'a (edited in Todoist)' });
    p.remoteEdit(rec.remote.taskId, { description: 'n2' });
    rec.todos[1] = { ...rec.todos[1], important: true, updatedAt: 11 };

    rec = await sync(rec, p, 20);
    assert.equal(rec.todos[0].title, 'a (edited in Todoist)');
    assert.equal(rec.notes, 'n2');
    assert.equal(p.tasks.get(rec.todos[1].remoteId).priority, 4);

    // Nothing changed on either side: no writes.
    p.calls.length = 0;
    rec = await sync(rec, p, 30);
    assert.deepEqual(p.calls, []);
});

test('completing syncs both ways, including tasks completed in Todoist', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ todos: [todo('a'), todo('b')] }), p, 10);
    const [a, b] = rec.todos;

    await p.closeTask(a.remoteId); // completed in Todoist
    rec.todos[1] = { ...b, done: true, updatedAt: 11 }; // completed here

    rec = await sync(rec, p, 20);
    assert.deepEqual(rec.todos.map((t) => t.done), [true, true]);
    assert.equal(p.tasks.get(b.remoteId).checked, true);

    // Reopened here: reopened in Todoist.
    rec.todos[0] = { ...rec.todos[0], done: false, updatedAt: 21 };
    rec = await sync(rec, p, 30);
    assert.equal(p.tasks.get(a.remoteId).checked, false);
    assert.equal(rec.todos[0].done, false);
});

test('local changes win when both sides changed', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ notes: 'base', notesUpdatedAt: 1 }), p, 10);
    p.remoteEdit(rec.remote.taskId, { description: 'remote' });
    rec = await sync({ ...rec, notes: 'local', notesUpdatedAt: 11 }, p, 20);
    assert.equal(rec.notes, 'local');
    assert.equal(p.tasks.get(rec.remote.taskId).description, 'local');
});

test('deletes propagate in both directions', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ todos: [todo('a'), todo('b')] }), p, 10);
    const [a, b] = rec.todos;

    await p.deleteTask(a.remoteId); // deleted in Todoist
    rec.todos[1] = { ...b, deleted: true, updatedAt: 11 }; // deleted here

    rec = await sync(rec, p, 20);
    assert.deepEqual(rec.todos, []);
    assert.equal(p.subtasks(rec.remote.taskId).length, 0);
});

test('a todo edited here after a delete in Todoist is recreated', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ todos: [todo('a')] }), p, 10);
    await p.deleteTask(rec.todos[0].remoteId);
    rec.todos[0] = { ...rec.todos[0], title: 'a2', updatedAt: 11 };

    rec = await sync(rec, p, 20);
    assert.equal(p.tasks.get(rec.todos[0].remoteId).content, 'a2');
});

test('renaming renames the task, and a deleted record task is recreated', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ notes: 'n', notesUpdatedAt: 1, todos: [todo('a')] }), p, 10);
    rec = await sync({ ...rec, title: 'Renamed' }, p, 20);
    assert.equal(p.tasks.get(rec.remote.taskId).content, 'Tab group: Renamed');

    await p.deleteTask(rec.remote.taskId);
    rec = await sync(rec, p, 30);
    const parent = p.tasks.get(rec.remote.taskId);
    assert.equal(parent.content, 'Tab group: Renamed');
    assert.equal(parent.description, 'n');
    assert.deepEqual(p.subtasks(parent.id).map((t) => t.content), ['a']);
});

test('completing the record task in Todoist completes its todos; new work reopens it', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ todos: [todo('a')] }), p, 10);
    await p.closeTask(rec.remote.taskId);

    rec = await sync(rec, p, 20);
    assert.equal(rec.todos[0].done, true);
    assert.equal(p.tasks.get(rec.remote.taskId).checked, true);

    rec.todos.push(todo('b', { updatedAt: 21 }));
    rec = await sync(rec, p, 30);
    assert.equal(p.tasks.get(rec.remote.taskId).checked, false);
});

test('tasks named in another language are adopted, and long titles are shortened', async () => {
    const p = fakeTodoist();
    const parent = p.remoteAdd({ content: 'Groupe d\'onglets : Project X', description: 'bonjour' });
    const names = { ...NAMES, taskNames: (title) => [`Tab group: ${title}`, `Groupe d'onglets : ${title}`] };

    let rec = await sync(record(), p, 10, names);
    assert.equal(rec.remote.taskId, parent.id);
    assert.equal(rec.notes, 'bonjour');
    rec = await sync(rec, p, 20, names);
    assert.equal(p.tasks.get(parent.id).content, "Groupe d'onglets : Project X");

    const long = await sync(record({ key: 'k2', title: 'A very long page title '.repeat(6), notes: 'n', notesUpdatedAt: 1 }), p, 30);
    const content = p.tasks.get(long.remote.taskId).content;
    assert.ok(content.endsWith('...'));
    assert.equal(content.length, 'Tab group: '.length + 80);
});

test('records synced to another service start fresh', async () => {
    const p = fakeTodoist();
    const old = record({ notes: 'n', todos: [todo('a', { remoteId: 'graph-id', updatedAt: 0 })], lastSyncAt: 5, remote: { listId: 'L1' } });
    const rec = await sync(old, p, 10);
    assert.equal(rec.remote.provider, 'todoist');
    assert.equal(p.tasks.get(rec.remote.taskId).description, 'n');
    assert.equal(p.tasks.get(rec.todos[0].remoteId).content, 'a');
});

test('deleting a whole record deletes its Todoist task and subtasks', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ notes: 'n', notesUpdatedAt: 1, todos: [todo('a'), todo('b')] }), p, 10);
    const taskId = rec.remote.taskId;

    // What the clearRecord op leaves behind.
    rec = { ...rec, notes: '', notesUpdatedAt: 0, todos: [], lastSyncAt: 0, remote: { provider: 'todoist', deleteTaskId: taskId } };
    rec = await sync(rec, p, 20);
    assert.equal(p.tasks.size, 0);
    assert.equal(rec.remote.deleteTaskId, undefined);
    assert.equal(rec.remote.taskId, undefined);

    // Stays empty and doesn't recreate anything.
    rec = await sync(rec, p, 30);
    assert.equal(p.tasks.size, 0);
});

test('a tab in a group nests under the group task, even an empty group', async () => {
    const p = fakeTodoist();
    const TAB = fixedNames('Tab: ');
    // What the background does: sync the group with force, then the tab under it.
    let group = await sync(record({ key: 'g', title: 'Trip' }), p, 10);
    assert.equal(group.remote.taskId, undefined);
    group = await syncRecord(group, p, { now: 10, names: NAMES, projectId: PROJECT, force: true });
    let tab = await syncRecord(record({ key: 't', title: 'Hotels', notes: 'n', notesUpdatedAt: 1, todos: [todo('book')] }), p, {
        now: 10, names: TAB, projectId: PROJECT, parentTaskId: group.remote.taskId,
    });
    const tabTask = p.tasks.get(tab.remote.taskId);
    assert.equal(tabTask.parent_id, group.remote.taskId);
    assert.equal(p.subtasks(tabTask.id)[0].content, 'book');

    // The group's own todos don't include its tabs' tasks.
    group = await syncRecord({ ...group, todos: [todo('pack', { updatedAt: 11 })] }, p, {
        now: 20, names: NAMES, projectId: PROJECT, tabTaskIds: new Set([tab.remote.taskId]),
    });
    assert.deepEqual(group.todos.map((t) => t.title), ['pack']);
    assert.deepEqual(p.subtasks(group.remote.taskId).map((t) => t.content).sort(), ['Tab: Hotels', 'pack']);

    // Taken out of the group: moved to the top of the project.
    tab = await syncRecord(tab, p, { now: 30, names: TAB, projectId: PROJECT, parentTaskId: null });
    assert.equal(p.tasks.get(tab.remote.taskId).parent_id, null);
    // And back in.
    tab = await syncRecord(tab, p, { now: 40, names: TAB, projectId: PROJECT, parentTaskId: group.remote.taskId });
    assert.equal(p.tasks.get(tab.remote.taskId).parent_id, group.remote.taskId);
});

test('deleting a group keeps its tabs: the group task stays as their container', async () => {
    const p = fakeTodoist();
    const TAB = fixedNames('Tab: ');
    let group = await sync(record({ key: 'g', title: 'Trip', notes: 'group notes', notesUpdatedAt: 1, todos: [todo('pack')] }), p, 10);
    const tab = await syncRecord(record({ key: 't', title: 'Hotels', notes: 'n', notesUpdatedAt: 1 }), p, {
        now: 10, names: TAB, projectId: PROJECT, parentTaskId: group.remote.taskId,
    });
    const tabTaskIds = new Set([tab.remote.taskId]);
    const groupTaskId = group.remote.taskId;

    group = { ...group, notes: '', notesUpdatedAt: 0, todos: [], lastSyncAt: 0, remote: { provider: 'todoist', deleteTaskId: groupTaskId } };
    group = await syncRecord(group, p, { now: 20, names: NAMES, projectId: PROJECT, tabTaskIds });

    assert.equal(group.remote.taskId, groupTaskId);
    assert.equal(group.notes, '');
    assert.deepEqual(group.todos, []);
    assert.equal(p.tasks.get(groupTaskId).description, '');
    assert.deepEqual(p.subtasks(groupTaskId).map((t) => t.content), ['Tab: Hotels']);
    assert.equal(p.tasks.get(tab.remote.taskId).description, 'n');
});

test('reordering here pushes child_order; reordering in Todoist is pulled', async () => {
    const p = fakeTodoist();
    let rec = await sync(record({ todos: [todo('a'), todo('b'), todo('c')] }), p, 10);
    const order = () => p.subtasks(rec.remote.taskId).sort((x, y) => x.child_order - y.child_order).map((t) => t.content);
    assert.deepEqual(order(), ['a', 'b', 'c']);

    // Reordered here: c, a, b.
    rec = { ...rec, todos: [rec.todos[2], rec.todos[0], rec.todos[1]], orderUpdatedAt: 11 };
    rec = await sync(rec, p, 20);
    assert.deepEqual(order(), ['c', 'a', 'b']);

    // No change on either side: no writes, order kept.
    p.calls.length = 0;
    rec = await sync(rec, p, 30);
    assert.deepEqual(p.calls, []);
    assert.deepEqual(rec.todos.map((t) => t.title), ['c', 'a', 'b']);

    // Reordered in Todoist: b first.
    const byTitle = (s) => rec.todos.find((t) => t.title === s).remoteId;
    p.remoteEdit(byTitle('b'), { child_order: 0 });
    rec = await sync(rec, p, 40);
    assert.deepEqual(rec.todos.map((t) => t.title), ['b', 'c', 'a']);
});

test('tasks with an earlier name format are renamed; names the user chose are kept', async () => {
    const p = fakeTodoist();
    const names = fixedNames('**[Group]** ', 'TabStack', 'Untitled', [], ['Tab group: ']);
    const old = p.remoteAdd({ content: 'Tab group: Project X', description: 'n' });

    let rec = await sync(record(), p, 10, names);
    assert.equal(rec.remote.taskId, old.id);
    assert.equal(p.tasks.get(old.id).content, '**[Group]** Project X');

    p.remoteEdit(old.id, { content: 'My own name' });
    rec = await sync(rec, p, 20, names);
    assert.equal(p.tasks.get(old.id).content, 'My own name');
});

test('ensureProject keeps, finds, or creates the project', async () => {
    const p = fakeTodoist();
    p.projects.get(PROJECT).name = 'TabStack';
    assert.equal(await ensureProject(p, NAMES, PROJECT), PROJECT);
    assert.equal(await ensureProject(p, NAMES, 'gone'), PROJECT);
    p.projects.clear();
    const id = await ensureProject(p, NAMES, PROJECT);
    assert.equal(p.projects.get(id).name, 'TabStack');
});

test('ensureProject renames a project with an earlier name, but not one the user renamed', async () => {
    const p = fakeTodoist();
    assert.equal(await ensureProject(p, NAMES, PROJECT), PROJECT);
    assert.equal(p.projects.get(PROJECT).name, 'TabStack');

    p.projects.get(PROJECT).name = 'My browser stuff';
    await ensureProject(p, NAMES, PROJECT);
    assert.equal(p.projects.get(PROJECT).name, 'My browser stuff');

    // Found by its earlier name when the ID is unknown.
    p.projects.get(PROJECT).name = 'Tab Group Notes';
    assert.equal(await ensureProject(p, NAMES, null), PROJECT);
    assert.equal(p.projects.get(PROJECT).name, 'TabStack');
});
