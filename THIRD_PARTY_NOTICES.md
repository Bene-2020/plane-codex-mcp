# Third-Party Notices

Ambient Project Layer incorporates third-party software. Those components remain subject to their own licenses; the project MIT license does not replace them.

The main runtime components bundled into the application are:

| Component | Version | License | Project |
| --- | --- | --- | --- |
| Node.js | 22.22.1 | MIT and additional third-party terms | <https://nodejs.org/> |
| Plane Node SDK | 0.2.12 | MIT | <https://github.com/makeplane/plane-node-sdk> |
| Model Context Protocol TypeScript SDK | 1.30.0 | MIT | <https://github.com/modelcontextprotocol/typescript-sdk> |
| MCP Apps | 1.7.5 | MIT | <https://github.com/modelcontextprotocol/ext-apps> |
| Fastify | 5.11.3 | MIT | <https://fastify.dev/> |
| @fastify/cors | 10.1.0 | MIT | <https://github.com/fastify/fastify-cors> |
| React and React DOM | 19.2.8 | MIT | <https://react.dev/> |
| Zod | 3.25.76 | MIT | <https://zod.dev/> |

Each platform-specific release package contains:

- the Ambient Project Layer `LICENSE` file;
- this notice file;
- the exact `LICENSE.nodejs` shipped with the bundled Node.js distribution; and
- upstream LICENSE, NOTICE, or COPYING files distributed with copied runtime npm packages.

The complete dependency graph and resolved versions for a source checkout are recorded in `pnpm-lock.yaml`. Copyright notices in third-party source and license files remain the property of their respective owners.
