const checks = [
  "DIFF_CHECK",
  "INSTALL",
  "BUILD_PACKAGES",
  "BUILD_APPS",
  "VALIDATOR_DEPENDENCY",
  "PACKAGE",
  "MANIFEST",
  "RUNTIME",
  "BUNDLED_NODE",
  "SMOKE",
];
const failed = checks.filter((name) => process.env[`CHECK_${name}`] !== "success");
if (failed.length) throw new Error(`Platform validation failed: ${failed.join(", ")}`);
process.stdout.write("All platform validation checks passed.\n");
