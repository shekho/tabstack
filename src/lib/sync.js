// Two-way sync of one tab or tab-group record with Todoist. No browser
// dependencies, so it can be unit tested in Node.
//
// Layout in Todoist: all records live in one project (Todoist's free plan
// allows only a few projects). Each tab group is a top-level task in it, and
// each tab is a task under its group's task (or top-level when it isn't in a
// group). A task's content is the record's name and its description holds the
// notes. Each todo is a subtask of its record's task; the star maps to priority.
// So a group's task has two kinds of subtasks: its own todos and its tabs'
// tasks, told apart by tabTaskIds.
//
// Provider interface (see todoist.js):
//   getProject(id) -> project | null       listProjects() -> [project]
//   createProject(name) -> project
//   getTask(id) -> task | null (null when missing or deleted; completed tasks are returned)
//   listTasks({projectId, parentId}) -> active (not completed) tasks
//   createTask(body) -> task               updateTask(id, patch) -> task
//   moveTask(id, {parent_id} | {project_id})
//   closeTask(id)  reopenTask(id)  deleteTask(id)
// where task = {id, content, description, checked, priority (1-4), parent_id, child_order, updated_at}.
//
// Options: parentTaskId (the group's task for a tab in a group, else null),
// force (create the task even with no content, for a group holding tabs), and
// tabTaskIds (IDs of all tab tasks, excluded from a group's todos).
//
// Conflict rule: a field changed locally since the last sync wins; otherwise a
// remote change (updated_at differs from what we last saw) is pulled.
//
// names (see todoNames.js / fixedNames):
//   untitled               title used when the record has none
//   taskName(title)        content for a new or renamed record task, in the UI language
//   taskNames(title)       every content an existing record task may have (all languages, current and earlier)
//   legacyTaskNames(title) earlier formats the extension used; a task with one of them is renamed
//   projectName            name for a new project
//   projectNames           every name an existing project may have (all languages, current and earlier)
//   legacyProjectNames     earlier names the extension used; a project with one of them is renamed

const PROVIDER = 'todoist';
const MAX_TITLE_CHARS = 80;
const PRIORITY_NORMAL = 1;
const PRIORITY_IMPORTANT = 4;

export function shortTitle(title) {
    const trimmed = title.trim();
    if (trimmed.length <= MAX_TITLE_CHARS) return trimmed;
    return `${trimmed.slice(0, MAX_TITLE_CHARS - 3).trimEnd()}...`;
}

// Fallback names for tests. Real callers pass localized names from todoNames.js.
export function fixedNames(
    prefix,
    projectName = 'TabStack',
    untitled = 'Untitled',
    legacyProjectNames = ['Tab Group Notes'],
    legacyPrefixes = []
) {
    return {
        untitled,
        taskName: (title) => prefix + title,
        taskNames: (title) => [prefix + title, ...legacyPrefixes.map((p) => p + title)],
        legacyTaskNames: (title) => legacyPrefixes.map((p) => p + title),
        projectName,
        projectNames: [projectName, ...legacyProjectNames],
        legacyProjectNames,
    };
}

export function isDirty(rec) {
    const since = rec.lastSyncAt ?? 0;
    return (
        !!rec.remote?.deleteTaskId ||
        (rec.notesUpdatedAt ?? 0) > since ||
        (rec.orderUpdatedAt ?? 0) > since ||
        rec.todos.some((t) => t.updatedAt > since)
    );
}

/*
    Returns the ID of the extension's project: the known one if it still exists,
    otherwise one found by name (current or earlier names, in any language),
    otherwise a new one. A project still under an earlier name the extension
    used is renamed; a name the user chose is left alone.
*/
export async function ensureProject(provider, names, knownId) {
    let project = knownId ? await provider.getProject(knownId) : null;
    if (!project) {
        const candidates = new Set(names.projectNames);
        project = (await provider.listProjects()).find((p) => candidates.has(p.name) && !p.is_archived);
    }
    if (!project) return (await provider.createProject(names.projectName)).id;
    if (project.name !== names.projectName && (names.legacyProjectNames ?? []).includes(project.name)) {
        await provider.renameProject(project.id, names.projectName);
    }
    return project.id;
}

const fromRemote = (task) => ({
    title: task.content,
    done: !!task.checked,
    important: (task.priority ?? PRIORITY_NORMAL) > PRIORITY_NORMAL,
});

// Fields to send so the remote task matches the todo, or null if it already does.
// Keeps a user's p2/p3 priority as long as the todo stays starred.
function patchFor(todo, task) {
    const patch = {};
    if (todo.title !== task.content) patch.content = todo.title;
    if (!!todo.important !== fromRemote(task).important) {
        patch.priority = todo.important ? PRIORITY_IMPORTANT : PRIORITY_NORMAL;
    }
    return Object.keys(patch).length ? patch : null;
}

function forgetRemote(rec) {
    rec.remote = { provider: PROVIDER };
    for (const todo of rec.todos) {
        delete todo.remoteId;
        delete todo.remoteModified;
    }
}

export async function syncRecord(
    input,
    provider,
    { now = Date.now(), names, projectId, parentTaskId = null, force = false, tabTaskIds = new Set() }
) {
    const rec = structuredClone(input);
    // Records synced to another service start fresh here.
    if (rec.remote?.provider !== PROVIDER) forgetRemote(rec);
    // The whole tab or group was deleted here: delete its task (and subtasks) in
    // Todoist. A group task that still holds tab tasks is kept as their
    // container, with only the group's own notes and subtasks removed.
    if (rec.remote.deleteTaskId) {
        const id = rec.remote.deleteTaskId;
        delete rec.remote.deleteTaskId;
        const children = tabTaskIds.size ? await provider.listTasks({ parentId: id }) : [];
        if (children.some((t) => tabTaskIds.has(t.id))) {
            for (const t of children) if (!tabTaskIds.has(t.id)) await provider.deleteTask(t.id);
            if (await provider.getTask(id)) {
                await provider.updateTask(id, { description: '' });
                rec.remote.taskId = id;
            }
        } else {
            await provider.deleteTask(id);
        }
    }
    const since = rec.lastSyncAt ?? 0;
    const title = shortTitle(rec.title || names.untitled);
    const notesChanged = (rec.notesUpdatedAt ?? 0) > since;

    let parent = rec.remote.taskId ? await provider.getTask(rec.remote.taskId) : null;
    // Deleted in Todoist; recreate it from local data.
    if (rec.remote.taskId && !parent) forgetRemote(rec);

    let created = false;
    if (!parent) {
        const candidates = new Set(names.taskNames(title));
        const matches = (await provider.listTasks({ projectId })).filter(
            (t) => candidates.has(t.content) && !tabTaskIds.has(t.id)
        );
        parent = matches.find((t) => (t.parent_id ?? null) === parentTaskId) ?? matches[0];
        if (!parent) {
            // Don't create a task for every tab or group the user merely visits.
            // A group is forced when one of its tabs needs a container.
            const hasContent = rec.notes || rec.todos.some((t) => !t.deleted);
            if (!hasContent && !force) return rec;
            parent = await provider.createTask({
                content: names.taskName(title),
                description: rec.notes,
                project_id: projectId,
                ...(parentTaskId ? { parent_id: parentTaskId } : {}),
            });
            created = true;
        }
        rec.remote.taskId = parent.id;
        rec.remote.title = title;
    }

    // Keep the task under its tab group's task, or at the top of the project.
    if ((parent.parent_id ?? null) !== parentTaskId) {
        await provider.moveTask(parent.id, parentTaskId ? { parent_id: parentTaskId } : { project_id: projectId });
        parent = (await provider.getTask(parent.id)) ?? { ...parent, parent_id: parentTaskId };
    }

    // Rename only when the title changes, not when the UI language does. A task
    // still named the way an earlier version named it is updated to the
    // current format; a name the user chose is left alone.
    const legacy = names.legacyTaskNames?.(title) ?? [];
    if (rec.remote.title !== title || (parent.content !== names.taskName(title) && legacy.includes(parent.content))) {
        parent = await provider.updateTask(parent.id, { content: names.taskName(title) });
        rec.remote.title = title;
    }

    if (!created) {
        if (notesChanged) {
            if ((parent.description ?? '') !== rec.notes) {
                parent = await provider.updateTask(parent.id, { description: rec.notes });
            }
        } else if (parent.updated_at !== rec.remote.notesModified) {
            rec.notes = parent.description ?? '';
        }
    }
    rec.remote.notesModified = parent.updated_at;

    // A group's subtasks include its tabs' tasks; those aren't the group's todos.
    const listed = (await provider.listTasks({ parentId: parent.id })).filter((t) => !tabTaskIds.has(t.id));
    const remoteOrder = new Map(listed.map((t) => [t.id, t.child_order]));
    const active = new Map(listed.map((t) => [t.id, t]));
    const todos = [];
    for (const todo of rec.todos) {
        const changed = todo.updatedAt > since;
        const remote = todo.remoteId ? active.get(todo.remoteId) : undefined;
        active.delete(todo.remoteId);

        if (todo.deleted) {
            if (todo.remoteId) await provider.deleteTask(todo.remoteId);
            continue;
        }

        if (remote) {
            // Open in Todoist.
            if (changed) {
                const patch = patchFor(todo, remote);
                const latest = patch ? await provider.updateTask(remote.id, patch) : remote;
                if (todo.done) await provider.closeTask(remote.id);
                todos.push({ ...todo, remoteModified: latest.updated_at });
            } else if (remote.updated_at !== todo.remoteModified) {
                todos.push({ ...todo, ...fromRemote(remote), remoteModified: remote.updated_at });
            } else {
                todos.push(todo);
            }
            continue;
        }

        if (todo.remoteId) {
            // Not open in Todoist: completed or deleted there. A todo already
            // completed here is assumed to still be completed there.
            if (todo.done && !changed) {
                todos.push(todo);
                continue;
            }
            const task = await provider.getTask(todo.remoteId);
            if (task) {
                if (!changed) {
                    todos.push({ ...todo, ...fromRemote(task), remoteModified: task.updated_at });
                    continue;
                }
                const patch = patchFor(todo, task);
                const latest = patch ? await provider.updateTask(task.id, patch) : task;
                if (!todo.done) await provider.reopenTask(task.id);
                todos.push({ ...todo, remoteModified: latest.updated_at });
                continue;
            }
            // Deleted in Todoist. That wins unless the todo was edited here since.
            if (!changed) continue;
        }

        const task = await provider.createTask({
            content: todo.title,
            project_id: projectId,
            parent_id: parent.id,
            priority: todo.important ? PRIORITY_IMPORTANT : PRIORITY_NORMAL,
        });
        if (todo.done) await provider.closeTask(task.id);
        todos.push({ ...todo, remoteId: task.id, remoteModified: task.updated_at });
    }

    // Open subtasks added in Todoist.
    for (const task of active.values()) {
        todos.push({ id: crypto.randomUUID(), ...fromRemote(task), updatedAt: 0, remoteId: task.id, remoteModified: task.updated_at });
    }

    // Completing the record's task in Todoist completes its subtasks, which are
    // pulled in above. Reopen it when there's open work again.
    if (parent.checked && todos.some((t) => !t.done)) await provider.reopenTask(parent.id);

    rec.todos = await syncOrder(todos, provider, remoteOrder, (rec.orderUpdatedAt ?? 0) > since);
    rec.lastSyncAt = now;
    return rec;
}

/*
    Order of the open todos. Reordered here since the last sync: push positions
    to Todoist as child_order 1..n. Otherwise: follow Todoist's order, with todos
    not yet there kept at the end. Completed todos keep their slots.
*/
async function syncOrder(todos, provider, remoteOrder, changedHere) {
    const open = todos.filter((t) => !t.done && t.remoteId);
    if (changedHere) {
        for (const [i, todo] of open.entries()) {
            if (remoteOrder.get(todo.remoteId) === i + 1) continue;
            const task = await provider.updateTask(todo.remoteId, { child_order: i + 1 });
            todo.remoteModified = task.updated_at;
        }
        return todos;
    }
    const isOpen = (t) => !t.done;
    const rank = (t) => (t.remoteId && remoteOrder.has(t.remoteId) ? remoteOrder.get(t.remoteId) : Infinity);
    const sorted = todos.filter(isOpen).sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra === rb ? 0 : ra < rb ? -1 : 1;
    });
    let i = 0;
    return todos.map((t) => (isOpen(t) ? sorted[i++] : t));
}
