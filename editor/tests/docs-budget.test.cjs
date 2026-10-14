const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { archiveHandoff, latestRelease, splitSections } = require('../build-scripts/archive-handoff.cjs');

const workspaceRoot = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(workspaceRoot, file), 'utf8');
const bytes = text => Buffer.byteLength(text, 'utf8');

// The limits and what to do about each are in docs/README.md › Keeping STATUS
// and HANDOFF short. Raise a limit there and here together, or not at all.
const STATUS_LIMIT = 25000;
const HANDOFF_LIMIT = 40000;
const STANDING_LIMIT = 2500;
const ENTRY_LIMIT = 4000;

const RULES = 'see docs/README.md › Keeping STATUS and HANDOFF short';

test('STATUS.md stays within its budget', () => {
    const size = bytes(read('docs/STATUS.md'));
    assert.ok(size <= STATUS_LIMIT,
        `STATUS.md is ${size} bytes (limit ${STATUS_LIMIT}): replace stale bullets, move finished items out of Open work; ${RULES}`);
});

test('HANDOFF.md holds one short standing and the cycle in progress', () => {
    const source = read('docs/HANDOFF.md');
    const { sections } = splitSections(source);
    const standing = sections.filter(s => /^## Where things stand/.test(s.heading));
    assert.equal(standing.length, 1, 'HANDOFF.md has exactly one "## Where things stand" section');
    assert.ok(bytes(standing[0].text) <= STANDING_LIMIT,
        `"Where things stand" is ${bytes(standing[0].text)} bytes (limit ${STANDING_LIMIT}): rewrite it, don't add to it; ${RULES}`);

    const release = latestRelease(workspaceRoot);
    for (const section of sections) {
        if (section === standing[0]) continue;
        assert.ok(section.date, `HANDOFF.md section without a date: ${section.heading}`);
        assert.ok(section.date >= release.date,
            `${section.heading} is older than ${release.version} (${release.date}): run node editor/build-scripts/archive-handoff.cjs`);
        assert.ok(bytes(section.text) <= ENTRY_LIMIT,
            `${section.heading} is ${bytes(section.text)} bytes (limit ${ENTRY_LIMIT}): what changed belongs in the changelog; ${RULES}`);
    }
    assert.ok(bytes(source) <= HANDOFF_LIMIT,
        `HANDOFF.md is ${bytes(source)} bytes (limit ${HANDOFF_LIMIT}): archive older entries with archive-handoff.cjs --through <date>; ${RULES}`);
});

test('archive-handoff moves entries through a date and keeps the standing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-handoff-'));
    try {
        fs.mkdirSync(path.join(root, 'docs', 'archive', 'handoff'), { recursive: true });
        fs.mkdirSync(path.join(root, 'editor'));
        fs.writeFileSync(path.join(root, 'editor', 'package.json'), '{"version": "1.0.1"}');
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'),
            '# Changelog\n\n- [1.0.1](changelog/1.0.1.md) (in development)\n- [1.0.0](changelog/1.0.0.md) - 2026-01-10\n');
        fs.writeFileSync(path.join(root, 'docs', 'HANDOFF.md'), [
            '# Handoff\n\nIntro.\n',
            '## Where things stand (2026-01-12)\n\nNow.\n',
            '## 2026-01-11 — After the release\n\nKept.\n',
            '## 1.0.0 cycle\n\nDivider.\n',
            '## 2026-01-09 — Before\n\nMoved.\n',
            '## 2026-01-08 — Earlier\n\nMoved too.\n'
        ].join('\n'));
        fs.writeFileSync(path.join(root, 'docs', 'archive', 'handoff', '1.0.0.md'),
            '# Handoff archive: the 1.0.0 cycle\n\nHeader.\n\n## 2026-01-01 — Already here\n\nOld.\n');

        const result = archiveHandoff({ root });
        assert.equal(result.file, path.join('docs', 'archive', 'handoff', '1.0.0.md'));
        assert.deepEqual(result.moved.map(s => s.heading),
            ['## 1.0.0 cycle', '## 2026-01-09 — Before', '## 2026-01-08 — Earlier']);

        const handoff = fs.readFileSync(path.join(root, 'docs', 'HANDOFF.md'), 'utf8');
        assert.match(handoff, /^# Handoff\n\nIntro\.\n\n## Where things stand/);
        assert.match(handoff, /## 2026-01-11 — After the release\n\nKept\.\n$/);
        assert.doesNotMatch(handoff, /Before|Divider/);

        const archive = fs.readFileSync(path.join(root, result.file), 'utf8');
        const order = ['Header.', '## 1.0.0 cycle', '## 2026-01-09', '## 2026-01-08', '## 2026-01-01']
            .map(text => archive.indexOf(text));
        assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])), archive);

        assert.deepEqual(archiveHandoff({ root }).written, [], 'a second run moves nothing');

        const midCycle = archiveHandoff({ root, through: '2026-01-11' });
        assert.equal(midCycle.file, path.join('docs', 'archive', 'handoff', '1.0.1.md'));
        assert.match(fs.readFileSync(path.join(root, midCycle.file), 'utf8'), /^# Handoff archive: the 1\.0\.1 cycle/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
