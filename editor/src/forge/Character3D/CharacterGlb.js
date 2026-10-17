/**
 * RRCharacterGlb - a built character (RRHumanBody.build) as a skinned GLB.
 *
 * The skeleton's bones carry Mixamo's humanoid names, so the 3D Models Rig
 * tool reads every marker, fingers included, from the bones. Bones rest
 * unrotated at their joints; the inverse bind matrices are plain
 * translations. Pictures a part names are embedded from `images`
 * ({fileName: Uint8Array of PNG}).
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
        // Elbows a little bent, hands forward.
        track('LeftForeArm', () => axisAngle(1, 0, 0, -0.2));
        track('RightForeArm', () => axisAngle(1, 0, 0, -0.2));
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
            const material = {
                name: part.name,
                pbrMetallicRoughness: { baseColorFactor: part.texture ? [1, 1, 1, 1] : hexColor(part.color), metallicFactor: 0, roughnessFactor: part.roughness ?? 0.6 }
            };
            if (texture !== null) material.pbrMetallicRoughness.baseColorTexture = { index: texture };
            if (part.cutout) { material.alphaMode = 'MASK'; material.alphaCutoff = 0.5; }
            json.materials.push(material);
            const b = bounds(part.positions);
            const big = part.positions.length / 3 > 65535;
            const primitive = {
                attributes: {
                    POSITION: accessor(Float32Array.from(part.positions), 'VEC3', 5126, 34962, b),
                    NORMAL: accessor(Float32Array.from(part.normals), 'VEC3', 5126, 34962),
                    TEXCOORD_0: accessor(Float32Array.from(part.uvs), 'VEC2', 5126, 34962),
                    JOINTS_0: accessor(Uint8Array.from(part.joints), 'VEC4', 5121, 34962),
                    WEIGHTS_0: accessor(Float32Array.from(part.weights), 'VEC4', 5126, 34962)
                },
                indices: accessor(big ? Uint32Array.from(part.index) : Uint16Array.from(part.index), 'SCALAR', big ? 5125 : 5123, 34963),
                material: json.materials.length - 1
            };
            json.meshes.push({ name: part.name, primitives: [primitive] });
            json.nodes.push({ name: part.name, mesh: json.meshes.length - 1, skin: 0 });
            json.scenes[0].nodes.push(json.nodes.length - 1);
        }
        const idle = idleClip(bones, settings.idle || {});
        if (idle) {
            const times = accessor(idle.times, 'SCALAR', 5126, null, { min: [idle.times[0]], max: [idle.times[idle.times.length - 1]] });
            const animation = { name: 'Idle', channels: [], samplers: [] };
            for (const track of idle.tracks) {
                animation.samplers.push({ input: times, output: accessor(track.values, 'VEC4', 5126), interpolation: 'LINEAR' });
                animation.channels.push({ sampler: animation.samplers.length - 1, target: { node: track.bone, path: 'rotation' } });
            }
            json.animations = [animation];
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

    const api = { toGlb };
    root.RRCharacterGlb = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
