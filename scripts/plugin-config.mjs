export const PLUGIN_ENV_VARS = ["AMBIENT_DB_PATH", "PLANE_MODE", "PLANE_BASE_URL", "PLANE_API_KEY", "PLANE_WORKSPACE_SLUG"];

export function targetMcpConfig(target) {
  return {
    mcpServers: {
      "ambient-project": {
        command: target.launcherRelativePath,
        args: ["runtime/mcp/index.js"],
        cwd: ".",
        env_vars: PLUGIN_ENV_VARS,
      },
    },
  };
}

export function targetHooksConfig(sourceHooks, target) {
  const command = `"${"${PLUGIN_ROOT}"}/${target.launcherRelativePath}" "${"${PLUGIN_ROOT}"}/runtime/hook-adapter/index.js"`;
  return {
    hooks: Object.fromEntries(Object.entries(sourceHooks.hooks).map(([eventName, groups]) => [
      eventName,
      groups.map((group) => ({
        ...group,
        hooks: group.hooks.map((hook) => ({ ...hook, command })),
      })),
    ])),
  };
}
