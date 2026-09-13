---
name: onecue-doctor
description: Diagnoses whether OneCue project memory is set up correctly in the current repository. This skill should be used when the user asks to "check OneCue", "run onecue doctor", "is OneCue working", "debug OneCue", or when OneCue memories do not seem to be remembered or recalled. It verifies the local store, the Claude Code hook installation, and the Node runtime, then suggests the exact fix for anything that is wrong. Do not use it to create or recall memories — that is the onecue skill.
license: MIT
metadata:
  author: onecueai
  version: "0.1.0"
user_invocable: true
---

# OneCue Doctor

**Check the setup before blaming the memory.**

OneCue doctor verifies that project memory can actually work in this repository: the store directory, the Claude Code hooks, and the runtime. Run it when something feels off — a memory was not recalled, a hook seems silent, or the user is unsure OneCue is installed.

## Preferred path: run the diagnostics

**Never improvise the checks.** Run real code, in this order:

1. If the `onecue` CLI is installed, it is the source of truth
   (`npm i -g onecue-cli` installs it):

   ```bash
   onecue doctor
   ```

2. Otherwise run the bundled script — same checks, zero install, exits non-zero on warnings:

   ```bash
   node scripts/doctor.mjs            # run from this skill's directory
   node scripts/doctor.mjs --json     # machine-readable output
   node scripts/doctor.mjs --report   # also writes onecue-doctor-report.md
   ```

   The script checks both installs: the skill store (`.onecue/memories/` in the
   project) and the CLI store (`~/.onecue/projects/<fingerprint>/`).

Expected output is one `PASS` or `WARN` line per check. Hook and settings
checks are reported per harness (`claude`, `devin`) — the CLI writes hooks to
`.claude/settings.local.json` and `.devin/config.local.json`:

- `Node >= 20` — the CLI needs Node 20 or newer.
- `skill store present` — `.onecue/memories/` exists at the project root.
- `CLI store present` — `onecue init` has run (only relevant with the CLI).
- `store writable` — the store location can be written.
- `settings readable (claude|devin)` — the harness settings file parses.
- `hooks (claude|devin)` — OneCue hooks exist for all four events.
- `hook targets exist` — hook commands point at a CLI path that still exists.
- `memories readable` — no corrupt lines in the CLI's `memories.jsonl`.

Only if neither path can run — no `onecue` binary and the script is missing —
fall back to the manual checks below.

## Manual checks

When the CLI is unavailable, verify the same five things yourself:

1. **Node version.** `node --version` — major version must be 20 or higher.
2. **Store.** `.onecue/` exists at the repository root and is writable (create a temp file inside it, then remove it). If `.onecue/` is missing entirely, the project was never initialized.
3. **Initialization.** `.onecue/memories/` exists. An empty directory is fine; a missing one is not.
4. **Settings.** Read `.claude/settings.local.json` (Claude Code) and `.devin/config.local.json` (Devin) in the project. Each file that exists must parse as JSON.
5. **Hooks.** Each existing settings file must contain OneCue hook entries (look for `onecue` in the hooks section). Hooks are what let memories surface automatically.

## Report

When the user asks for a saved report, run the script with `--report` — it
writes `onecue-doctor-report.md` in the current directory. Otherwise summarize
each check as `PASS` or `WARN` with a one-line detail. For every `WARN`, give
the exact remedy:

- Node too old → upgrade Node to 20+.
- Store missing/not writable → fix permissions, then `onecue init` (or create `.onecue/memories/` if there is no CLI).
- Not initialized → `onecue init`.
- Settings unreadable → repair the JSON in the settings file; do not overwrite the file — show the parse error.
- Hooks missing → `onecue install`.

Offer to apply the fix. Ask before writing to settings or creating directories.

## Honesty rules

- Never claim a check passed if it did not run.
- Never create or modify memories — doctor only diagnoses.
- If the repository has no `.onecue/` and no CLI, say plainly: "OneCue is not installed in this project" and point to the install command rather than simulating results.
