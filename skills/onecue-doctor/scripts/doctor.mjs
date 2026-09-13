#!/usr/bin/env node
/**
 * onecue-doctor — standalone diagnostic.
 *
 * Zero dependencies. Checks both OneCue installs:
 *   - the skill store:    <project>/.onecue/memories/  (Markdown, agent-written)
 *   - the CLI store:      ~/.onecue/projects/<fp>/     (JSONL, `onecue` binary)
 *   - the hooks:          <project>/.claude/settings.local.json
 *
 * Usage: node doctor.mjs [--json] [--report]
 * Exit code is 1 when any check warns, so scripts and CI can rely on it.
 */
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const HOOK_EVENTS = [
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
  "SessionEnd",
];
const ROOT_MARKERS = [".git", "package.json", ".claude"];
const ONECUE_MARKER = /onecue/i;
const HOOK_MARKER = /\bhook\b/;
const HOOK_TARGET = /node\s+"([^"]+)"\s+hook/;
const GIT_ORIGIN_URL = /\[remote "origin"\][^[]*?url\s*=\s*(.+)/;

const safeReal = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

const resolveProjectRoot = (start) => {
  const origin = safeReal(start);
  let dir = origin;
  for (;;) {
    for (const marker of ROOT_MARKERS) {
      if (existsSync(join(dir, marker))) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return origin;
    }
    dir = parent;
  }
};

const gitRemote = (root) => {
  const configPath = join(root, ".git", "config");
  try {
    const match = readFileSync(configPath, "utf8").match(GIT_ORIGIN_URL);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
};

const repoFingerprint = (start) => {
  const root = resolveProjectRoot(start);
  const remote = gitRemote(root);
  const slug =
    basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "project";
  const hash = createHash("sha256")
    .update(remote ?? root)
    .digest("hex")
    .slice(0, 12);
  return { id: `${slug}-${hash}`, root, slug };
};

const isOneCueCommand = (command) =>
  ONECUE_MARKER.test(command) && HOOK_MARKER.test(command);

const writableProbe = (target) => {
  let probe = target;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) {
      return false;
    }
    probe = parent;
  }
  try {
    accessSync(probe, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const readJsonSafe = (file) => {
  if (!existsSync(file)) {
    return { status: "absent" };
  }
  try {
    return { status: "ok", value: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { status: "corrupt" };
  }
};

const collect = () => {
  const checks = [];
  const check = (label, ok, detail) => checks.push({ detail, label, ok });

  const fp = repoFingerprint(process.cwd());
  const major = Number(process.versions.node.split(".")[0]);
  check("Node >= 20", major >= 20, `found ${process.versions.node}`);

  // Skill store: Markdown memories the agent writes itself.
  const skillDir = join(fp.root, ".onecue");
  const skillMemories = join(skillDir, "memories");
  const skillInstalled = existsSync(skillMemories);
  check(
    "skill store present",
    skillInstalled,
    skillInstalled ? skillMemories : `no ${skillMemories}`
  );

  // CLI store: ~/.onecue/projects/<fingerprint>/config.json
  const cliDir = join(
    process.env.ONECUE_HOME ?? join(homedir(), ".onecue"),
    "projects",
    fp.id
  );
  const cliConfig = join(cliDir, "config.json");
  const cliInstalled = existsSync(cliConfig);
  check(
    "CLI store present",
    cliInstalled,
    cliInstalled ? `${cliDir}` : "run `onecue init` (or none installed)"
  );

  check(
    "store writable",
    writableProbe(cliInstalled ? cliDir : skillDir),
    cliInstalled ? cliDir : skillDir
  );

  // Claude Code hooks.
  const settingsFile = join(fp.root, ".claude", "settings.local.json");
  const settings = readJsonSafe(settingsFile);
  check(
    "settings readable",
    settings.status !== "corrupt",
    settings.status === "corrupt"
      ? `${settingsFile} is not valid JSON`
      : settingsFile
  );

  const hooks = settings.value?.hooks ?? {};
  const missing = HOOK_EVENTS.filter(
    (event) =>
      !(hooks[event] ?? []).some((matcher) =>
        (matcher.hooks ?? []).some((hook) => isOneCueCommand(hook.command ?? ""))
      )
  );
  check(
    "hooks installed",
    missing.length === 0,
    missing.length > 0
      ? `missing: ${missing.join(", ")}`
      : `${HOOK_EVENTS.length} events`
  );

  const hookCommands = Object.values(hooks)
    .flat()
    .flatMap((matcher) => (matcher.hooks ?? []).map((hook) => hook.command))
    .filter((command) => typeof command === "string" && isOneCueCommand(command));
  const deadTargets = [
    ...new Set(
      hookCommands
        .map((command) => HOOK_TARGET.exec(command)?.[1])
        .filter((target) => target && !existsSync(target))
    ),
  ];
  check(
    "hook targets exist",
    hookCommands.length === 0 || deadTargets.length === 0,
    deadTargets.length > 0 ? `missing: ${deadTargets.join(", ")}` : undefined
  );

  // CLI memories are JSONL; parsing fails open, so count the skipped gap.
  const memoriesFile = join(cliDir, "memories.jsonl");
  if (existsSync(memoriesFile)) {
    const lines = readFileSync(memoriesFile, "utf8")
      .split("\n")
      .filter((line) => line.trim());
    let parsed = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        parsed += 1;
      } catch {
        // corrupt line
      }
    }
    const corrupt = lines.length - parsed;
    check(
      "memories readable",
      corrupt === 0,
      corrupt > 0 ? `${corrupt} corrupt line(s) skipped` : `${parsed} records`
    );
  }

  return checks;
};

const main = () => {
  const args = process.argv.slice(2);
  const checks = collect();
  const ok = checks.every((entry) => entry.ok);

  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ checks, ok }, null, 2)}\n`);
  } else {
    const lines = checks.map(
      ({ label, ok: pass, detail }) =>
        `  ${pass ? "PASS" : "WARN"}  ${label}${detail ? ` — ${detail}` : ""}`
    );
    process.stdout.write(`${["OneCue doctor", ...lines].join("\n")}\n`);
  }

  if (args.includes("--report")) {
    const rows = checks
      .map(
        ({ label, ok: pass, detail }) =>
          `| ${label} | ${pass ? "PASS" : "WARN"} | ${detail ?? "—"} |`
      )
      .join("\n");
    const body = [
      "# OneCue doctor report",
      "",
      `Generated ${new Date().toISOString()} in \`${process.cwd()}\``,
      "",
      "| Check | Result | Detail |",
      "| --- | --- | --- |",
      rows,
      "",
      ok
        ? "All checks passed."
        : "Some checks need attention — see WARN rows above.",
      "",
    ].join("\n");
    const out = join(process.cwd(), "onecue-doctor-report.md");
    writeFileSync(out, body);
    process.stdout.write(`Report written to ${out}\n`);
  }

  if (!ok) {
    process.exitCode = 1;
  }
};

main();
