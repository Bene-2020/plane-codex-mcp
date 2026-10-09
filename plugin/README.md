# Ambient Project Layer (Codex Plugin)

Ambient Project Layer is a Codex plugin that quietly captures meaningful project events from your work sessions and syncs them to [Plane](https://plane.so/) as tasks, bugs, decisions, and risks.

- Work-session events are written to a local SQLite outbox first, then synchronized asynchronously to Plane, so nothing is lost when the network or Plane is unavailable.
- A lightweight in-Codex panel shows recent work items and lets you change their status; full project management stays in Plane.
- Platform-specific packages bundle Node 22.22.1, so no local Node installation is required.

## Links

- Source repository, documentation, and releases: <https://github.com/Bene-2020/plane-codex-mcp>
- Issues: <https://github.com/Bene-2020/plane-codex-mcp/issues>
- Security policy: see `SECURITY.md`

## License

MIT — see `LICENSE`.
