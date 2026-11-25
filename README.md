# TabStack

An Edge (Chromium) extension that adds a side pane with **notes and a todo list for every tab and every tab group**. The pane follows the active tab. For a tab that's in a group, the group's notes and tasks are shown first, in the group's color, with the tab's own notes and tasks below. Everything syncs two-way with **Todoist**.

## How it maps to Todoist

| Extension | Todoist |
|-----------|---------|
| All notes | One project named `TabStack` |
| Tab group | A task in that project named **`[Group]`** `<group title>`, with the notes in its description |
| Tab | A task named **`[Tab]`** `<page title>`, with the notes in its description. It's a subtask of its group's task, or at the top of the project when the tab isn't in a group. |
| Names | `[Group]` and `[Tab]` are bold in Todoist (Markdown `**[Group]**`). Tasks named in the earlier `Tab group:` / `Tab:` format are renamed on their next sync. |
| Todo | A subtask of that task (title, completed state, order, and the star as priority 1) |

- Everything goes in one project because Todoist's free plan allows only a few projects.
- A task is created only once a tab or group has notes or todos. A group's task is also created when one of its tabs needs a parent.
- Moving a tab into, out of, or between groups moves its task in Todoist. A closed tab's task stays where it was.
- Deleting a group in the pane deletes the group's own notes and tasks; its tabs' tasks stay, with the group's task kept as their container.
- Renaming a group renames its task. A tab's task keeps the page title it had when its first note or task was added; later navigation doesn't rename it.
- The trash button next to a tab's or group's title deletes all its notes and tasks, and its task in Todoist. The trash button in the Notes heading clears just the notes. Both ask first. When a tab with notes or tasks closes, the pane asks whether to delete them (here and in Todoist), with **Remember my choice**. Settings (the gear) has the same choice: ask, keep, or delete. Closing a whole window or a tab group keeps everything, and if the pane isn't open the question waits until it is.
- If you delete the task in Todoist, the next sync recreates it from local data. Completing it in Todoist completes its subtasks; adding a new todo here reopens it.
- A change made in the extension since the last sync wins over a change made in Todoist. Otherwise, changes made in Todoist are pulled in.
- A todo already completed here and later deleted in Todoist stays here as completed; delete it here too.
- Sync runs about 2 seconds after an edit, when you switch tabs, every 5 minutes, and when you click **Sync**.
## Install (unpacked)

1. Open `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, and select this folder.
2. Click the toolbar button (or press Alt+Shift+N) to open the side pane.

Notes work locally without signing in. The first time you open the pane, a setup window offers to connect Todoist; you can reopen it later from **Set up sync** in the footer. Signing in needs only a Todoist account (free or paid).

## How Todoist sign-in works

- There's no app to register and no client ID or secret to configure. The first time someone signs in, the extension registers itself with Todoist as a public client through [Dynamic Client Registration](https://developer.todoist.com/api/v1/authorization.md), using its own redirect URI (`https://<extension-id>.chromiumapp.org/`). Each install gets its own registration.
- Sign-in uses the OAuth authorization code flow with PKCE through `chrome.identity.launchWebAuthFlow`. It requests `data:read_write` and `data:delete` (to delete subtasks when todos are deleted here).
- Access tokens last an hour and are refreshed automatically. Refresh tokens rotate on every refresh.
- Once you're signed in, the gear in the footer shows the account and offers **Sync now** and **Sign out**. Signing out removes the tokens from this browser; to revoke the extension's access entirely, remove it under **Settings > Integrations** in Todoist.
## How tabs and tab groups are identified

The browser assigns new tab and group IDs every session, so the extension stores notes under its own key and reattaches them:

- **Groups by title.** After a restart, or when you reopen a closed group, a group with the same title gets its notes back. A new, untitled group starts empty; once you give it the title of an older group, it picks up that group's notes. Untitled groups can't be matched after a restart, so give groups names.
- **Tabs by address.** A tab's notes stay with the tab as it navigates. After a restart, or when you open a page whose tab was closed, a tab at the same address (the tab's last URL) gets the notes back. Only `http`, `https`, and `file` pages are matched this way, so new tabs and browser pages always start empty.
- A tab's notes and its group's notes are separate. Adding a tab to a group, or removing it, doesn't move either.
- Tabs and groups that never got a note or task aren't kept once they close.

## Development

```
npm test        # unit tests for the sync logic and translations (Node 20+)
```

### Localization

- The extension follows the browser's language (**Settings > Languages** in Edge; a browser restart is needed after changing it). It ships in Arabic, Chinese (Simplified and Traditional), English, French, German, Italian, Japanese, Korean, Portuguese (Brazil), and Spanish. In any other browser language it falls back to English, and dates, numbers, plurals, and layout direction follow the language of the text actually shown, so nothing is half-translated. The translations other than English are machine-made and need review by fluent speakers before release.
- All text lives in [_locales/en/messages.json](_locales/en/messages.json), and each entry has a description for translators. To add a language, copy that file to `_locales/<lang>/messages.json`, set `localeCode` to the folder name, translate the `message` values, and add the language to `SUPPORTED_LOCALES` in [src/config.js](src/config.js). `npm test` checks that every language has every message, with the same `$1` placeholders and `**bold**` markers.
- Plurals use `<key>_one`, `<key>_other`, and so on (the categories from `Intl.PluralRules`), for example `tabCount_one` and `tabCount_other`. `$1` is the number.
- `**text**` in a message is shown in bold.
- The Todoist project and task names are created in the user's language. Existing ones are found by ID, or by their name in any language listed in `SUPPORTED_LOCALES`, so changing the browser language doesn't duplicate them. A task is renamed only when its tab group's or tab's title changes.
- Notes and task titles use `dir="auto"`, and the layout mirrors for right-to-left languages.
- To check layout without translations, open the side pane's DevTools console, run `localStorage.setItem('i18n.pseudo', 'on')` (accented text about 40% longer) or `'rtl'` (right-to-left), and reload the pane. `localStorage.removeItem('i18n.pseudo')` turns it off. To try a real language, start Edge with `--lang=<code>`.

| File | Purpose |
|------|---------|
| [src/background.js](src/background.js) | Service worker: binds tabs and groups to records, serializes edits, schedules sync |
| [src/sidepanel/](src/sidepanel/) | Side pane UI; tracks the active tab's group in its own window |
| [src/lib/sync.js](src/lib/sync.js) | Two-way merge of one tab or group with Todoist |
| [src/lib/todoist.js](src/lib/todoist.js) | Todoist REST API v1 client (paging, 401/429 retry) |
| [src/lib/auth.js](src/lib/auth.js) | Todoist sign-in: dynamic client registration, auth code + PKCE, token refresh |
| [src/lib/i18n.js](src/lib/i18n.js) | Message lookup, plurals, right-to-left, and pseudo-localization |
| [src/lib/todoNames.js](src/lib/todoNames.js) | Localized Todoist project and task names |
| [src/lib/store.js](src/lib/store.js) | `chrome.storage` records and group bindings |

### Testing

`npm test` covers the merge logic against an in-memory Todoist. The sign-in itself needs a real Todoist account and hasn't been covered by automated tests.

## Known limitations

- Sync is last-writer-wins per field, with no merge of concurrent text edits to the notes.
- Only direct subtasks of a tab's or group's task are synced; deeper subtasks, due dates, and labels added in Todoist are left alone.
- Tokens are stored in `chrome.storage.local` for this browser profile.
- Switching from the earlier Microsoft To Do version starts sync fresh: existing notes and todos are uploaded to Todoist, and the To Do lists are left as they are.