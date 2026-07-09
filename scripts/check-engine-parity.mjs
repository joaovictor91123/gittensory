#!/usr/bin/env node
// Mechanical drift tripwire for hand-duplicated src/ <-> gittensory-engine file pairs (#4260). Most src/{review,
// settings,signals} modules are thin re-export shims over the engine, but ~15 twin files are still maintained in
// parallel — this script discovers those pairs, normalizes known-harmless import-path aliases, and fails CI when
// the normalized bodies diverge. Also compares the workspace-installed @jsonbored/gittensory-engine semver against
// the monorepo engine package's declared version (version-skew tripwire; no live-gate round-trip).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_PARITY_AREAS = Object.freeze(["review", "settings", "signals"]);
const ENGINE_SRC_ROOT = "packages/gittensory-engine/src";
const HOST_SRC_ROOT = "src";
const ENGINE_PACKAGE_JSON = "packages/gittensory-engine/package.json";
const ENGINE_PACKAGE_NAME = "@jsonbored/gittensory-engine";

function defaultReadFile(root, relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function defaultListDir(root, relativePath) {
  try {
    return readdirSync(join(root, relativePath));
  } catch {
    return [];
  }
}

/** Map equivalent relative import paths so import-only drift between host and engine copies does not false-fail. */
export function normalizeImportSpec(spec) {
  let normalized = spec;
  if (normalized.endsWith(".js")) normalized = normalized.slice(0, -3);
  if (/^\.\.\/types\/[\w-]+$/.test(normalized)) normalized = "../types";
  if (normalized === "../focus-manifest/guidance") normalized = "../signals/focus-manifest";
  return normalized;
}

/** Normalize line endings and canonicalize relative `from` specifiers before byte comparison. */
export function normalizeEngineParityText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line.replace(/from\s+['"](\.\.\/[^'"]+)['"]/g, (_match, spec) => `from "${normalizeImportSpec(spec)}"`),
    )
    .join("\n");
}

/** True when the host copy is only a thin re-export of the engine module (not a hand-duplicated twin). */
export function isThinEngineReExportShim(srcText) {
  const stripped = srcText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter(Boolean)
    .join("\n");
  return /^export\s+(\{[\s\S]*\}|\*)\s+from\s+['"][^'"]*gittensory-engine[^'"]*['"];?\s*$/.test(stripped);
}

/** True when the engine twin is a placeholder stub (e.g. check-names) rather than a full parallel copy. */
export function isEngineStubPair(srcText, engineText) {
  const compact = (text) => text.replace(/\s/g, "").length;
  const engineCompact = compact(engineText);
  const srcCompact = compact(srcText);
  return engineCompact > 0 && srcCompact > engineCompact * 3 && engineCompact < 250;
}

/**
 * Discover in-scope hand-duplicated twins under src/{review,settings,signals} that also exist in the engine tree
 * and are neither host shims nor engine stubs.
 */
export function discoverEngineParityPairs({ root, listDir = defaultListDir, readFile = defaultReadFile }) {
  const pairs = [];
  for (const area of ENGINE_PARITY_AREAS) {
    const hostDir = join(HOST_SRC_ROOT, area);
    const engineDir = join(ENGINE_SRC_ROOT, area);
    const hostFiles = listDir(root, hostDir).filter((name) => name.endsWith(".ts"));
    const engineFiles = new Set(listDir(root, engineDir).filter((name) => name.endsWith(".ts")));
    for (const fileName of hostFiles.sort()) {
      if (!engineFiles.has(fileName)) continue;
      const hostRelative = join(hostDir, fileName);
      const engineRelative = join(engineDir, fileName);
      const hostText = readFile(root, hostRelative);
      const engineText = readFile(root, engineRelative);
      if (isThinEngineReExportShim(hostText)) continue;
      if (isEngineStubPair(hostText, engineText)) continue;
      pairs.push({ area, fileName, hostRelative, engineRelative });
    }
  }
  return pairs;
}

/**
 * Compare normalized bodies of every discovered pair. Returns `{ failures, pairsChecked }` — pure given injectable IO.
 */
export function checkEngineParityDrift({ root, readFile = defaultReadFile, listDir = defaultListDir }) {
  const pairs = discoverEngineParityPairs({ root, readFile, listDir });
  const failures = [];
  for (const pair of pairs) {
    const hostText = readFile(root, pair.hostRelative);
    const engineText = readFile(root, pair.engineRelative);
    const normalizedHost = normalizeEngineParityText(hostText);
    const normalizedEngine = normalizeEngineParityText(engineText);
    if (normalizedHost !== normalizedEngine) {
      failures.push(
        [
          `${pair.hostRelative} and ${pair.engineRelative} have drifted apart (normalized comparison).`,
          `Edit both copies together or convert the host file to a thin engine re-export shim.`,
        ].join("\n"),
      );
    }
  }
  return { failures, pairsChecked: pairs };
}

/** Parse `major.minor.patch` prefix; non-numeric prerelease segments compare as equal at the patch level. */
export function parseSemverCore(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two semver strings. Returns `-1` (installed behind expected), `0` (equal), or `1` (installed ahead).
 * Unparseable versions are treated as behind so the skew check fails loudly.
 */
export function compareSemver(installed, expected) {
  const installedCore = parseSemverCore(installed);
  const expectedCore = parseSemverCore(expected);
  if (!installedCore || !expectedCore) return -1;
  for (let index = 0; index < 3; index += 1) {
    if (installedCore[index] < expectedCore[index]) return -1;
    if (installedCore[index] > expectedCore[index]) return 1;
  }
  return 0;
}

/** Human-readable skew label for doctor output and test assertions. */
export function describeEngineVersionSkew(installed, expected) {
  const comparison = compareSemver(installed, expected);
  if (comparison < 0) return "behind";
  if (comparison > 0) return "ahead";
  return "equal";
}

export function defaultResolveInstalledEngineVersion(root) {
  try {
    const engineEntry = join(root, "node_modules", ENGINE_PACKAGE_NAME, "package.json");
    if (!existsSync(engineEntry)) return null;
    return JSON.parse(readFileSync(engineEntry, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

export function defaultReadExpectedEngineVersion(root, readFile = defaultReadFile) {
  try {
    const text = readFile(root, ENGINE_PACKAGE_JSON);
    return JSON.parse(text).version ?? null;
  } catch {
    return null;
  }
}

/**
 * Version-skew tripwire: installed @jsonbored/gittensory-engine must be >= the monorepo engine package version.
 * Returns `{ failures, installed, expected, skew }`.
 */
export function checkEngineVersionSkew({
  root,
  readFile = defaultReadFile,
  resolveInstalled = defaultResolveInstalledEngineVersion,
  readExpected = (r) => defaultReadExpectedEngineVersion(r, readFile),
}) {
  const failures = [];
  const installed = resolveInstalled(root);
  const expected = readExpected(root);
  const skew = installed && expected ? describeEngineVersionSkew(installed, expected) : "unknown";

  if (!expected) {
    failures.push(`Could not read expected engine version from ${ENGINE_PACKAGE_JSON}.`);
  } else if (!installed) {
    failures.push(`${ENGINE_PACKAGE_NAME} is not installed under node_modules (cannot verify version skew).`);
  } else if (compareSemver(installed, expected) < 0) {
    failures.push(
      `${ENGINE_PACKAGE_NAME} version skew: installed ${installed} is behind expected minimum ${expected}.`,
    );
  }

  return { failures, installed, expected, skew };
}

/** Run both the file-pair drift check and the version-skew check. */
export function runEngineParityChecks(options) {
  const drift = checkEngineParityDrift(options);
  const skew = checkEngineVersionSkew(options);
  return {
    failures: [...drift.failures, ...skew.failures],
    pairsChecked: drift.pairsChecked,
    versionSkew: skew,
  };
}

/** @internal Exported for subprocess-free unit tests of the CLI success/failure paths. */
export function runEngineParityMain(root = process.cwd()) {
  const { failures, pairsChecked, versionSkew } = runEngineParityChecks({ root });

  if (failures.length > 0) {
    console.error(`Engine-parity check found ${failures.length} issue(s):`);
    for (const failure of failures) console.error(failure);
    return 1;
  }

  console.log(
    `Engine-parity check ok: ${pairsChecked.length} hand-duplicated file pair(s) agree; ` +
      `${ENGINE_PACKAGE_NAME} ${versionSkew.installed} is ${versionSkew.skew} vs expected ${versionSkew.expected}.`,
  );
  return 0;
}

function main() {
  process.exit(runEngineParityMain(process.cwd()));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
