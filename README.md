<h1 align="center">OneCue Doctor</h1>

<p align="center">
  <strong>The decision layer for coding agents — check the setup before blaming the store.</strong><br>
  Diagnoses your OneCue installation — store, hooks, runtime — and tells you exactly what to fix.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="skills/onecue-doctor/SKILL.md"><img src="https://img.shields.io/badge/version-0.1.0-green.svg" alt="Version 0.1.0"></a>
  <img src="https://img.shields.io/badge/needs-zero%20install-black.svg" alt="Works without the CLI">
  <a href="https://skills.sh/onecueai/onecue-doctor"><img src="https://skills.sh/b/onecueai/onecue-doctor" alt="Installs on skills.sh"></a>
</p>

---

A decision that doesn't surface is almost never a recall problem — it's a setup problem. The store wasn't initialized, the hooks didn't install, the runtime is too old. Doctor finds which one, in seconds.

## Install

```bash
npx skills add onecueai/onecue-doctor
```

Then ask Claude:

```text
Run onecue doctor
```

## What it checks

When the `onecue` CLI is on PATH, Doctor runs `onecue doctor` — the source of truth for CLI 0.4.0. Without the CLI, the bundled script performs the same family of checks.

| Check | PASS means |
| --- | --- |
| `Node >= 20` | The OneCue CLI has a modern runtime |
| `store writable` | `.onecue/` can be created and written |
| `project initialized` | `onecue init` has run, or `.onecue/decisions/` exists |
| `settings readable (claude\|devin)` | Each harness settings file parses |
| `hooks (claude\|devin)` | Decisions can surface automatically on every prompt, in Claude Code and Devin |
| `hook targets exist` | Hook commands point at a CLI that is still there |
| `decisions readable` | `.onecue/decisions/*.md` files parse |
| `skill memories imported` | No leftover `.onecue/memories/` files sitting outside the canonical store |
| `session logs readable` | No corrupt lines in local session logs |

Every `WARN` comes with the exact remedy — `onecue init`, `onecue install`, a permissions fix, or a Node upgrade — and Doctor offers to apply it.

Canonical store: git-visible `.onecue/decisions/`. Session logs stay in `~/.onecue/projects/<fingerprint>/`. Skill-only installs still use `.onecue/memories/` as a fallback.

## Two ways to run

- **With the `onecue` CLI** (`npm i -g onecue-cli`) — runs `onecue doctor`, the source of truth.
- **Without it** — performs the same checks manually. It never simulates results; if a check can't run, it says so.

## Honesty rules

- Never claims a check passed if it didn't run.
- Never creates or modifies decisions — doctor only diagnoses.
- If nothing is installed, it says "OneCue is not installed in this project" and points to the install command.

## Related

- [onecue-skill](https://github.com/onecueai/onecue-skill) — durable project decisions for Claude Code
- [onecue-cli](https://www.npmjs.com/package/onecue-cli) — CLI 0.4.0 on npm
- [Docs](https://onecue.sh/docs)

## License

[MIT](LICENSE)
