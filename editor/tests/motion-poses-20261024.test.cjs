'use strict';
// Motions made easy (2026-10-24): a rigged humanoid adds motion capture first (Forge › 3D Character Builder's), a
// state's motion replacing what played there; a motion made by hand is a row of whole-body key poses, made, moved,
// mirrored and copied as one; the preview follows the motion picked and a state button works with one open.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repoRoot = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf8');
global.self = global; global.window = global;
require(path.join(repoRoot, 'runtime/libs/three.js'));
global.Reactor3D = require(path.join(repoRoot, 'runtime/reactor_3d.js'));
const RRMotionEditor = require(path.join(repoRoot, 'editor/src/database/MotionEditor.js'));
const plain = value => JSON.parse(JSON.stringify(value));

function editorWith(tracks, frames = 60) {
    const host = { _t: text => text, rawAnimations: [], _sim: {}, renderRuleList() {}, saveRules() {} };
    const editor = new RRMotionEditor(host);
    editor.motion = { name: 'Leap', original: 'Leap', trigger: 'jumping', frames, repeat: false, hold: false, tracks: plain(tracks) };
    editor.render = () => {};
    return editor;
}
const key = (at, rotate) => ({ at, rotate, move: [0, 0, 0] });

test('the poses are the moments any part is keyed at, near ones as one', () => {
    const editor = editorWith([
        { part: 'LeftUpperArm', keys: [key(0, [0, 0, 0]), key(0.5, [30, 0, 0]), key(1, [0, 0, 0])] },
        { part: 'RightUpperArm', keys: [key(0.005, [0, 0, 0]), key(0.6, [10, 0, 0])] },
        { part: '', other: { type: 'spin' } }
    ]);
    assert.deepEqual(editor.poseTimes(), [0, 0.5, 0.6, 1]);
    editor.playhead = 0.502;
    assert.equal(editor.poseHere(), 0.5);
});

test('a pose added keys every part as it stands; moved, every part\'s key goes with it; removed, from every part', () => {
    const editor = editorWith([
        { part: 'LeftUpperArm', keys: [key(0, [0, 0, 0]), key(1, [40, 0, 0])] },
        { part: 'RightUpperArm', keys: [key(0, [0, 0, 0]), key(1, [0, 0, 20])] }
    ]);
    editor.playhead = 0.5;
    editor.addPose();
    assert.deepEqual(editor.poseTimes(), [0, 0.5, 1]);
    assert.ok(editor.motion.tracks.every(t => t.keys.some(k => k.at === 0.5)), 'every part keyed at the new pose');
    const halfway = editor.motion.tracks[0].keys.find(k => k.at === 0.5).rotate[0];
    assert.ok(halfway > 10 && halfway < 30, 'keyed as it stood there, between its poses: ' + halfway);
    const at = editor.movePose(0.5, 0.3);
    assert.equal(at, 0.3);
    assert.deepEqual(editor.poseTimes(), [0, 0.3, 1]);
    editor.removePose(0.3);
    assert.deepEqual(editor.poseTimes(), [0, 1]);
    // A part never loses its last key.
    editor.removePose(0); editor.removePose(1);
    assert.ok(editor.motion.tracks.every(t => t.keys.length >= 1));
});

test('mirror swaps the sides of the pose at the playhead, each turn seen in a mirror; a part with no partner mirrors in place', () => {
    assert.equal(RRMotionEditor.mirrorPart('LeftUpperLeg'), 'RightUpperLeg');
    assert.equal(RRMotionEditor.mirrorPart('mixamorig:RightHand'), 'mixamorig:LeftHand');
    assert.equal(RRMotionEditor.mirrorPart('Spine'), null);
    const editor = editorWith([
        { part: 'LeftUpperArm', keys: [key(0.5, [10, 20, 30])] },
        { part: 'Spine', keys: [key(0.5, [5, 15, 0])] }
    ]);
    editor.playhead = 0.5;
    editor.mirrorPose();
    const pose = Object.fromEntries(editor.motion.tracks.map(t => [t.part, t.keys.find(k => Math.abs(k.at - 0.5) < 0.01).rotate]));
    assert.deepEqual(plain(pose.RightUpperArm), [10, -20, -30], 'the right arm takes the left\'s turn, mirrored');
    assert.deepEqual(plain(pose.LeftUpperArm), [0, 0, 0], 'the left, with no right to take from, rests');
    assert.deepEqual(plain(pose.Spine).map(v => v + 0), [5, -15, 0], 'the middle turns back the other way');
});

test('a pose copied is put down at another moment, the whole body', () => {
    const editor = editorWith([
        { part: 'LeftUpperArm', keys: [key(0, [0, 0, 0]), key(1, [60, 0, 0])] },
        { part: 'Head', keys: [key(0, [0, 0, 0]), key(1, [0, 30, 0])] }
    ]);
    editor.playhead = 1;
    const copied = plain(editor.poseAtPlayhead());
    editor.playhead = 0.4;
    editor.writePose(copied);
    const at = t => editor.motion.tracks.find(x => x.part === t).keys.find(k => Math.abs(k.at - 0.4) < 0.01).rotate;
    assert.deepEqual(plain(at('LeftUpperArm')), [60, 0, 0]);
    assert.deepEqual(plain(at('Head')), [0, 30, 0]);
});

test('the key-pose view is what opens; the per-part timeline a button away', () => {
    const src = read('editor/src/database/MotionEditor.js');
    assert.match(src, /this\.perPart = false;/);
    assert.match(src, /\$\{this\.perPart \? '' : this\.poseBody\(partName, track, pose, slider\)\}/);
    for (const cls of ['r3d-motion-pose-add', 'r3d-motion-pose-remove', 'r3d-motion-pose-mirror', 'r3d-motion-pose-copy', 'r3d-motion-pose-paste', 'r3d-motion-perpart', 'r3d-motion-backtoposes'])
        assert.ok(src.includes(cls), cls);
});

test('a humanoid adds motion capture first; a state\'s motion replaces what played there; the preview follows', () => {
    const src = read('editor/src/database/Database3DEditor.js');
    const D = { libraryTrigger: id => ({ walk: 'walking', run: 'dashing', jump: 'jumping', fall: 'jumping', swim: 'swimming', tread: 'treading', climbLadder: 'climbing', climbWall: 'climbing' }[id] || 'action') };
    assert.match(src, /static libraryTrigger\(id\) \{\n\s*return \{ walk: 'walking', run: 'dashing', jump: 'jumping', fall: 'jumping', swim: 'swimming', tread: 'treading', climbLadder: 'climbing', climbWall: 'climbing' \}\[id\] \|\| 'action';/);
    assert.equal(D.libraryTrigger('jump'), 'jumping');
    assert.equal(D.libraryTrigger('wave'), 'action');
    assert.match(src, /if \(this\._libraryMotions\(\)\.length\) \{ this\.showMotionPicker\(\); return; \}/);
    assert.match(src, /if \(replaced\.length\) this\.rawAnimations = this\.rawAnimations\.filter\(raw => !\(raw && raw\.trigger === trigger\)\);/);
    assert.match(src, /this\.rawAnimations\.push\(\{ name, type: 'clip', trigger, library: id \}\);/);
    assert.match(src, /if \(trigger !== 'action' && trigger !== 'always' && this\.previewStates\(\)\.includes\(trigger\)\) this\.setPreviewState\(trigger\);/);
    // A state button with a motion open: its own state plays it through, another closes it and shows that state.
    assert.match(src, /if \(editor\.motion\.trigger === state\) \{ editor\.playing = true;[^\n]*\n\s*else \{ editor\.commit\(\); editor\.close\(\); \}/);
    // A motion picked in the list is seen in its state.
    assert.match(src, /if \(raw\.trigger && this\.previewStates\(\)\.includes\(raw\.trigger\) && this\.previewState\(\) !== raw\.trigger\) this\.setPreviewState\(raw\.trigger, \{ keepEditor: true \}\);/);
});
