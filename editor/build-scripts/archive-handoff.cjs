#!/usr/bin/env node
/**
 * Move finished entries out of docs/HANDOFF.md into docs/archive/handoff/.
 *
 *   node editor/build-scripts/archive-handoff.cjs                     # the cycle the last release closed
 *   node editor/build-scripts/archive-handoff.cjs --through 2026-10-20 # older entries of the open cycle
 *
 * With no arguments, every dated entry on or before the latest release's date
 * goes to `archive/handoff/<that version>.md`. With `--through`, entries on or
 * before that date go to the file of the version in development (the
 * handoff is over its size budget mid-cycle). `--version` names the file
 * explicitly. "Where things stand" always stays.
 *
 * An entry is a `## ` section whose heading carries a YYYY-MM-DD date. An
 * undated `## ` heading (a cycle divider) travels with the entry after it.
 * The archive file is newest first, like the handoff; moved entries go above
 * what it already holds.
 *
 * `cut-release.cjs` runs this for the version it releases, so the release
 * commit carries the cycle's notes into the archive. `docs-budget.test.cjs`
 * fails while the handoff holds an entry older than the latest release.
 */
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const HANDOFF = path.join('docs', 'HANDOFF.md');
const ARCHIVE_DIR = path.join('docs', 'archive', 'handoff');

const DATE = /\d{4}-\d{2}-\d{2}/;
const STANDING = /^## Where things stand/;

/** The newest released version and its date, from the root changelog index. */
function latestRelease(root = repoRoot) {
    const index = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const match = index.match(/^- \[(\d+\.\d+\.\d+)\]\([^)]+\) - (\d{4}-\d{2}-\d{2})$/m);
    if (!match) throw new Error('CHANGELOG.md names no released version');
    return { version: match[1], date: match[2] };
}

function developmentVersion(root = repoRoot) {
    return JSON.parse(fs.readFileSync(path.join(root, 'editor', 'package.json'), 'utf8')).version;
}

/** The handoff as its preamble and its `## ` sections, in order. */
function splitSections(source) {
    const parts = source.split(/^(?=## )/m);
    const preamble = parts[0].startsWith('## ') ? '' : parts.shift();
    return {
        preamble,
        sections: parts.map(text => {
            const heading = text.slice(0, text.indexOf('\n') >>> 0);
            return { text, heading, date: STANDING.test(heading) ? null : heading.match(DATE)?.[0] || null };
        })
    };
}

const withBreak = text => text.replace(/\n*$/, '\n\n');

/**
 * Work out the move without writing anything.
 * Returns { kept, moved, file, archived } where `archived` is the archive
 * file's new text, or null when nothing moves.
 */
function planArchive({ root = repoRoot, through, version } = {}) {
    const source = fs.readFileSync(path.join(root, HANDOFF), 'utf8');
    if (!through) {
        const release = latestRelease(root);
        through = release.date;
        version = version || release.version;
    }
    version = version || developmentVersion(root);

    const { preamble, sections } = splitSections(source);
    const kept = [];
    const moved = [];
    let pending = [];
    for (const section of sections) {
        if (STANDING.test(section.heading)) {
            kept.push(...pending, section);
            pending = [];
        } else if (!section.date) {
            pending.push(section);
        } else {
            (section.date <= through ? moved : kept).push(...pending, section);
            pending = [];
        }
    }
    kept.push(...pending);

    const file = path.join(ARCHIVE_DIR, `${version}.md`);
    if (!moved.length) return { kept, moved, file, archived: null, handoff: source };

    const full = path.join(root, file);
    const header = `# Handoff archive: the ${version} cycle\n\n`
        + `Dated entries moved out of [HANDOFF.md](../../HANDOFF.md), newest first. `
        + `Runtime revisions, counts and file names are as they stood on the day; `
        + `the current state is in [STATUS.md](../../STATUS.md).\n\n`;
    let existing = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : header;
    const firstEntry = existing.search(/^## /m);
    const head = firstEntry < 0 ? existing : existing.slice(0, firstEntry);
    const tail = firstEntry < 0 ? '' : existing.slice(firstEntry);
    const archived = withBreak(head) + moved.map(s => withBreak(s.text)).join('')
        + tail.replace(/\n*$/, '\n');

    const handoff = withBreak(preamble) + kept.map(s => withBreak(s.text)).join('');
    return { kept, moved, file, archived, handoff: handoff.replace(/\n*$/, '\n') };
}

/** Move the entries; returns the repository-relative files written. */
function archiveHandoff(options = {}) {
    const root = options.root || repoRoot;
    const plan = planArchive(options);
    if (!plan.archived) return { ...plan, written: [] };
    fs.writeFileSync(path.join(root, plan.file), plan.archived);
    fs.writeFileSync(path.join(root, HANDOFF), plan.handoff);
    return { ...plan, written: [HANDOFF, plan.file] };
}

function main(argv) {
    const value = flag => {
        const at = argv.indexOf(flag);
        return at >= 0 ? argv[at + 1] : undefined;
    };
    const through = value('--through');
    if (through && !/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error('--through takes YYYY-MM-DD');
    const result = archiveHandoff({ through, version: value('--version') });
    if (!result.written.length) {
        console.log('Nothing to archive.');
        return;
    }
    console.log(`Moved ${result.moved.length} section(s) to ${result.file}:`);
    for (const section of result.moved) console.log(`  ${section.heading}`);
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

module.exports = { archiveHandoff, planArchive, latestRelease, splitSections };
