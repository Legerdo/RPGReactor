# Handoff

Dated notes for the cycle in progress, newest first. Read [STATUS.md](STATUS.md) first: it is the current state and the one list of open work. Earlier cycles are in [archive/handoff](archive/handoff/), one file per version ([0.99.0](archive/handoff/0.99.0.md), [0.98.8](archive/handoff/0.98.8.md), and date-named files before that).

An entry holds only what the next session needs and cannot find elsewhere: what is half-done, what to watch for, what waits on the owner, how to resume. What changed goes in the editor changelog; how the code works goes in the commit message and the guides. Size limits and the rollover are in [README.md](README.md#keeping-status-and-handoff-short); `docs-budget.test.cjs` enforces them.

## Where things stand (2026-10-14)

- **0.99.0** shipped on 2026-10-12 at runtime **20261011.14**; PR #74 was merged after it. `main` matches `origin/main` at `dc918245`.
- **0.99.1** is in development at runtime **20261014.1**, synced to all 16 bundled projects. Nothing from 2026-10-14 is committed.
- **Next agreed:** nothing yet. Three questions from the bug pass are with the owner (STATUS › Open work › Waiting on the owner): the Action escape control, on-map defeated enemies, and ending a kept battle when another starts.

## 2026-10-14 — The 2026-10-10 audit's bugs fixed (runtime 20261014.1)

All fourteen, plus the early border exit, are in `editor/changelog/0.99.1.md`. Tests: `audit-20261010-fight-core`, `audit-20261010-action`, `fight-classic`, `audit-20261010-left`, `layout-fit`, `vehicles-border-slide`. Screenshots before and after at three sizes were in `/tmp/rr-layout-shots/` (not kept).

- **Changed rule, the owner's to confirm:** a kept battle (Transfer Player with "keep") now ends as an escape when any other battle starts, encounters included; one `$gameFight` cannot hold two. `fight-flow.test.cjs` and two `vehicles-battle.test.cjs` tests were rewritten for it.
- **Built without a control:** Action and First Person escape (`commandRetreat` in `reactor_fight_action.js`); nothing in the game calls it yet.

## 2026-10-14 — 0.99.1 opened; handoff archived, doc budgets enforced

- Version surfaces name 0.99.1 (package, About box, `RR_APP_VERSION`, web host, legacy skeleton, runtime header via `sync-runtime.cjs`, the Demo's project file, READMEs, release checklist, plugin API examples). Both changelogs have a 0.99.1 file and index line.
- The handoff had grown to 166 KB over two cycles. `editor/build-scripts/archive-handoff.cjs` moved the 0.98.8 and 0.99.0 entries to `archive/handoff/`; `cut-release.cjs` now runs it in every release commit. STATUS was rewritten to one bullet per area and took over the open lists, the owner decisions that stand, and the harness notes.
