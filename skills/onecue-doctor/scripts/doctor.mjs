#!/usr/bin/env node
/**
 * onecue-doctor — standalone diagnostic.
 *
 * Zero dependencies. Checks both OneCue installs:
 *   - the canonical store: <project>/.onecue/decisions/  (Markdown, git-visible)
 *   - the skill fallback:  <project>/.onecue/memories/   (Markdown, no CLI)
 *   - the CLI logs:        ~/.onecue/projects/<fp>/      (session/event JSONL)
 *   - the hooks:           <project>/.claude/settings.local.json (Claude Code)
 *                          <project>/.devin/config.local.json   (Devin)
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
  "PreToolUse",
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

  const skillDir = join(fp.root, ".onecue");
  const decisionsDir = join(skillDir, "decisions");
  const memoriesDir = join(skillDir, "memories");
  const decisionFiles = existsSync(decisionsDir)
    ? readdirSync(decisionsDir).filter((name) => name.endsWith(".md"))
    : [];
  const memoryFiles = existsSync(memoriesDir)
    ? readdirSync(memoriesDir).filter((name) => name.endsWith(".md"))
    : [];

  // CLI session/event logs: ~/.onecue/projects/<fingerprint>/config.json
  const cliDir = join(
    process.env.ONECUE_HOME ?? join(homedir(), ".onecue"),
    "projects",
    fp.id
  );
  const cliConfig = join(cliDir, "config.json");
  const cliInstalled = existsSync(cliConfig);
  const storePresent =
    existsSync(decisionsDir) || cliInstalled || existsSync(memoriesDir);
  check(
    "decision store present",
    storePresent,
    existsSync(decisionsDir)
      ? decisionsDir
      : cliInstalled
        ? cliDir
        : existsSync(memoriesDir)
          ? memoriesDir
          : "run `onecue init` inside the repo"
  );

  check(
    "store writable",
    writableProbe(existsSync(decisionsDir) ? decisionsDir : skillDir),
    existsSync(decisionsDir) ? decisionsDir : skillDir
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

  if (existsSync(decisionsDir)) {
    check(
      "decisions readable",
      true,
      `${decisionFiles.length} decisions`
    );
  }

  check(
    "skill memories imported",
    !cliInstalled || memoryFiles.length === 0,
    cliInstalled && memoryFiles.length > 0
      ? `${memoryFiles.length} file(s) in .onecue/memories/ outside the canonical store — re-capture via \`onecue remember\``
      : undefined
  );

  return { checks, cliDir };
};

const readSafe = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const parseJsonl = (text) => {
  const out = [];
  for (const line of text.split("\n")) {
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

const jsonl = (file) => {
  const text = readSafe(file);
  return text === null ? [] : parseJsonl(text);
};

const MEMORY_KINDS = new Set([
  "decision",
  "discovery",
  "insight",
  "open_loop",
  "reference",
]);
const SESSION_ROLES = new Set(["user", "cue", "assistant", "session_end"]);

/**
 * Counts what the session logs actually recorded: prompts observed, cues
 * injected, memories reused. Token and kind figures come from the payload
 * recorded when the cue was emitted — never reconstructed from the current
 * memory text, which edits and forgets would rewrite. The token figure is
 * cue payload size (chars / 4) — a labeled estimate, not measured spend.
 */
const collectImpact = (cliDir) => {
  const stats = {
    byKind: {},
    cues: 0,
    deliveredTokens: 0,
    prompts: 0,
    sessions: 0,
    uniqueMemories: 0,
    unmeasuredCues: 0,
    skippedEntries: 0,
    unreadableLogs: 0,
    tokenEstimateMethod: "ceil(cueChars / 4)",
  };
  const sessionsDir = join(cliDir, "sessions");
  if (!existsSync(sessionsDir)) {
    return stats;
  }
  let files;
  try {
    files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    stats.unreadableLogs += 1;
    return stats;
  }

  const cueIds = new Set();
  const sessions = new Set();
  for (const file of files) {
    const text = readSafe(join(sessionsDir, file));
    if (text === null) {
      stats.unreadableLogs += 1;
      continue;
    }
    const entries = parseJsonl(text);
    stats.skippedEntries +=
      text.split("\n").filter((line) => line.trim()).length - entries.length;
    for (const entry of entries) {
      if (
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof entry.sessionId !== "string" ||
        !entry.sessionId.trim() ||
        !SESSION_ROLES.has(entry.role) ||
        (entry.role === "cue" &&
          (typeof entry.memoryId !== "string" || !entry.memoryId.trim()))
      ) {
        stats.skippedEntries += 1;
        continue;
      }
      if (entry.role === "user") {
        stats.prompts += 1;
        sessions.add(entry.sessionId);
      }
      if (entry.role === "cue") {
        stats.cues += 1;
        sessions.add(entry.sessionId);
        cueIds.add(entry.memoryId);
        const kind = MEMORY_KINDS.has(entry.memoryKind)
          ? entry.memoryKind
          : "unknown";
        stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
        if (
          typeof entry.cueChars === "number" &&
          Number.isSafeInteger(entry.cueChars) &&
          entry.cueChars >= 0
        ) {
          stats.deliveredTokens += Math.ceil(entry.cueChars / 4);
        } else {
          stats.unmeasuredCues += 1;
        }
      }
    }
  }
  stats.sessions = sessions.size;
  stats.uniqueMemories = cueIds.size;
  return stats;
};

const fmtTokens = (n) => (n >= 1000 ? `≈${(n / 1000).toFixed(1)}k` : `≈${n}`);

const impactLines = (stats) => {
  const warnings =
    stats.unreadableLogs || stats.skippedEntries
      ? [
          `  incomplete logs     ${stats.unreadableLogs} unreadable file(s), ${stats.skippedEntries} invalid entry/entries skipped`,
        ]
      : [];
  if (stats.prompts === 0 && stats.cues === 0) {
    return [
      "Impact",
      "  no hooked activity found in readable prompt/cue entries",
      ...warnings,
    ];
  }
  const kinds = Object.entries(stats.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${kind} ×${n}`)
    .join(", ");
  return [
    "Impact — counted from local session logs",
    `  prompts observed    ${stats.prompts} across ${stats.sessions} session(s)`,
    `  cues surfaced       ${stats.cues} · ${stats.uniqueMemories} unique memories${kinds ? ` (${kinds})` : ""}`,
    "  silence is not measured — no cue can also mean suppression or a hook failure",
    `  cue payload         ${fmtTokens(stats.deliveredTokens)} estimated tokens across ${stats.cues - stats.unmeasuredCues}/${stats.cues} recorded payload sizes`,
    ...(stats.unmeasuredCues
      ? [
          `  payload size unavailable for ${stats.unmeasuredCues} cue(s); excluded from token estimate`,
        ]
      : []),
    "  estimates, not measured spend — ceil(payload characters / 4), not savings or proof of use",
    ...warnings,
  ];
};

const main = () => {
  const args = process.argv.slice(2);
  const { checks, cliDir } = collect();
  const impact = collectImpact(cliDir);
  checks.push({
    label: "session logs readable",
    ok: impact.unreadableLogs === 0 && impact.skippedEntries === 0,
    detail: `${impact.unreadableLogs} unreadable file(s), ${impact.skippedEntries} invalid entry/entries`,
  });
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
