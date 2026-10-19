'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Body = require('../src/forge/Character3D/HumanBody.js');
const Hair = require('../src/forge/Character3D/CharacterHair.js');

// A broad back plate has no vertices near the center of the locks. The old
// 3 cm vertex-neighborhood fit left the middle buried, showing a root and a
// detached-looking tip. These probes inspect actual hair against the plane;
// they do not call the collision fitter or its triangle-query helper.
test('gathered and loose hair keep their middle outside a broad sparse back plate', async () => {
    const pack = await Body.loadPack(), body = Body.build(pack, { gender: 0 });
    const plate = {
        positions: new Float32Array([-.2, 1.1, -.18, .2, 1.1, -.18, .2, 1.43, -.18, -.2, 1.43, -.18]),
        index: new Uint32Array([0, 1, 2, 0, 2, 3])
    };
    for (const style of ['ponytailLow', 'braid', 'long']) {
        const recipe = { style, length: 1.6 };
        const bare = Hair.build(pack, body, recipe).find(p => p.name === 'Hair');
        const fitted = Hair.build(pack, body, recipe, { outfitParts: [plate] }).find(p => p.name === 'Hair');
        assert.equal(fitted.index.length, bare.index.length, `${style}: keep complete locks`);
        for (let f = 0; f < bare.index.length; f += 3) {
            assert.equal(fitted.index[f], bare.index[f]);
            assert.equal(fitted.index[f + 1] + fitted.index[f + 2], bare.index[f + 1] + bare.index[f + 2], `${style}: only winding may change`);
        }
        assert.equal(fitted.positions.length, bare.positions.length);
        let probes = 0, maxMove = 0;
        for (let v = 0; v < bare.positions.length / 3; v++) {
            const [x, y, z] = bare.positions.subarray(v * 3, v * 3 + 3);
            if (Math.abs(x) < .04 && y > 1.15 && y < 1.34 && z < -.02 && z > -.18) {
                probes++;
                assert.ok(fitted.positions[v * 3 + 2] < -.182, `${style}: middle vertex ${v} lies behind the plate with clearance`);
            }
            if (y > 1.45) for (let c = 0; c < 3; c++) assert.equal(fitted.positions[v * 3 + c], bare.positions[v * 3 + c], `${style}: scalp remains pinned`);
            maxMove = Math.max(maxMove, Math.hypot(...[0, 1, 2].map(c => fitted.positions[v * 3 + c] - bare.positions[v * 3 + c])));
        }
        assert.ok(probes > 200, `${style}: inspect a full middle section`);
        assert.ok(maxMove < .2, `${style}: bounded local drape, ${maxMove} m`);
        for (const key of ['positions', 'normals', 'uvs', 'weights']) assert.ok(fitted[key].every(Number.isFinite), `${style}: finite ${key}`);
    }
});
