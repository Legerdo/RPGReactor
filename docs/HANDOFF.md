# Handoff

Dated notes for the cycle in progress, newest first. Read [STATUS.md](STATUS.md) first: it is the current state and the one list of open work. Earlier cycles are in [archive/handoff](archive/handoff/), one file per version ([0.99.1](archive/handoff/0.99.1.md), [0.99.0](archive/handoff/0.99.0.md), [0.98.8](archive/handoff/0.98.8.md), and date-named files before that).

An entry holds only what the next session needs and cannot find elsewhere: what is half-done, what to watch for, what waits on the owner, how to resume. What changed goes in the editor changelog; how the code works goes in the commit message and the guides. Size limits and the rollover are in [README.md](README.md#keeping-status-and-handoff-short); `docs-budget.test.cjs` enforces them.

## Where things stand (2026-10-23)

- **0.99.1** shipped 2026-10-24 (UTC) with release pictures; **0.99.2** is open at runtime **20261023.2**, synced to all 19 projects. The builders are at Preview 47 with visual acceptance open: [character coverage](CHARACTER-QUALITY.md), [remaining issues](CLAUDE-QUALITY-TRACKER.md), [props](PROP-BUILDER.md).
- **Owner questions:** [OWNER-QUESTIONS.md](OWNER-QUESTIONS.md); the web trim waits for the weekend release.
- **Editor windows:** the Event Editor, Database, Forge and Plugin Manager each open in a frameless window of their own (`utils/DetachedWindow.js`). Native Linux transparency still needs a look on the real desktop.
- **Savior & Religion** (`template/Savior & Religion`, not in git, an encrypted MV game the owner is trying as a template) boots, plays its opening and draws its ULDS maps 2, 5 and 19.
- **Next:** CI green, then the three trailer-shoot bugs in STATUS (Blueprint stamp blanking, Forge preview frame drops, the gown breaking on Height), then keeping the map scene across a seamless crossing. 0.99.1 and 0.99.2 are announced together at the end of the weekend with a video and pictures (RELEASE-CHECKLIST §5).

## 2026-10-24 — 0.99.1 shipped; trailer pipeline

- **Release:** 0.99.1 is tagged and published with eight highlight pictures (`docs/media/releases/0.99.1/`). The README front page carries the key art and a gallery; `docs/media/readme/social-preview.jpg` is uploaded as the repository's link preview. Pushing works without prompts through the gh credential helper in the repo's `.git/config`.
- **Trailer:** `scratchpad/trailer/` (gitignored). `record-all.sh [names]` re-records shots on the headless display (x11grab per window id: the root window of `:2` is black), `edit.sh` cuts `out/rough-cut.mp4` to *Darkstream Descent* from `tools/edit-plan.json`. The owner liked the rough cut. For the final: raid at dusk or day, a fixed camera path for the night shot and the ride, builder shots cropped to the 3D view, a stamped house once the Blueprint bug is fixed, an Action battle moment.
- **Announcement:** a devlog draft for 0.99.1 is in `scratchpad/round2-2026-10-23/release-0.99.1/devlog.md`; the 0.99.2 post covers both versions.
