#!/usr/bin/env node
/**
 * onecue-doctor — standalone diagnostic.
 *
 * Zero dependencies. Checks both OneCue installs:
 *   - the skill store:    <project>/.onecue/memories/  (Markdown, agent-written)
 *   - the CLI store:      ~/.onecue/projects/<fp>/     (JSONL, `onecue` binary)
 *   - the hooks:          <project>/.claude/settings.local.json (Claude Code)
 *                         <project>/.devin/config.local.json   (Devin)
 *
 * Usage: node doctor.mjs [--json] [--report]
 * Exit code is 1 when any check warns, so scripts and CI can rely on it.
 */
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readdirSync,
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
const ROOT_MARKERS = [".git", "package.json", ".claude", ".devin"];
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

  // Memory store: either the Markdown skill store (<project>/.onecue) or the
  // CLI store (~/.onecue/projects/<fp>) counts — modern installs use the CLI.
  const skillDir = join(fp.root, ".onecue");
  const skillMemories = join(skillDir, "memories");
  const skillInstalled = existsSync(skillMemories);

  // CLI store: ~/.onecue/projects/<fingerprint>/config.json
  const cliDir = join(
    process.env.ONECUE_HOME ?? join(homedir(), ".onecue"),
    "projects",
    fp.id
  );
  const cliConfig = join(cliDir, "config.json");
  const cliInstalled = existsSync(cliConfig);
  check(
    "memory store present",
    skillInstalled || cliInstalled,
    cliInstalled
      ? cliDir
      : skillInstalled
        ? skillMemories
        : "run `onecue install` inside the repo"
  );

  check(
    "store writable",
    writableProbe(cliInstalled ? cliDir : skillDir),
    cliInstalled ? cliDir : skillDir
  );

  // Harness hooks: same JSON format in Claude Code and Devin config files.
  const harnessFiles = [
    { file: join(fp.root, ".claude", "settings.local.json"), id: "claude" },
    { file: join(fp.root, ".devin", "config.local.json"), id: "devin" },
  ];
  const hookCommands = [];
  const existing = harnessFiles.filter(({ file }) => existsSync(file));
  if (existing.length === 0) {
    check("hooks installed", false, "run `onecue install`");
  }
  for (const { file, id } of existing) {
    const settings = readJsonSafe(file);
    check(
      `settings readable (${id})`,
      settings.status !== "corrupt",
      settings.status === "corrupt" ? `${file} is not valid JSON` : file
    );
    if (settings.status === "corrupt") {
      check(`hooks (${id})`, false, "settings unreadable");
      continue;
    }
    const hooks = settings.value?.hooks ?? {};
    const missing = HOOK_EVENTS.filter(
      (event) =>
        !(hooks[event] ?? []).some((matcher) =>
          (matcher.hooks ?? []).some((hook) =>
            isOneCueCommand(hook.command ?? "")
          )
        )
    );
    check(
      `hooks (${id})`,
      missing.length === 0,
      missing.length > 0
        ? `missing: ${missing.join(", ")}`
        : `${HOOK_EVENTS.length} events`
    );
    hookCommands.push(
      ...Object.values(hooks)
        .flat()
        .flatMap((matcher) => (matcher.hooks ?? []).map((hook) => hook.command))
        .filter(
          (command) => typeof command === "string" && isOneCueCommand(command)
        )
    );
  }

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

  return { checks, cliDir };
};

const jsonl = (file) => {
  if (!existsSync(file)) {
    return [];
  }
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch {
      // corrupt line — skip
    }
  }
  return out;
};

/**
 * Counts what the session logs actually recorded: prompts observed, cues
 * injected, memories reused. The token figure is surfaced cue payload size
 * (chars / 4) — a labeled estimate, not measured model spend.
 */
const collectImpact = (cliDir) => {
  const stats = {
    byKind: {},
    cues: 0,
    deliveredTokens: 0,
    prompts: 0,
    sessions: 0,
    uniqueMemories: 0,
  };
  const sessionsDir = join(cliDir, "sessions");
  if (!existsSync(sessionsDir)) {
    return stats;
  }
  const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  stats.sessions = files.length;

  const cueIds = new Set();
  const surfaced = [];
  for (const file of files) {
    for (const entry of jsonl(join(sessionsDir, file))) {
      if (entry.role === "user") {
        stats.prompts += 1;
      }
      if (entry.role === "cue" && entry.memoryId) {
        stats.cues += 1;
        cueIds.add(entry.memoryId);
        surfaced.push(entry.memoryId);
      }
    }
  }
  stats.uniqueMemories = cueIds.size;

  const byId = new Map(
    jsonl(join(cliDir, "memories.jsonl"))
      .filter((m) => m.id)
      .map((m) => [m.id, m])
  );
  for (const id of surfaced) {
    const memory = byId.get(id);
    const kind = memory?.metadata?.kind ?? "unknown";
    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
    stats.deliveredTokens += Math.ceil((memory?.text?.length ?? 0) / 4);
  }
  return stats;
};

const fmtTokens = (n) => (n >= 1000 ? `≈${(n / 1000).toFixed(1)}k` : `≈${n}`);

const impactLines = (stats) => {
  if (stats.prompts === 0 && stats.cues === 0) {
    return [
      "Impact",
      "  no hooked activity yet — cues appear after the first hooked prompt",
    ];
  }
  const silence = Math.max(0, stats.prompts - stats.cues);
  const kinds = Object.entries(stats.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${kind} ×${n}`)
    .join(", ");
  return [
    "Impact — counted from local session logs",
    `  prompts observed    ${stats.prompts} across ${stats.sessions} session(s)`,
    `  cues surfaced       ${stats.cues} · ${stats.uniqueMemories} unique memories${kinds ? ` (${kinds})` : ""}`,
    `  silence             ${silence} prompt(s) — nothing relevant, nothing injected`,
    `  context delivered   ${fmtTokens(stats.deliveredTokens)} tokens of prior context you didn't retype`,
    "  estimates, not measured spend — real token accounting is planned",
  ];
};

const main = () => {
  const args = process.argv.slice(2);
  const { checks, cliDir } = collect();
  const impact = collectImpact(cliDir);
  const ok = checks.every((entry) => entry.ok);

  if (args.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ checks, impact, ok }, null, 2)}\n`
    );
  } else {
    const lines = checks.map(
      ({ label, ok: pass, detail }) =>
        `  ${pass ? "PASS" : "WARN"}  ${label}${detail ? ` — ${detail}` : ""}`
    );
    process.stdout.write(
      `${["OneCue doctor", ...lines, "", ...impactLines(impact)].join("\n")}\n`
    );
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
      "## Impact — counted from local session logs",
      "",
      ...impactLines(impact).slice(1),
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
