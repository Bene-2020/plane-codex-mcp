# Pages

## / — Ambient Project Panel

Entry: apps/panel/src/main.tsx

Dependencies:

- apps/panel/src/main.tsx
  - apps/panel/src/styles.css
  - apps/panel/src/session.ts
    - packages/core/src/index.ts through @ambient/core
  - @modelcontextprotocol/ext-apps (external host bridge; omit from visual context)
  - react and react-dom (external framework dependencies)

Primary composition:

- App: top bar, project filters, record list, recent progress, selected-item editor.
- Detail: title, description, type, status, due date, source references, merge, archive, delete.
- FailureList: synchronization failures and retry.
- StandaloneConnect: development-only connection form.

The current production branch is desktop-only because body enforces min-width: 1040px and .layout renders a three-column master/detail workspace.
