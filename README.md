# onecue-doctor

A Claude Code skill that diagnoses your [OneCue](https://onecue.sh) setup — the local memory store, the hooks, and the runtime — and tells you exactly what to fix.

## Install

```bash
npx skills add onecueai/onecue-doctor
```

Then ask Claude: "run onecue doctor" or "is OneCue working?"

## What it checks

| Check | What it means |
| --- | --- |
| Node >= 20 | The OneCue CLI needs a modern Node runtime |
| Store writable | `.onecue/` can be created and written |
| Project initialized | `onecue init` has run in this repo |
| Settings readable | Your Claude Code settings file parses |
| Hooks installed | OneCue hooks are present so memories surface automatically |

If the `onecue` CLI is installed it runs `onecue doctor` directly. Without the CLI it performs the same checks manually — it never simulates results.

## Related

- [onecue-skill](https://github.com/onecueai/onecue-skill) — durable project memory for Claude Code
