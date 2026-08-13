# Extractable components

There are no shared layout components or reusable primitives in separate files, so no DraftComponent extraction is required for this design round.

## WorkItemCard candidate

- Source: apps/panel/src/main.tsx
- Category: basic
- Description: repeated work-item button with kind, identifier, title, status, and capture origin.
- Candidate props: identifier, title, kind, status, selected, captureOrigin.

## Detail candidate

- Source: apps/panel/src/main.tsx
- Category: basic
- Description: selected-item editor and source-reference inspector.
- Candidate props: item, items, sources, and action callbacks.

These remain page-local until production code extracts them.
