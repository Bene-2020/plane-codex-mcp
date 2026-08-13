# Shared layouts

The panel has no separate shared layout component. The page-level App component in apps/panel/src/main.tsx owns the complete shell.

Actual rendered structure:

    <main className="shell">
      <header className="topbar">...</header>
      <section className="layout">
        <aside className="sidebar">...</aside>
        <section className="list-pane">...</section>
        <aside className="detail-pane">...</aside>
      </section>
    </main>

Use the full apps/panel/src/main.tsx file as layout context. The active-project return branch is the production design target.
