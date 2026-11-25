// Minimal Todoist REST API v1 client for the calls sync.js needs.

const BASE = 'https://api.todoist.com/api/v1';
const MAX_RETRIES = 3;
const PAGE_SIZE = 200;

export class TodoistError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/*
    getToken({force}) returns a bearer token; force asks for a new one after a 401.
*/
export function createTodoist(getToken, fetchImpl = globalThis.fetch.bind(globalThis)) {
    async function call(method, path, body, attempt = 0, forceToken = false) {
        const token = await getToken({ force: forceToken });
        const headers = { Authorization: `Bearer ${token}` };
        if (body) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });

        if (res.status === 401 && attempt === 0) return call(method, path, body, attempt + 1, true);
        const retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
        if (retryable && attempt < MAX_RETRIES) {
            const retryAfterSec = Number(res.headers.get('Retry-After')) || 2 ** attempt;
            await sleep(Math.min(retryAfterSec, 30) * 1000);
            return call(method, path, body, attempt + 1);
        }
        if (!res.ok) {
            let message = `${res.status} ${res.statusText}`;
            try {
                const json = await res.json();
                message = json.error ?? json.error_tag ?? message;
            } catch {
                // Non-JSON error body.
            }
            throw new TodoistError(res.status, message);
        }
        if (res.status === 204) return null;
        const text = await res.text();
        return text ? JSON.parse(text) : null;
    }

    async function all(path, params = {}) {
        const out = [];
        let cursor = null;
        do {
            const query = new URLSearchParams({ ...params, limit: String(PAGE_SIZE) });
            if (cursor) query.set('cursor', cursor);
            const page = await call('GET', `${path}?${query}`);
            out.push(...page.results);
            cursor = page.next_cursor;
        } while (cursor);
        return out;
    }

    // Returns null instead of throwing when the item doesn't exist.
    async function getOrNull(path) {
        try {
            return await call('GET', path);
        } catch (e) {
            if (e.status === 404) return null;
            throw e;
        }
    }

    const task = (id) => `/tasks/${encodeURIComponent(id)}`;

    return {
        getUser: () => call('GET', '/user'),
        getProject: async (id) => {
            const project = await getOrNull(`/projects/${encodeURIComponent(id)}`);
            return project && !project.is_deleted && !project.is_archived ? project : null;
        },
        listProjects: () => all('/projects'),
        createProject: (name) => call('POST', '/projects', { name }),
        renameProject: (id, name) => call('POST', `/projects/${encodeURIComponent(id)}`, { name }),
        getTask: async (id) => {
            const t = await getOrNull(task(id));
            return t && !t.is_deleted ? t : null;
        },
        listTasks: ({ projectId, parentId }) =>
            all('/tasks', { ...(projectId ? { project_id: projectId } : {}), ...(parentId ? { parent_id: parentId } : {}) }),
        createTask: (body) => call('POST', '/tasks', body),
        updateTask: (id, patch) => call('POST', task(id), patch),
        closeTask: (id) => call('POST', `${task(id)}/close`),
        reopenTask: (id) => call('POST', `${task(id)}/reopen`),
        moveTask: (id, target) => call('POST', `${task(id)}/move`, target),
        async deleteTask(id) {
            try {
                await call('DELETE', task(id));
            } catch (e) {
                if (e.status !== 404) throw e;
            }
        },
    };
}
