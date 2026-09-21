<h1 align="center">OneCue Doctor</h1>

<p align="center">
  <strong>The decision layer for coding agents — check the setup before blaming the memory.</strong><br>
  Diagnoses your OneCue installation — store, hooks, runtime — and tells you exactly what to fix.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="skills/onecue-doctor/SKILL.md"><img src="https://img.shields.io/badge/version-0.1.0-green.svg" alt="Version 0.1.0"></a>
  <img src="https://img.shields.io/badge/needs-zero%20install-black.svg" alt="Works without the CLI">
  <a href="https://skills.sh/onecueai/onecue-doctor"><img src="https://skills.sh/b/onecueai/onecue-doctor" alt="Installs on skills.sh"></a>
</p>

---

A memory that doesn't surface is almost never a memory problem — it's a setup problem. The store wasn't initialized, the hooks didn't install, the runtime is too old. Doctor finds which one, in seconds.

## Install

```bash
npx skills add onecueai/onecue-doctor
```

Then ask Claude:

```text
Run onecue doctor
```

## What it checks

| Check | PASS means |
| --- | --- |
| `Node >= 20` | The OneCue CLI has a modern runtime |
| `store writable` | `.onecue/` can be created and written |
| `project initialized` | `onecue init` has run in this repo |
| `settings readable (claude\|devin)` | Each harness settings file parses |
| `hooks (claude\|devin)` | Memories can surface automatically on every prompt, in Claude Code and Devin |
| `hook targets exist` | Hook commands point at a CLI that is still there |
| `memories readable` | No corrupt lines in `memories.jsonl` |

Every `WARN` comes with the exact remedy — `onecue init`, `onecue install`, a permissions fix, or a Node upgrade — and Doctor offers to apply it.

## Two ways to run

- **With the `onecue` CLI** (`npm i -g onecue-cli`) — runs `onecue doctor`, the source of truth.
- **Without it** — performs the same five checks manually. It never simulates results; if a check can't run, it says so.

## Honesty rules

- Never claims a check passed if it didn't run.
- Never creates or modifies memories — doctor only diagnoses.
- If nothing is installed, it says "OneCue is not installed in this project" and points to the install command.

## Related

- [onecue-skill](https://github.com/onecueai/onecue-skill) — durable project memory for Claude Code

## License

[MIT](LICENSE)
