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

test('the storyboard: the seconds between poses are the timing; a gap changed moves every pose after it', () => {
    const editor = editorWith([
        { part: 'LeftUpperArm', keys: [key(0, [0, 0, 0]), key(0.5, [40, 0, 0]), key(1, [0, 0, 0])] },
        { part: 'Head', keys: [key(0, [0, 0, 0]), key(0.5, [0, 20, 0]), key(1, [0, 0, 0])] }
    ], 60);
    assert.equal(editor.seconds(), 1);
    assert.equal(editor.gapAfter(0), 0.5);
    assert.equal(editor.gapAfter(2), 0, 'the last pose stands at the end');
    editor.setGap(0, 0.2);
    assert.equal(Math.round(editor.seconds() * 100) / 100, 0.7, 'the motion shrinks by what the gap lost');
    assert.equal(editor.gapAfter(0), 0.2);
    assert.equal(editor.gapAfter(1), 0.5, 'the gap after it keeps its seconds');
    assert.equal(editor.poseTimes().length, 3);
});

test('the next pose is a copy of the one shown, a beat on; a pose deleted closes the gap', () => {
    const editor = editorWith([
        { part: 'LeftUpperArm', keys: [key(0, [30, 0, 0]), key(1, [0, 0, 0])] }
    ], 60);
    editor.playhead = 0;
    const at = editor.insertPose(0, 0.3);
    assert.equal(Math.round(editor.seconds() * 100) / 100, 1.3);
    assert.equal(editor.poseTimes().length, 3);
    assert.equal(editor.gapAfter(0), 0.3);
    assert.equal(editor.gapAfter(1), 1, 'what followed keeps its seconds');
    const copy = editor.motion.tracks[0].keys.find(k => Math.abs(k.at - at) < 0.01);
    assert.deepEqual(plain(copy.rotate), [30, 0, 0], 'a copy of the pose it follows');
    editor.deletePose(1);
    assert.equal(editor.poseTimes().length, 2);
    assert.equal(Math.round(editor.seconds() * 100) / 100, 1);
    // An empty motion's first pose is wherever the first part is bent.
    const empty = editorWith([], 18);
    assert.equal(empty.insertPose(0), 0);
});

test('a part picked joins at rest in every pose, so bending it in one leaves the others alone', () => {
    const editor = editorWith([{ part: 'Head', keys: [key(0, [0, 0, 0]), key(0.5, [0, 20, 0])] }]);
    editor.pickPart('LeftUpperArm');
    const arm = editor.motion.tracks.find(t => t.part === 'LeftUpperArm');
    assert.deepEqual(arm.keys.map(k => k.at), [0, 0.5]);
});

test('the storyboard is what opens: pose cards, the seconds between, + for the next; the per-part timeline a link away', () => {
    const src = read('editor/src/database/MotionEditor.js');
    assert.match(src, /this\.perPart = false;/);
    assert.match(src, /\$\{this\.perPart \? '' : this\.poseBody\(partName, track, pose, slider\)\}/);
    for (const cls of ['r3d-motion-board', 'r3d-motion-card', 'r3d-motion-card-add', 'r3d-motion-gap-sec', 'r3d-motion-pose-remove', 'r3d-motion-pose-mirror', 'r3d-motion-pose-copy', 'r3d-motion-pose-paste', 'r3d-motion-perpart', 'r3d-motion-backtoposes'])
        assert.ok(src.includes(cls), cls);
    assert.ok(!src.includes('r3d-motion-posekey'), 'no strip of numbered dots to drag');
    // The part being bent is lit on the model.
    assert.match(src, /this\.host\._markMotionPart\?\.\(track && !track\.other \? track\.part : null\);/);
    const host = read('editor/src/database/Database3DEditor.js');
    assert.match(host, /_markMotionPart\(part\) \{/);
    assert.match(host, /fit\(this\._motionPartBox, this\._motionPart \? this\._matchedMeshes\(this\._motionPart\) : \(\(this\._binding && this\._binding\.meshes\) \|\| \[\]\), false\);/);
});

test('the picker is themed and offers no hand-keyed presets', () => {
    const src = read('editor/src/database/Database3DEditor.js');
    assert.ok(!src.includes('r3d-picker-keyed'));
    assert.ok(!/rr-btn-primary r3d-picker/.test(src), 'no unstyled primary button');
    assert.match(src, /class="rr-btn-chip r3d-picker-add"/);
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
