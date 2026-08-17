import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@ambient/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@ambient/storage": fileURLToPath(new URL("./packages/storage/src/index.ts", import.meta.url)),
      "@ambient/plane": fileURLToPath(new URL("./packages/plane/src/index.ts", import.meta.url)),
      "@ambient/service": fileURLToPath(new URL("./apps/service/src/index.ts", import.meta.url)),
      "@ambient/mcp/dist/index.js": fileURLToPath(new URL("./apps/mcp/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    passWithNoTests: false,
  },
});
