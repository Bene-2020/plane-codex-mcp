# Security Policy

## Supported Versions

Security fixes are applied to the latest release of this plugin. Older releases are not maintained in parallel; please confirm the issue reproduces on the latest release before reporting.

## Reporting a Vulnerability

Please do not open a public issue for security vulnerabilities.

- Report privately through GitHub Security Advisories: <https://github.com/Bene-2020/plane-codex-mcp/security/advisories/new>
- Include the plugin version, platform package, and steps to reproduce.

You can expect an acknowledgement within a few days. Once a fix is released, the advisory is credited and published.

## Scope Notes

This plugin runs locally, stores captured work events in a local SQLite outbox, and syncs them to the Plane instance you configure. Plane credentials are read from your local configuration and are never transmitted anywhere except the configured Plane API.
