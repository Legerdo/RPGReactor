/**
 * RRCharacterGlb - a built character (RRHumanBody.build) as a skinned GLB.
 *
 * The skeleton's bones carry Mixamo's humanoid names, so the 3D Models Rig
 * tool reads every marker, fingers included, from the bones. Bones rest
 * unrotated at their joints; the inverse bind matrices are plain
 * translations. Pictures a part names are embedded from `images`
 * ({fileName: Uint8Array of PNG}).
 *
 * A part: { name, positions, normals, uvs, index, joints, weights } and
 * optionally `colors` (linear RGB per vertex), `color` (hex, when no
 * colors), `roughness`, `metalness`, `doubleSided`, `opacity` (below 1 is
 * blended), `cutout` and `texture` (a name in `images`).
 */
(function(root) {
    'use strict';

    const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const hexColor = hex => {
        const n = parseInt(String(hex || '#ffffff').slice(1), 16);
        return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255), 1];
    };

    const axisAngle = (x, y, z, angle) => { const s = Math.sin(angle / 2); return [x * s, y * s, z * s, Math.cos(angle / 2)]; };
    const multiply = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];

    /**
     * A breathing idle, three seconds round: the arms come down from the
     * modeling A-pose to `armAngle` off vertical (radians) and sway a little,
     * the chest rises and the head settles. Carrying an animation also keeps
     * the skeleton live in the game's model reader, so rig motions drive the
     * file's own bones.
     */
    function idleClip(bones, options) {
        const index = name => bones.findIndex(b => b.name === name);
        const arm = index('LeftArm'), fore = index('LeftForeArm');
        if (arm < 0 || fore < 0) return null;
        const a = bones[arm].head, f = bones[fore].head;
        const current = Math.atan2(Math.abs(f[0] - a[0]), a[1] - f[1]);
        const lower = current - (options.armAngle ?? 0.2);
        const steps = 13, period = 3;
        const times = new Float32Array(steps);
        for (let i = 0; i < steps; i++) times[i] = (period * i) / (steps - 1);
        const tracks = [];
        const track = (name, at) => {
            const bone = index(name);
            if (bone < 0) return;
            const values = new Float32Array(steps * 4);
            for (let i = 0; i < steps; i++) values.set(at(Math.sin((2 * Math.PI * i) / (steps - 1))), i * 4);
            tracks.push({ bone, values });
        };
        // Character's left is +x: lowering the left arm turns it about -z.
        track('LeftArm', w => multiply(axisAngle(0, 0, 1, -lower - 0.015 * w), axisAngle(1, 0, 0, -0.05)));
        track('RightArm', w => multiply(axisAngle(0, 0, 1, lower + 0.015 * w), axisAngle(1, 0, 0, -0.05)));
        // Elbows a little bent, the hands relaxed at the sides: the bend about each elbow's own hinge (square
        // to the arm's rest plane), the rest pose's own bend (hands well forward) taken off.
        for (const side of ['Left', 'Right']) {
            const u0 = bones[index(side + 'Arm')], u1 = bones[index(side + 'ForeArm')], u2 = bones[index(side + 'Hand')];
            if (!u0 || !u1) continue;
            const u = [0, 1, 2].map(k => u1.head[k] - u0.head[k]), f = u2 ? [0, 1, 2].map(k => u2.head[k] - u1.head[k]) : u;
            let ax = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]], l = Math.hypot(ax[0], ax[1], ax[2]);
            const rest = l > 1e-6 ? Math.atan2(l, u[0] * f[0] + u[1] * f[1] + u[2] * f[2]) : 0;
            if (l < 1e-6) { ax = [u[1], -u[0], 0]; l = Math.hypot(ax[0], ax[1]) || 1; }
            track(side + 'ForeArm', () => axisAngle(ax[0] / l, ax[1] / l, ax[2] / l, 0.35 - rest));
        }
        track('Spine1', w => axisAngle(1, 0, 0, -0.012 * w));
        track('Spine2', w => axisAngle(1, 0, 0, -0.018 * w));
        track('Head', w => axisAngle(1, 0, 0, 0.012 * w));
        return { times, tracks };
    }

    function toGlb(built, options) {
        const settings = options || {};
        const images = settings.images || {};
        const json = {
            asset: { version: '2.0', generator: 'RPG Reactor Character Builder' },
            scene: 0, scenes: [{ name: settings.name || 'Character', nodes: [] }],
            nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [], skins: []
        };
        const blobs = [];
        let length = 0;
        const view = (typed, target) => {
            const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
            const pad = (4 - (length % 4)) % 4;
            if (pad) { blobs.push(new Uint8Array(pad)); length += pad; }
            json.bufferViews.push(Object.assign({ buffer: 0, byteOffset: length, byteLength: bytes.length }, target ? { target } : {}));
            blobs.push(bytes); length += bytes.length;
            return json.bufferViews.length - 1;
        };
        const accessor = (typed, type, componentType, target, extra) => {
            json.accessors.push(Object.assign({ bufferView: view(typed, target), componentType, count: typed.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]), type }, extra || {}));
            return json.accessors.length - 1;
        };
        const bounds = positions => {
            const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
                min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]);
            }
            return { min, max };
        };

        // Bones first: node i is bone i.
        const bones = built.bones;
        bones.forEach((bone, i) => {
            const parent = bone.parent >= 0 ? bones[bone.parent].head : [0, 0, 0];
            json.nodes.push({ name: bone.name, translation: [0, 1, 2].map(k => bone.head[k] - parent[k]) });
            if (bone.parent >= 0) (json.nodes[bone.parent].children = json.nodes[bone.parent].children || []).push(i);
        });
        const inverseBind = new Float32Array(bones.length * 16);
        bones.forEach((bone, i) => {
            const m = i * 16;
            inverseBind[m] = inverseBind[m + 5] = inverseBind[m + 10] = inverseBind[m + 15] = 1;
            inverseBind[m + 12] = -bone.head[0]; inverseBind[m + 13] = -bone.head[1]; inverseBind[m + 14] = -bone.head[2];
        });
        json.skins.push({ name: 'Skeleton', skeleton: 0, joints: bones.map((_, i) => i), inverseBindMatrices: accessor(inverseBind, 'MAT4', 5126) });
        json.scenes[0].nodes.push(0);

        const imageIndex = new Map();
        const textureFor = name => {
            if (!images[name]) return null;
            if (!imageIndex.has(name)) {
                json.images = json.images || []; json.textures = json.textures || []; json.samplers = json.samplers || [{ magFilter: 9729, minFilter: 9987 }];
                json.images.push({ name, mimeType: 'image/png', bufferView: view(images[name]) });
                json.textures.push({ sampler: 0, source: json.images.length - 1 });
                imageIndex.set(name, json.textures.length - 1);
            }
            return imageIndex.get(name);
        };

        for (const part of built.parts) {
            const texture = part.texture ? textureFor(part.texture) : null;
            const base = part.texture || part.colors ? [1, 1, 1, 1] : hexColor(part.color);
            if (part.opacity != null && part.opacity < 1) base[3] = part.opacity;
            const material = {
                name: part.name,
                pbrMetallicRoughness: { baseColorFactor: base, metallicFactor: part.metalness ?? 0, roughnessFactor: part.roughness ?? 0.6 }
            };
            if (texture !== null) material.pbrMetallicRoughness.baseColorTexture = { index: texture };
            if (part.cutout) { material.alphaMode = 'MASK'; material.alphaCutoff = part.alphaCutoff ?? 0.5; }
            // `blend`: blended by its picture's own alpha (Slimefolk goo).
            else if (base[3] < 1 || part.blend) material.alphaMode = 'BLEND';
            if (part.doubleSided) material.doubleSided = true;
            // A relief picture (`normalTexture`, a name in `images`), at `normalScale`.
            const normal = part.normalTexture ? textureFor(part.normalTexture) : null;
            if (normal !== null) material.normalTexture = Object.assign({ index: normal }, part.normalScale != null ? { scale: part.normalScale } : {});
            json.materials.push(material);
            const b = bounds(part.positions);
            const big = part.positions.length / 3 > 65535;
            const primitive = {
                attributes: {
                    POSITION: accessor(Float32Array.from(part.positions), 'VEC3', 5126, 34962, b),
                    NORMAL: accessor(Float32Array.from(part.normals), 'VEC3', 5126, 34962),
                    TEXCOORD_0: accessor(Float32Array.from(part.uvs || new Float32Array(part.positions.length / 3 * 2)), 'VEC2', 5126, 34962),
                    JOINTS_0: accessor(Uint8Array.from(part.joints), 'VEC4', 5121, 34962),
                    WEIGHTS_0: accessor(Float32Array.from(part.weights), 'VEC4', 5126, 34962)
                },
                indices: accessor(big ? Uint32Array.from(part.index) : Uint16Array.from(part.index), 'SCALAR', big ? 5125 : 5123, 34963),
                material: json.materials.length - 1
            };
            if (part.colors) primitive.attributes.COLOR_0 = accessor(Float32Array.from(part.colors), 'VEC3', 5126, 34962);
            const mesh = { name: part.name, primitives: [primitive] };
            // Expressions hook: the face's named morph targets (built.morphs, RRCharacterExpressions.morphTargets) as
            // sparse position deltas; a target that leaves this part still has its slot, all zero.
            const partIndex = built.parts.indexOf(part);
            const own = (built.morphs || []).map(t => t.parts.find(e => e.part === partIndex) || null);
            if (own.some(Boolean)) {
                const count = part.positions.length / 3;
                primitive.targets = own.map(entry => {
                    if (!entry || !entry.indices.length) { json.accessors.push({ componentType: 5126, count, type: 'VEC3', min: [0, 0, 0], max: [0, 0, 0] }); return { POSITION: json.accessors.length - 1 }; }
                    const min = [0, 0, 0], max = [0, 0, 0];
                    for (let i = 0; i < entry.deltas.length; i++) { min[i % 3] = Math.min(min[i % 3], entry.deltas[i]); max[i % 3] = Math.max(max[i % 3], entry.deltas[i]); }
                    const small = count <= 65535;
                    json.accessors.push({
                        componentType: 5126, count, type: 'VEC3', min, max,
                        sparse: { count: entry.indices.length, indices: { bufferView: view(small ? Uint16Array.from(entry.indices) : Uint32Array.from(entry.indices)), componentType: small ? 5123 : 5125 }, values: { bufferView: view(Float32Array.from(entry.deltas)) } }
                    });
                    return { POSITION: json.accessors.length - 1 };
                });
                mesh.weights = own.map(() => 0);
                mesh.extras = { targetNames: built.morphs.map(t => t.name) };
            }
            json.meshes.push(mesh);
            json.nodes.push({ name: part.name, mesh: json.meshes.length - 1, skin: 0 });
            json.scenes[0].nodes.push(json.nodes.length - 1);
        }
        // Clips: `clips` ([{ name, times, tracks: [{ bone, values, path? }] }]) as given, else the humanoid Idle. A track's
        // values are quaternions, or with path 'translation' positions (relative to the bone's parent), or with path 'scale' scales.
        const clips = settings.clips || [idleClip(bones, settings.idle || {})].filter(Boolean).map(c => Object.assign({ name: 'Idle' }, c));
        for (const clip of clips) {
            const times = accessor(Float32Array.from(clip.times), 'SCALAR', 5126, null, { min: [clip.times[0]], max: [clip.times[clip.times.length - 1]] });
            const animation = { name: clip.name, channels: [], samplers: [] };
            // A track may carry its own `times` (cloth keys at their own rate); tracks sharing one array share its accessor.
            const ownTimes = new Map();
            for (const track of clip.tracks) {
                const moves = track.path === 'translation' || track.path === 'scale';
                const input = !track.times ? times : ownTimes.get(track.times) ?? ownTimes.set(track.times, accessor(Float32Array.from(track.times), 'SCALAR', 5126, null, { min: [track.times[0]], max: [track.times[track.times.length - 1]] })).get(track.times);
                animation.samplers.push({ input, output: accessor(Float32Array.from(track.values), moves ? 'VEC3' : 'VEC4', 5126), interpolation: 'LINEAR' });
                animation.channels.push({ sampler: animation.samplers.length - 1, target: { node: track.bone, path: moves ? track.path : 'rotation' } });
            }
            (json.animations = json.animations || []).push(animation);
        }
        json.buffers.push({ byteLength: length });

        const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
        const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
        const binPad = (4 - (length % 4)) % 4;
        const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + length + binPad;
        const out = new Uint8Array(total);
        const dv = new DataView(out.buffer);
        dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
        dv.setUint32(12, jsonBytes.length + jsonPad, true); dv.setUint32(16, 0x4E4F534A, true);
        out.set(jsonBytes, 20);
        for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.length + i] = 0x20;
        let cursor = 20 + jsonBytes.length + jsonPad;
        dv.setUint32(cursor, length + binPad, true); dv.setUint32(cursor + 4, 0x004E4942, true);
        cursor += 8;
        for (const blob of blobs) { out.set(blob, cursor); cursor += blob.length; }
        return out;
    }

    const api = { toGlb, idleClip, axisAngle, multiply };
    root.RRCharacterGlb = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
