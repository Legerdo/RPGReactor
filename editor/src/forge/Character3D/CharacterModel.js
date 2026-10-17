/**
 * RRCharacterModel - a whole character from its recipe: the body, its skin
 * and eyes, the outfit, the hair, accessories and species features; or a
 * four-legged creature. The builder page draws what this returns and Save
 * writes it to a GLB; the node tests check it.
 *
 * A recipe: { plan: 'human' | 'quadruped', name?, seed?, ...body sliders,
 * species, features, skinPattern, eyes, hair, outfit, props } for a human
 * (see RRHumanBody, RRCharacterSpecies, RRCharacterSkin, RRCharacterHair,
 * RRCharacterWardrobe, RRCharacterProps), or RRCreatureBody's recipe.
 *
 * Results: { parts, bones, height, textures: { name: {width, height, data} },
 * clips, sidecar? }. Pictures depend on their settings only and are kept in
 * the cache between builds, so moving a body slider repaints nothing.
 */
(function(root) {
    'use strict';

    const need = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
    const Body = need('RRHumanBody', './HumanBody.js');
    const Glb = need('RRCharacterGlb', './CharacterGlb.js');
    const Hair = need('RRCharacterHair', './CharacterHair.js');
    const Wardrobe = need('RRCharacterWardrobe', './CharacterWardrobe.js');
    const Props = need('RRCharacterProps', './CharacterProps.js');
    const Species = need('RRCharacterSpecies', './CharacterSpecies.js');
    const Skin = need('RRCharacterSkin', './CharacterSkin.js');
    const Creature = need('RRCreatureBody', './CreatureBody.js');
    const Shading = need('RRCharacterShading', './CharacterShading.js');
    const Detail = need('RRCharacterDetail', './CharacterDetail.js');

    /** A full recipe from a partial one; the plan decides which half it is. */
    function normalize(input) {
        const r = input || {};
        if (r.plan === 'quadruped') return Object.assign(Creature.normalizeRecipe(r), { plan: 'quadruped' });
        const body = Body.normalizeRecipe(r);
        return Object.assign(body, {
            plan: 'human',
            species: Species.BY_ID.has(r.species) ? r.species : 'human',
            features: Species.normalizeFeatures(r.features),
            skinPattern: Skin.normalizeSkin(r.skinPattern),
            eyes: Skin.normalizeEyes(r.eyes),
            // A pattern without regions of its own: a woman's Natural and Light are a woman's.
            bodyHair: Skin.normalizeBodyHair(r.bodyHair && !r.bodyHair.regions && Body.sexOf(body) === 'female' && Skin.HAIR_PRESETS[(r.bodyHair.pattern || 'natural') + 'Female']
                ? Object.assign({}, r.bodyHair, { regions: Skin.HAIR_PRESETS[(r.bodyHair.pattern || 'natural') + 'Female'] }) : r.bodyHair),
            hair: Hair.normalizeHair(r.hair || (r.bald ? { style: 'bald', brows: { style: 'none' } } : undefined)),
            outfit: Wardrobe.normalizeOutfit(r.outfit),
            props: Props.normalizeProps(r.props)
        });
    }

    /**
     * A species applied to a recipe: the species' preset over the average
     * body, the old recipe's gender, age, ancestry, outfit and accessories
     * kept. Hair follows the species when it is bald by nature.
     */
    function withSpecies(recipe, id) {
        const old = normalize(recipe);
        const preset = Species.speciesRecipe(id);
        const next = Object.assign({}, preset, {
            plan: 'human', gender: old.gender, age: preset.age ?? old.age, ancestry: old.ancestry,
            bodyHair: preset.bodyHair || (Species.BY_ID.get(old.species)?.recipe || {}).bodyHair ? (preset.bodyHair || {}) : old.bodyHair,
            outfit: old.outfit, props: (preset.props || []).concat(old.props.filter(p => !(preset.props || []).some(q => q.id === p.id))),
            // Hair follows a species bald by nature; leaving one, the hair grows back.
            hair: preset.hair ? Object.assign({}, old.hair, preset.hair) : preset.bald ? { style: 'bald', brows: { style: 'none' }, lashes: false }
                : (Species.BY_ID.get(old.species)?.recipe || {}).bald ? Hair.randomHair(((old.seed ?? 1) ^ 0x5bd1e995) >>> 0, { gender: old.gender > 0.5 ? 'male' : 'female' }) : old.hair
        });
        if (old.seed != null) next.seed = old.seed;
        return normalize(next);
    }

    const HAIR_COVERS = new Set(['helm', 'greathelm', 'visorhelm', 'hood', 'hoodie']);
    const FACE_COVERS = new Set(['greathelm', 'visorhelm']);

    function textureKey(name, settings) { return name + ':' + JSON.stringify(settings); }

    /**
     * Builds a character. `cache` (an object kept by the caller) holds the
     * outfit's cut and picture and the painted skin and eyes; `options`:
     * { quality: 'preview'|'save', eyeSource: {width, height, data} (the
     * eye picture's RGBA), skinSize, atlasSize }.
     */
    function build(pack, recipe, cache, options) {
        cache = cache || {};
        const o = options || {};
        const r = normalize(recipe);
        if (r.plan === 'quadruped') {
            const built = Creature.build(r, { quality: o.quality || 'save', hairBudget: o.hairBudget });
            if (o.quality === 'save' || o.quality == null || o.shade) shade(built.parts);
            return { recipe: r, parts: built.parts, bones: built.bones, height: built.height, textures: built.textures || {}, clips: built.clips, sidecar: Creature.sidecar(built), plan: 'quadruped' };
        }
        const built = Body.build(pack, r);
        const textures = {};

        // The outfit, and the skin it covers left out.
        cache.wardrobe = cache.wardrobe || {};
        if (o.atlasSize) cache.wardrobe.atlasSize = o.atlasSize;
        const outfit = Wardrobe.build(pack, built, r.outfit, cache.wardrobe);
        if (outfit.texture) textures[outfit.texture.name] = outfit.texture;
        for (const t of outfit.textures || []) textures[t.name] = t;

        // The body: its painted skin, the covered triangles dropped.
        const body = Object.assign({}, built.parts[0]);
        if (outfit.hidden.size) {
            const keep = [];
            const src = pack.body.source, I = body.index;
            for (let t = 0; t < I.length; t += 3) {
                if (outfit.hidden.has(src[I[t]]) && outfit.hidden.has(src[I[t + 1]]) && outfit.hidden.has(src[I[t + 2]])) continue;
                keep.push(I[t], I[t + 1], I[t + 2]);
            }
            body.index = Uint32Array.from(keep);
        }
        // The skin picture: 1024 in the view (painted once per skin setting), 2048 in a saved file.
        const skinSize = o.skinSize || (o.quality === 'preview' ? 1024 : 2048);
        // A man's shaved beard shadows his jaw, unless his species has no hair.
        const beard = r.gender > 0.6 && r.age > 16 && !(Species.BY_ID.get(r.species)?.recipe || {}).bald ? Math.round((r.gender - 0.6) * 2.5 * 10) / 10 : 0;
        const sex = Body.sexOf(r);
        const anatomy = { detail: r.anatomy.detail, female: sex === 'female', cup: 0, areola: r.anatomy.areola, areolaColor: r.anatomy.areolaColor, fold: r.anatomy.fold };
        const bodyHair = Object.assign({}, r.bodyHair, { color: r.bodyHair.color || r.hair.color });
        const earHoles = r.morph.earsAway > 0.6 && r.morph.earHoles > 0;
        // A style with hair over the scalp colors the scalp under it (not for the shortest crops or a bald head).
        const scalp = r.hair.style !== 'bald' && !['buzz'].includes(r.hair.style) && !r.outfit.some(i => HAIR_COVERS.has(i.id)) ? { color: r.hair.color, recede: r.hair.hairline || 0 } : null;
        const skinKey = textureKey('skin', [r.skin, r.skinPattern, skinSize, beard, anatomy, bodyHair, earHoles, scalp]);
        if (cache.skinKey !== skinKey) {
            const args = { skin: r.skin, pattern: r.skinPattern, options: { size: skinSize, beard, anatomy, bodyHair, earHoles, scalp } };
            // A painter off the page (the builder's worker) answers later; until then the last skin stays.
            const painted = o.paintSkin ? o.paintSkin(skinKey, args) : Skin.paint(pack, args.skin, args.pattern, args.options);
            if (painted) { cache.skin = painted; cache.skinKey = skinKey; }
            else if (!cache.skin) cache.skin = flatPicture(r.skin);
        }
        textures['skin.png'] = cache.skin;
        body.texture = 'skin.png';
        body.roughness = r.skinPattern.type === 'scales' || r.skinPattern.type === 'panels' ? 0.45 : 0.62;

        const eyes = Object.assign({}, built.parts[1], { roughness: 0.25, cutout: true });
        if (o.eyeSource) {
            const eyeKey = textureKey('eyes', r.eyes);
            if (cache.eyeKey !== eyeKey) {
                cache.eyes = { width: o.eyeSource.width, height: o.eyeSource.height, data: Skin.paintEyes(o.eyeSource.data, o.eyeSource.width, r.eyes), name: 'eyes.png' };
                cache.eyeKey = eyeKey;
            }
            textures['eyes.png'] = cache.eyes;
            eyes.texture = 'eyes.png';
        }

        const parts = [body, eyes];
        // Body hair and fur: strands grown out of the uncovered skin.
        const skinNormals = Body.vertexNormals(pack, built.shaped);
        // Body hair: single strands where it grows; fur: dense tufts over it.
        const budget = o.hairBudget || 1;
        if (bodyHair.amount > 0.01) {
            // In clumps of fine hairs, like locks of head hair: many hairs to a card.
            const strands = Detail.hairStrands(pack, Object.assign({}, bodyHair, { budget }), outfit.hidden, 'clump');
            if (strands.length) {
                textures['bodyhair.png'] = cache.bodyHairTex || (cache.bodyHairTex = Detail.bodyHairTexture(256));
                parts.push(Detail.hairPart(pack, built.shaped, skinNormals, strands, bodyHair.color, { mode: 'clump', skin: r.skin }));
            }
        }
        if (bodyHair.fur > 0.05) {
            const tufts = Detail.hairStrands(pack, Object.assign({}, bodyHair, { amount: Math.max(bodyHair.amount, bodyHair.fur), budget }), outfit.hidden, 'tuft');
            if (tufts.length) {
                textures['bodyhair.png'] = cache.bodyHairTex || (cache.bodyHairTex = Detail.bodyHairTexture(256));
                parts.push(Detail.hairPart(pack, built.shaped, skinNormals, tufts, bodyHair.color, { width: 1 + bodyHair.fur, name: 'Fur', skin: r.skin }));
            }
        }
        // The areolas: their own patch with its own picture, sharp at any distance.
        if (r.anatomy.detail && !outfit.hidden.has(Body.anatomyFields(pack).nipples[0].v)) {
            const reach = (sex === 'female' ? 0.026 : 0.014) * r.anatomy.areola;
            const nip = Body.anatomyFields(pack).nipples[0].v;
            const cover = bodyHair.amount > 0.01 || bodyHair.fur > 0.05 ? Skin.hairCover(bodyHair, Skin.hairField(pack, bodyHair.regions)[nip]) : 0;
            const areolaKey = textureKey('areola', [r.skin, r.anatomy.areolaColor, r.anatomy.nipple, sex, cover.toFixed(3), bodyHair.color]);
            if (cache.areolaKey !== areolaKey) { cache.areola = Detail.areolaTexture(r.skin, { color: r.anatomy.areolaColor, nippleScale: Math.sqrt(r.anatomy.nipple), male: sex === 'male', under: bodyHair.color, cover }); cache.areolaKey = areolaKey; }
            textures['areola.png'] = cache.areola;
            parts.push(Detail.areolaPart(pack, built.shaped, skinNormals, reach, body));
        }
        // A man's genitals, MakeHuman's own, wearing the skin round them; left out under what covers them.
        if (r.anatomy.detail && sex === 'male' && !outfit.hidden.has(Body.anatomyFields(pack).low)) parts.push(genitals(pack, built));
        // Under a helmet or a hood the hair is not drawn; under a closed helmet the beard neither.
        const covers = r.outfit.map(i => i.id);
        let hairRecipe = r.hair;
        if (covers.some(id => HAIR_COVERS.has(id))) {
            const closed = covers.some(id => FACE_COVERS.has(id));
            hairRecipe = Object.assign({}, r.hair, { style: 'bald', facial: closed ? Object.assign({}, r.hair.facial, { style: 'none' }) : r.hair.facial });
        }
        const hair = Hair.build(pack, built, hairRecipe, { seed: r.seed, skin: r.skin });
        if (hair.some(p => p.texture === 'lashes.png')) textures['lashes.png'] = cache.lashes || (cache.lashes = Hair.lashTexture(128));
        if (hair.some(p => p.texture === 'hair.png')) textures['hair.png'] = cache.hairStrands || (cache.hairStrands = Hair.hairTexture(256));
        if (hair.some(p => p.texture === 'brows.png')) {
            const browKey = JSON.stringify([hairRecipe.brows, hairRecipe.color]);
            if (cache.browKey !== browKey) { cache.brows = Hair.browTexture(Hair.normalizeHair(hairRecipe).brows, (hairRecipe.brows && hairRecipe.brows.color) || hairRecipe.color); cache.browKey = browKey; }
            textures['brows.png'] = cache.brows;
        }
        const L = Props.landmarks(pack, built);
        const props = Props.build(pack, built, r.props);
        const features = Species.build(pack, built, r.features, L);
        // What each part is, for the view's materials: skin, eyes, cloth, metal, hair, a prop.
        body.kind = 'skin'; eyes.kind = 'eye';
        for (const p of outfit.parts) p.kind = p.metalness > 0.5 ? 'metal' : 'cloth';
        for (const p of hair) p.kind = 'hair';
        for (const p of props.parts) p.kind = p.opacity != null && p.opacity < 1 ? 'glass' : p.metalness > 0.5 ? 'metal' : 'prop';
        for (const p of features.parts) p.kind = p.kind || 'feature';
        if (features.parts.some(p => p.texture === 'feather.png')) textures['feather.png'] = cache.feather || (cache.feather = Species.featherTexture());
        if (features.parts.some(p => p.texture === 'fairywing.png')) textures['fairywing.png'] = cache.fairyWing || (cache.fairyWing = Species.fairyWingTexture());
        parts.push(...outfit.parts, ...hair, ...props.parts, ...features.parts);
        const bones = built.bones.concat(features.bones.map(b => ({ name: b.name, parent: b.parent, head: b.head, tail: b.tail })));
        // The floor: shoes and boots stand on it.
        let floor = 0;
        for (const p of parts) for (let i = 1; i < p.positions.length; i += 3) floor = Math.min(floor, p.positions[i]);
        if (floor < -1e-4) {
            for (let k = 0; k < parts.length; k++) {
                const q = parts[k] = Object.assign({}, parts[k], { positions: Float32Array.from(parts[k].positions) });
                for (let i = 1; i < q.positions.length; i += 3) q.positions[i] -= floor;
            }
            for (const b of bones) { b.head = [b.head[0], b.head[1] - floor, b.head[2]]; if (b.tail) b.tail = [b.tail[0], b.tail[1] - floor, b.tail[2]]; }
        }
        let height = 0;
        for (const p of parts) for (let i = 1; i < p.positions.length; i += 3) height = Math.max(height, p.positions[i]);
        // Occlusion in the vertex colors: always in a file, in the view once the sliders rest (`shade`).
        if (o.quality === 'save' || o.shade) shade(parts);
        return { recipe: r, parts, bones, height, bodyHeight: built.height - Math.min(0, floor), textures, clips: clipsFor(bones, r, built, pack), plan: 'human', built };
    }

    /**
     * Fur shells: the body's triangles where fur grows (alpha in the picture
     * at any of their corners), lifted along the skin's normals.
     */
    function furShells(pack, built, body, bodyHair, picture) {
        const P = body.positions, N = body.normals, U = body.uvs, I = body.index;
        const size = picture.width;
        const alphaAt = i => picture.data[((Math.min(size - 1, Math.floor(U[i * 2 + 1] * size)) * size) + Math.min(size - 1, Math.floor(U[i * 2] * size))) * 4 + 3];
        // Not on the head: the face's fur is partial by nature (clear round the eyes, nose and mouth), and
        // shells there break into patches; it stays painted.
        const an = (root.RRCharacterOutfit || require('./CharacterOutfit.js')).anatomy(pack), src = pack.body.source;
        const onHead = i => an.member[src[i] * 5] > 0.6 && an.s[src[i] * 5] > 4.3;
        const keep = [];
        for (let t = 0; t < I.length; t += 3) {
            if (onHead(I[t]) || onHead(I[t + 1]) || onHead(I[t + 2])) continue;
            if (alphaAt(I[t]) > 20 || alphaAt(I[t + 1]) > 20 || alphaAt(I[t + 2]) > 20) keep.push(I[t], I[t + 1], I[t + 2]);
        }
        if (!keep.length) return [];
        const reach = 0.004 + 0.008 * bodyHair.fur * bodyHair.length;
        return [[0.45, 0.3], [1, 0.62]].map(([at, cut], k) => {
            const positions = new Float32Array(P.length);
            for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) positions[i + c] = P[i + c] + N[i + c] * reach * at;
            return { name: 'Fur ' + (k + 1), positions, normals: N, uvs: U, index: Uint32Array.from(keep), joints: body.joints, weights: body.weights, texture: 'fur.png', cutout: true, alphaCutoff: cut, roughness: 0.8, kind: 'hair', doubleSided: true };
        });
    }

    /** The genital helper as a part: its vertices take the picture coordinates of the skin nearest them. */
    function genitals(pack, built) {
        const h = pack.helpers.genital;
        if (!pack._genitalUV) {
            const B = pack.positions, body = pack.body, uv = new Float32Array(h.source.length * 2);
            h.source.forEach((v, i) => {
                let best = 0, bd = Infinity;
                for (let k = 0; k < body.source.length; k++) {
                    const u = body.source[k];
                    const d = (B[u * 3] - B[v * 3]) ** 2 + (B[u * 3 + 1] - B[v * 3 + 1]) ** 2 + (B[u * 3 + 2] - B[v * 3 + 2]) ** 2;
                    if (d < bd) { bd = d; best = k; }
                }
                uv[i * 2] = body.uv[best * 2]; uv[i * 2 + 1] = body.uv[best * 2 + 1];
            });
            pack._genitalUV = uv;
        }
        const P = built.shaped;
        return {
            name: 'Genitals', positions: Body.gather(P, h.source, 3), normals: Body.normals(P, h.source, h.index, pack.vertexCount), uvs: pack._genitalUV, index: h.index,
            joints: Body.gather(pack.skinJoints, h.source, 4), weights: Body.gather(pack.skinWeights, h.source, 4), texture: 'skin.png', roughness: 0.6, kind: 'skin'
        };
    }

    /** A tiny picture of one color: the skin before its own is painted. */
    function flatPicture(hex) {
        const n = parseInt(String(hex || '#c69c7f').slice(1), 16), data = new Uint8Array(4 * 4 * 4);
        for (let i = 0; i < 16; i++) { data[i * 4] = (n >> 16) & 255; data[i * 4 + 1] = (n >> 8) & 255; data[i * 4 + 2] = n & 255; data[i * 4 + 3] = 255; }
        return { width: 4, height: 4, data, name: 'skin.png' };
    }

    /** Bakes ambient occlusion into the parts' colors, in place. */
    function shade(parts) {
        const ao = Shading.ambientOcclusion(parts);
        // The eyes sit inside the lids: occlusion would black them out, so they keep their own light.
        parts.forEach((p, k) => { if (p.kind === 'eye' || p.name === 'Eyes') delete ao[k]; });
        const shaded = Shading.applyOcclusion(parts, ao);
        for (let k = 0; k < parts.length; k++) parts[k] = shaded[k];
        return parts;
    }

    /**
     * How far off vertical the arms hang at rest: enough that the upper arm,
     * swung down from the shoulder, clears the widest part of the trunk below
     * it (a heavy or very strong body, bulky armor), never less than a relaxed
     * hang.
     */
    function armAngle(r, built, pack) {
        const relaxed = 0.16 + 0.22 * Math.min(1, r.weight) + 0.1 * Math.min(1, r.muscle);
        if (!built || !pack) return relaxed;
        const P = built.shaped, an = (root.RRCharacterOutfit || require('./CharacterOutfit.js')).anatomy(pack);
        const arm = built.bones.find(b => b.name === 'LeftArm'), fore = built.bones.find(b => b.name === 'LeftForeArm');
        const upper = Math.hypot(fore.head[0] - arm.head[0], fore.head[1] - arm.head[1], fore.head[2] - arm.head[2]);
        let trunk = 0;
        for (const v of pack._bodyIds || (pack._bodyIds = [...new Set(pack.body.source)])) {
            const y = P[v * 3 + 1];
            if (an.member[v * 5] > 0.8 && y < arm.head[1] - 0.05 && y > arm.head[1] - upper * 1.6) trunk = Math.max(trunk, Math.abs(P[v * 3]));
        }
        // The upper arm's own thickness: half the span of its cross-section across the body.
        let mn = Infinity, mx = -Infinity;
        const midY = (arm.head[1] + fore.head[1]) / 2;
        for (const v of pack._bodyIds) if (an.member[v * 5 + 1] > 0.8 && Math.abs(P[v * 3 + 1] - midY) < 0.02 && P[v * 3] > 0) { mn = Math.min(mn, P[v * 3 + 2]); mx = Math.max(mx, P[v * 3 + 2]); }
        const radius = isFinite(mn) ? (mx - mn) / 2 : 0.04;
        const need = (trunk + radius * 1.1 - arm.head[0]) / (upper * 0.85);
        const clear = need > 0 ? Math.asin(Math.min(1, need)) : 0;
        const armor = (r.outfit || []).some(i => i.id === 'powerarmor') ? 0.2 : 0;
        return Math.min(1.25, Math.max(relaxed, clear) + armor);
    }

    /** The humanoid Idle, with a tail swaying when there is one. */
    function clipsFor(bones, r, built, pack) {
        const idle = Glb.idleClip(bones, { armAngle: armAngle(r, built, pack) });
        if (!idle) return [];
        const steps = idle.times.length;
        bones.forEach((b, i) => {
            if (!/^Tail\d*$/.test(b.name)) return;
            const k = b.name === 'Tail' ? 1 : +b.name.slice(4);
            const values = new Float32Array(steps * 4);
            for (let s = 0; s < steps; s++) {
                const w = Math.sin((2 * Math.PI * s) / (steps - 1) + k * 0.6);
                values.set(Glb.axisAngle(0, 1, 0, 0.12 * w), s * 4);
            }
            idle.tracks.push({ bone: i, values });
        });
        return [Object.assign({ name: 'Idle' }, idle)];
    }

    /**
     * The GLB of a build. `encode(texture)` turns a picture into PNG bytes
     * (the page uses a canvas, node tests use pngjs); `images` holds files
     * already encoded ({name: bytes}).
     */
    async function toGlb(result, name, encode, images) {
        const files = Object.assign({}, images || {});
        for (const [key, tex] of Object.entries(result.textures || {})) if (!files[key]) files[key] = await encode(tex);
        const parts = result.parts.map(p => {
            const out = Object.assign({}, p);
            // A part with a picture shows it; its own colors are left for parts that have none.
            if (out.texture && !files[out.texture]) delete out.texture;
            if (!out.texture && !out.colors && !out.color) out.color = '#bbbbbb';
            // Colors on a part with a picture are its baked shading, multiplied with the picture.
            if (out.texture && !out.shaded && !out.keepColors) delete out.colors;
            return out;
        });
        return Glb.toGlb({ parts, bones: result.bones }, { name, clips: result.clips, images: files });
    }

    /** A seeded random character: a body, then a fitting outfit, hair and maybe accessories. */
    function random(seed, options) {
        // Neighboring seeds scrambled apart: xorshift's first draws from a small seed are all near zero.
        const scramble = x => { x = Math.imul((x >>> 0) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) || 1; };
        let s = scramble(seed);
        const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
        const pick = list => list[Math.floor(rand() * list.length)];
        const o = options || {};
        const body = Body.randomRecipe(scramble(seed + 1));
        const r = Object.assign({}, body);
        if (o.species && o.species !== 'human') Object.assign(r, withSpecies(r, o.species));
        const theme = o.theme || pick(['Everyday', 'Everyday', 'Fantasy', 'Armor', 'Sci-fi']);
        const presets = Wardrobe.PRESETS.filter(p => p.group === theme);
        const preset = pick(presets.length ? presets : Wardrobe.PRESETS);
        // Two colors for the whole outfit, on its cloth and leather only: metal and the preset's own accents stay.
        const palettes = [['#2f4468', '#d8d0c0'], ['#7a3b3b', '#2b2e36'], ['#3e5a32', '#5a3d22'], ['#2b2e36', '#8a6a44'], ['#6a2a6a', '#c8a040'], ['#1f1f24', '#8a1a2a'], ['#3a6a8a', '#e8e4dc'], ['#5a3d22', '#d8c8a0']];
        const [main, second] = pick(palettes);
        r.outfit = Wardrobe.dressFor(preset.items, Body.sexOf(body) === 'female').map((item, k) => {
            const def = Wardrobe.BY_ID.get(item.id);
            const material = item.material || (def && def.defaults.material);
            if (rand() < 0.35 || material === 'metal' || material === 'gold') return Object.assign({}, item);
            return Object.assign({}, item, { color: k % 2 ? second : main });
        });
        const gender = r.gender > 0.5 ? 'male' : 'female';
        const bald = o.species && (Species.BY_ID.get(o.species)?.recipe || {}).bald;
        r.hair = bald ? { style: 'bald', brows: { style: 'none' }, lashes: false } : Hair.randomHair(scramble(seed + 2), { gender });
        const extras = Props.PROPS.filter(p => (theme === 'Fantasy' ? ['Hats', 'Jewelry', 'Back'] : theme === 'Sci-fi' ? ['Face', 'Back'] : ['Face', 'Hats', 'Jewelry']).includes(p.group));
        r.props = rand() < 0.45 ? [{ id: pick(extras).id }] : [];
        const skinTones = ['#f1d3bd', '#e5b897', '#c69c7f', '#a8795a', '#8a5a3c', '#5e3b26', '#3f2618'];
        if (!o.species || o.species === 'human') r.skin = body.skin || pick(skinTones);
        const irises = ['#6a4a2a', '#3a2414', '#3a8ad8', '#4a8a4a', '#8a8a5a', '#5a6a7a'];
        r.eyes = Object.assign({}, r.eyes, { color: pick(irises) });
        r.seed = seed >>> 0;
        return normalize(r);
    }

    const api = { normalize, withSpecies, build, shade, toGlb, random, armAngle, clipsFor };
    root.RRCharacterModel = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
