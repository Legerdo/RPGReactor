/**
 * RRGunProp - Weapons › Firearms and Sci-fi: a gun from its parts and the
 * specs that change its look, saved holdable.
 *
 * Built in gun space: the bore along +x, the top up (+y), the grip down
 * at the rear; sides toward ±z. Body pieces are side profiles made into
 * chamfered hard-surface plates (HardSurface.js): stepped receivers in one
 * of eight styles, holes through skeleton stocks, guards and carry handles,
 * recessed ports, slots and sunk glow strips; barrels, cans, scopes and
 * drums are turned. Frame, a dark Underframe, Furniture and Metal differ
 * in color and roughness so the layers read apart. The saved model lies on
 * its side on the floor, centered, and carries the runtime's gun markers
 * (gripTop, gripBottom, muzzle, rear, trigger, and foreGrip and stock where
 * it has them) in model.json; the Prop Builder stands it up (`preview`).
 */
(function(root) {
    'use strict';

    const need = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
    const Rand = need('RRPropRandom', './PropRandom.js');
    const Mesh = need('RRPropMesh', './PropMesh.js');
    const Paint = need('RRPropPaint', './PropPaint.js');
    const CM=need('RRContainerMesh','./ContainerMesh.js'),HS=need('RRHardSurface','./HardSurface.js');
    const Construction=need('RRGunConstruction','./GunConstruction.js'),Surface=need('RRConstructionSurface','../Character3D/ConstructionSurface.js');

    const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d);
    const pick = (v, list, d) => (list.includes(v) ? v : d);

    const MAGAZINES = [['box', 'Box magazine'], ['drum', 'Drum magazine'], ['cylinder', 'Revolver cylinder'], ['tube', 'Tube under the barrel'], ['cell', 'Energy cell'], ['none', 'None']];
    const STOCKS = [['none', 'None'], ['folding', 'Folding stock'], ['full', 'Full stock']];
    const SIGHTS = [['iron', 'Iron sights'], ['dot', 'Red dot'], ['scope', 'Telescopic sight'], ['none', 'None']];
    const MUZZLES = [['plain', 'Plain'], ['brake', 'Muzzle brake'], ['flash', 'Flash hider'], ['suppressor', 'Suppressor'], ['emitter', 'Emitter']];
    /** How the receiver is built: five firearm styles, three sci-fi; each preset starts on its own. */
    const STYLES = [['slide', 'Slide and frame'], ['classic', 'Classic'], ['carbine', 'Carbine'], ['stamped', 'Stamped steel'], ['bolt', 'Bolt action'], ['monocoque', 'Sealed shell'], ['truss', 'Open frame'], ['heavy', 'Armored']];
    const FRAMES = [['gunmetal', 'Gunmetal'], ['polymer', 'Polymer'], ['chrome', 'Chrome'], ['painted', 'Painted panels']];
    const FURNITURE = [['polymer', 'Polymer'], ['wood', 'Wood'], ['painted', 'Painted']];
    // The frame a shade lighter and glossier than the steel and far glossier than the grip, so the layers read apart.
    const LOOK = {
        gunmetal: { color: '#6a7079', roughness: 0.4, metalness: 0.5 }, polymer: { color: '#3c3e44', roughness: 0.66, metalness: 0 },
        chrome: { color: '#d4d8de', roughness: 0.2, metalness: 0.82 }, painted: { color: null, roughness: 0.42, metalness: 0.25 }
    };
    const FURNITURE_LOOK = { polymer: { color: '#2e3034', roughness: 0.86, metalness: 0 }, wood: { color: '#6e4426', roughness: 0.6, metalness: 0 }, painted: { color: null, roughness: 0.58, metalness: 0.1 } };

    const PRESETS = [
        ['pistol', 'Pistol', 'firearms', { style: 'slide', barrel: { length: 0.11, thickness: 0.012 }, receiver: { length: 0.19, height: 0.034 }, magazine: 'none', magSize: 1, stock: 'none', sight: 'iron', grip: { angle: 18, length: 0.11 }, muzzle: 'plain', rails: false, frame: 'polymer', furniture: 'polymer', slide: true }],
        ['revolver', 'Revolver', 'firearms', { style: 'classic', barrel: { length: 0.16, thickness: 0.016 }, receiver: { length: 0.14, height: 0.04 }, magazine: 'cylinder', magSize: 1, stock: 'none', sight: 'iron', grip: { angle: 28, length: 0.12 }, muzzle: 'plain', rails: false, frame: 'chrome', furniture: 'wood' }],
        ['rifle', 'Rifle', 'firearms', { style: 'carbine', barrel: { length: 0.5, thickness: 0.013 }, receiver: { length: 0.3, height: 0.06 }, magazine: 'box', magSize: 1.2, stock: 'full', sight: 'dot', grip: { angle: 22, length: 0.1 }, muzzle: 'brake', rails: true, frame: 'gunmetal', furniture: 'polymer', forend: true }],
        ['shotgun', 'Shotgun', 'firearms', { style: 'classic', barrel: { length: 0.62, thickness: 0.02 }, receiver: { length: 0.24, height: 0.06 }, magazine: 'tube', magSize: 1, stock: 'full', sight: 'iron', grip: { angle: 30, length: 0.1 }, muzzle: 'plain', rails: false, frame: 'gunmetal', furniture: 'wood', forend: true }],
        ['smg', 'Submachine gun', 'firearms', { style: 'stamped', barrel: { length: 0.2, thickness: 0.012 }, receiver: { length: 0.26, height: 0.055 }, magazine: 'box', magSize: 1.4, stock: 'folding', sight: 'iron', grip: { angle: 14, length: 0.1 }, muzzle: 'suppressor', rails: true, frame: 'gunmetal', furniture: 'polymer' }],
        ['sniper', 'Sniper rifle', 'firearms', { style: 'bolt', barrel: { length: 0.8, thickness: 0.016 }, receiver: { length: 0.32, height: 0.06 }, magazine: 'box', magSize: 0.8, stock: 'full', sight: 'scope', grip: { angle: 24, length: 0.1 }, muzzle: 'brake', rails: true, frame: 'gunmetal', furniture: 'polymer', forend: true }],
        ['blasterPistol', 'Blaster pistol', 'scifi', { style: 'monocoque', barrel: { length: 0.12, thickness: 0.02 }, receiver: { length: 0.2, height: 0.05 }, magazine: 'cell', magSize: 1, stock: 'none', sight: 'none', grip: { angle: 20, length: 0.11 }, muzzle: 'emitter', rails: false, frame: 'painted', furniture: 'painted', paint: '#d8dce4', coils: 3, vents: true, glow: '#38c8ff' }],
        ['blasterRifle', 'Blaster rifle', 'scifi', { style: 'truss', barrel: { length: 0.42, thickness: 0.022 }, receiver: { length: 0.34, height: 0.07 }, magazine: 'cell', magSize: 1.2, stock: 'full', sight: 'dot', grip: { angle: 20, length: 0.1 }, muzzle: 'emitter', rails: true, frame: 'painted', furniture: 'painted', paint: '#3a3f4a', coils: 5, vents: true, glow: '#ff5a3a', forend: true }],
        ['plasma', 'Plasma cannon', 'scifi', { style: 'heavy', barrel: { length: 0.5, thickness: 0.05 }, receiver: { length: 0.42, height: 0.1 }, magazine: 'drum', magSize: 1.5, stock: 'none', sight: 'scope', grip: { angle: 10, length: 0.1 }, muzzle: 'emitter', rails: false, frame: 'painted', furniture: 'polymer', paint: '#5a6a3a', coils: 6, vents: true, glow: '#7aff6a', forend: true }],
        ['laser', 'Laser rifle', 'scifi', { style: 'monocoque', barrel: { length: 0.55, thickness: 0.011 }, receiver: { length: 0.3, height: 0.055 }, magazine: 'cell', magSize: 0.9, stock: 'full', sight: 'scope', grip: { angle: 18, length: 0.1 }, muzzle: 'emitter', rails: false, frame: 'chrome', furniture: 'painted', paint: '#f0f0f2', coils: 2, vents: false, glow: '#c86aff' }]
    ];
    const PRESET_BY_ID = new Map(PRESETS.map(p => [p[0], p[3]]));

    function normalize(input) {
        const r = input && typeof input === 'object' ? input : {};
        const preset = pick(r.preset, PRESETS.map(p => p[0]), 'pistol'), base = PRESET_BY_ID.get(preset);
        const v = (key, d) => (r[key] !== undefined ? r[key] : base[key] !== undefined ? base[key] : d);
        const barrel = Object.assign({}, base.barrel, r.barrel || {}), receiver = Object.assign({}, base.receiver, r.receiver || {}), grip = Object.assign({}, base.grip, r.grip || {});
        return {
            kind: 'gun', preset, style: pick(v('style'), STYLES.map(st => st[0]), base.style),
            barrel: { length: clamp(barrel.length, 0.04, 1.2, 0.2), thickness: clamp(barrel.thickness, 0.006, 0.07, 0.014) },
            receiver: { length: clamp(receiver.length, 0.08, 0.7, 0.2), height: clamp(receiver.height, 0.025, 0.14, 0.05) },
            magazine: pick(v('magazine'), MAGAZINES.map(m => m[0]), 'box'), magSize: clamp(v('magSize', 1), 0.4, 2, 1),
            stock: pick(v('stock'), STOCKS.map(s => s[0]), 'none'), sight: pick(v('sight'), SIGHTS.map(s => s[0]), 'iron'),
            grip: { angle: clamp(grip.angle, 0, 40, 18), length: clamp(grip.length, 0.06, 0.16, 0.1) },
            muzzle: pick(v('muzzle'), MUZZLES.map(m => m[0]), 'plain'), rails: !!v('rails', false),
            frame: pick(v('frame'), FRAMES.map(f => f[0]), 'gunmetal'), furniture: pick(v('furniture'), FURNITURE.map(f => f[0]), 'polymer'),
            paint: color(v('paint', '#3a3f4a'), '#3a3f4a'), coils: Math.round(clamp(v('coils', 0), 0, 8, 0)), vents: !!v('vents', false),
            fasteners:r.fasteners!==false,gripRibs:Math.round(clamp(r.gripRibs,0,16,7)),
            glow: color(v('glow', '#38c8ff'), '#38c8ff'), slide: !!v('slide', false), forend: !!v('forend', false)
        };
    }

    // ── pieces ─────────────────────────────────────────────────────────────
    const rect = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
    /** A barrel-like round along +x from `x0` to `x1` at height `y`. */
    const rod = (x0, x1, y, r, seg) => Mesh.lathe([[r, 0], [r, x1 - x0]], seg || 14, { base: [x0, y, 0], dir: [1, 0, 0] });
    /** A turned profile ([radius, along]) on the bore line from `x`. */
    const turned = (x, y, profile, seg, sharp, phase) => Mesh.lathe(profile, seg || 24, { base: [x, y, 0], dir: [1, 0, 0], sharp: sharp ?? 0.5, phase });
    /** A plate standing across the bore (its outline in z, y), `t` thick along x from `x`. */
    const across = (x, t) => ({ frame: { o: [x + t / 2, 0, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } });
    const SCIFI_STYLES = ['monocoque', 'truss', 'heavy'];

    /**
     * The gun in gun space, as lists of meshes per material: Frame (the
     * receiver's shell), Underframe (dark frame showing between and under
     * the shell plates), Furniture (grip, stock, handguard), Metal (barrel,
     * slide, pins), Details (ports, slots, pads), Lens and Glow. Each piece
     * is a chamfered hard-surface plate (HardSurface) or a turned part; the
     * receiver's shape comes from its style.
     */
    function body(r) {
        const P = { frame: [], under: [], furniture: [], metal: [], glass: [], glow: [], dark: [] }, marks = {};
        const Lr = r.receiver.length, Hr = r.receiver.height, Lb = r.barrel.length, rb = r.barrel.thickness / 2;
        const W = Math.max(0.022, Hr * 0.55), xr0 = -Lr * 0.45, xr1 = Lr * 0.55, yb = Hr * 0.62;
        const style = r.style, scifi = SCIFI_STYLES.includes(style), glowing = r.coils > 0 || r.muzzle === 'emitter' || r.magazine === 'cell';
        const ch = Math.max(0.0008, Math.min(0.0025, W * 0.07));
        const put = (list, mesh, floors) => { if (mesh && mesh.index.length) { list.push(mesh); if (mesh.floor) (floors || P.dark).push(mesh.floor); } return mesh; };
        const plate = (list, outline, t, c, o, floors) => put(list, HS.plate(outline, t, c ?? ch, o), floors);
        const cbox = (list, center, size, c) => put(list, HS.chamferedBox(center, size, c ?? Math.min(ch, ...size.map(v => v * 0.3))));
        const strip = glowing ? P.glow : P.dark;
        // The receiver runs over the barrel when it has a slide.
        const front = r.slide ? xr1 + Lb * 0.85 : xr1;
        // Where the grip, trigger and magazine sit (the hand rig's markers come from these).
        const a = r.grip.angle * Math.PI / 180, gl = r.grip.length, gw = Math.min(0.03, W * 0.9), gx = xr0 + Lr * (r.stock === 'full' ? 0.18 : 0.12);
        const back = Math.tan(a) * gl, gd = 0.03, tx = gx + gd + 0.018, mxs = tx + 0.04, ms = r.magSize;
        const gripFront = y => gx + gd - back * (-y / gl);
        const mh = 0.07 * ms + 0.03, md = 0.028 + 0.01 * ms, curve = Lb > 0.3 ? 0.03 * ms : 0, mw = Math.min(W * 0.8, 0.026);
        const S = receiver();

        // ── the receiver, by style ─────────────────────────────────────────
        function receiver() {
            const xf = front, out = { top: Hr, rail: [xr0 + 0.01, xf - 0.01], pins: [], selector: null, face: W / 2 };
            if (style === 'carbine') {
                // A stepped upper (charging-handle step at the rear, flat top) over a narrower lower; the port on the right.
                const top = Hr * 0.92, upperB = Hr * 0.4;
                const port = rect(xr0 + Lr * 0.4, Hr * 0.5, xr0 + Lr * 0.66, Hr * 0.78);
                plate(P.frame, HS.cut([[xr0 + Lr * 0.02, upperB], [xf, upperB], [xf, top], [xr0 + Lr * 0.13, top], [xr0 + Lr * 0.09, Hr * 0.8], [xr0 + Lr * 0.02, Hr * 0.8]], 0.004, [0, 2]), W, ch, { inset: { outline: port, depth: W * 0.3, apart: true } });
                plate(P.frame, HS.cut([[xr0 + Lr * 0.03, Hr * 0.46], [xr0 - 0.002, Hr * 0.3], [xr0 + Lr * 0.06, 0], [xf - Lr * 0.08, 0], [xf - Lr * 0.03, Hr * 0.2], [xf - Lr * 0.03, Hr * 0.46]], 0.003, [2, 3]), W * 0.92, ch);
                // Dust cover under the port, forward assist behind it, the charging handle's T at the rear.
                plate(P.metal, rect(xr0 + Lr * 0.39, Hr * 0.42, xr0 + Lr * 0.67, Hr * 0.485), 0.0016, 0.0005, { center: W / 2 + 0.0002 });
                cbox(P.frame, [xr0 + Lr * 0.27, Hr * 0.63, W / 2 + 0.003], [Lr * 0.09, Hr * 0.24, 0.007]);
                P.metal.push(Mesh.lathe([[Hr * 0.08, 0], [Hr * 0.08, 0.004], [Hr * 0.065, 0.0055], [0, 0.0055]], 16, { base: [xr0 + Lr * 0.27 + Lr * 0.045, Hr * 0.63, W / 2 + 0.006], dir: [0, 0, 1], sharp: 0.5 }));
                cbox(P.under, [xr0 + Lr * 0.04, Hr * 0.85, 0], [0.012, Hr * 0.09, W + 0.014]);
                out.top = top; out.rail = [xr0 + Lr * 0.1, xf - 0.004];
                out.pins = [[xr0 + Lr * 0.08, Hr * 0.3, W * 0.46], [xf - Lr * 0.09, Hr * 0.3, W * 0.46]];
                out.selector = [gx + gd * 0.3, Hr * 0.3, W * 0.46];
            } else if (style === 'stamped') {
                // A pressed-steel box tube: heavy chamfers, a raised stiffening rib, the cocking slot, a trigger housing below.
                const lo = Hr * 0.12, hi = Hr * 0.95, big = Math.min(W * 0.22, (hi - lo) * 0.2);
                const slot = HS.slot(xr0 + Lr * 0.56, Hr * 0.74, Lr * 0.46, Math.max(0.004, Hr * 0.11), 3);
                plate(P.frame, HS.cut(rect(xr0, lo, xf, hi), Hr * 0.16, [2, 3]), W, big, { inset: [{ outline: slot, depth: W * 0.22, apart: true }, { outline: rect(xr0 + Lr * 0.42, Hr * 0.36, xr0 + Lr * 0.68, Hr * 0.62), depth: W * 0.25, side: 'back', apart: true }] });
                plate(P.frame, rect(xr0 + Lr * 0.08, Hr * 0.3, xf - Lr * 0.12, Hr * 0.38), W + 0.003, 0.0008);
                P.metal.push(Mesh.lathe([[Hr * 0.06, 0], [Hr * 0.06, 0.008], [Hr * 0.075, 0.009], [Hr * 0.075, 0.014], [0, 0.015]], 16, { base: [xr0 + Lr * 0.78, Hr * 0.74, W / 2 - 0.004], dir: [0, 0, 1], sharp: 0.5 }));
                cbox(P.under, [xr0 - 0.003, Hr * 0.53, 0], [0.008, Hr * 0.78, W * 0.92]);
                P.metal.push(turned(xf - 0.002, yb, [[rb * 2.4, 0], [rb * 2.4, 0.012]], 6, 0.9));
                plate(P.under, HS.cut(rect(gx - 0.006, -0.003, Math.min(xf - 0.01, mxs + md + 0.012), lo + 0.004), 0.004, [0, 1]), W * 0.86, ch);
                out.top = hi; out.rail = [xr0 + Lr * 0.12, xf - Lr * 0.1];
                out.pins = [[xr0 + Lr * 0.1, Hr * 0.55, W / 2], [xf - Lr * 0.1, Hr * 0.55, W / 2]];
                out.selector = [gx + gd * 0.5, Hr * 0.06, W * 0.43];
            } else if (style === 'slide') {
                // A slide over a frame: rear and front serrations, the port cut into the slide, a rail slot on the dust cover.
                const sc = Math.min(W * 0.14, Hr * 0.12), y0 = Hr * 0.46, lo = y0 + sc + 0.0008, hi = Hr - sc - 0.0008, cuts = [];
                const serration = x => ({ outline: [[x, lo], [x + 0.0017, lo], [x + 0.0027, hi], [x + 0.001, hi]], depth: 0.0011, draft: 0.0003, side: 'both', apart: true });
                for (let k = 0; k < 7; k++) cuts.push(serration(xr0 + sc + 0.003 + k * 0.0042));
                for (let k = 0; k < 4; k++) { const x = xf - sc - 0.012 - k * 0.0042; if (x > xr0 + Lr * 0.75) cuts.push(serration(x)); }
                cuts.push({ outline: rect(xr0 + Lr * 0.46, Hr * 0.62, xr0 + Lr * 0.72, hi), depth: W * 0.35, apart: true });
                plate(P.metal, HS.cut(rect(xr0, y0, xf, Hr), [0.0015, 0.004, Hr * 0.16, 0.0025]), W, sc, { inset: cuts });
                const dust = Math.max(tx + 0.045, xf - Lr * 0.4);
                plate(P.frame, HS.cut([[xr0 + Lr * 0.03, Hr * 0.5], [xr0 - 0.004, Hr * 0.36], [xr0 + Lr * 0.06, -0.002], [tx + 0.03, -0.002], [tx + 0.045, Hr * 0.12], [xf - 0.01, Hr * 0.12], [xf - 0.006, Hr * 0.5]], 0.003, [3, 5]), W * 0.92, ch * 0.8,
                    { inset: { outline: rect(dust, Hr * 0.2, xf - 0.016, Hr * 0.3), depth: 0.0015, side: 'both', apart: true } });
                // An exposed hammer spur behind the slide, a little extractor claw beside the port.
                plate(P.metal, [[xr0 + 0.003, Hr * 0.5], [xr0 + 0.003, Hr * 0.78], [xr0 - 0.005, Hr * 0.98], [xr0 - 0.009, Hr * 0.9], [xr0 - 0.004, Hr * 0.5]], Math.min(0.006, W * 0.3), 0.0008);
                cbox(P.metal, [xr0 + Lr * 0.75, Hr * 0.7, W / 2 + 0.0004], [Lr * 0.09, Hr * 0.08, 0.0016], 0.0004);
                out.top = Hr; out.rail = [xr0 + 0.01, xf - 0.012];
                out.pins = [[tx + 0.008, Hr * 0.3, W * 0.46]];
                out.selector = [xr0 + Lr * 0.12, Hr * 0.36, W * 0.46];
            } else if (style === 'classic') {
                if (r.magazine === 'cylinder') {
                    // A revolver's frame: a window round the cylinder, the top strap over it, a hammer spur behind.
                    const R = Math.max(Hr * 0.55, 0.018) * ms, len = Math.min(0.05, Lr * 0.35), cx = xr1 - len - 0.005;
                    const top = Math.max(Hr, yb + R + 0.006), bot = Math.min(0, yb - R - 0.006);
                    plate(P.frame, HS.round([[xr0 + Lr * 0.02, Hr * 0.45], [xr0 + Lr * 0.1, top], [xf + 0.006, top], [xf + 0.006, bot + 0.006], [xf - 0.004, bot], [xr0 + Lr * 0.12, Math.min(0, bot)], [xr0 - 0.002, Hr * 0.08]], 0.005, 2, [1, 6]), W, ch,
                        { holes: [HS.cut(rect(cx - 0.0015, yb - R - 0.002, cx + len + 0.0015, yb + R + 0.002), 0.003)] });
                    plate(P.metal, [[xr0 + Lr * 0.06, top - 0.006], [xr0 + Lr * 0.14, top - 0.006], [xr0 + Lr * 0.08, top + 0.008], [xr0 + Lr * 0.01, top + 0.013], [xr0 - 0.006, top + 0.01]], 0.007, 0.0012);
                    // The barrel's underlug down to the ejector rod.
                    plate(P.frame, HS.cut(rect(xf, yb - rb * 2.6, xf + Lb * 0.9, yb - rb * 0.3), [0, rb * 1.2, 0, 0]), rb * 1.7, Math.min(ch, rb * 0.4));
                    out.top = top; out.rail = [xr0 + Lr * 0.12, xf - 0.004];
                    out.pins = [[xr0 + Lr * 0.18, Hr * 0.2, W / 2], [xf - 0.002, yb + R + 0.003, W / 2]];
                } else {
                    // A rounded steel box with a scroll panel framed into its sides and the port on the right.
                    plate(P.frame, HS.round(HS.cut(rect(xr0, 0, xf, Hr), Hr * 0.12, [1]), Hr * 0.28, 3, [0, 4]), W, ch * 1.2,
                        { smooth: 40, inset: [{ outline: rect(xr0 + Lr * 0.46, Hr * 0.45, xr0 + Lr * 0.82, Hr * 0.84), depth: W * 0.3, apart: true }, { outline: HS.round(rect(xr0 + Lr * 0.1, Hr * 0.16, xr0 + Lr * 0.42, Hr * 0.82), Hr * 0.1, 2), depth: 0.0007, draft: 0.0004, side: 'back' }] });
                    out.pins = [[xr0 + Lr * 0.2, Hr * 0.3, W / 2], [xr0 + Lr * 0.62, Hr * 0.22, W / 2]];
                    out.rib = Lb > 0.3;
                }
                out.selector = null;
            } else if (style === 'bolt') {
                // A round action on a dark bedding chassis; the bolt's knob out to the right.
                const ra = Hr - yb, x0 = xr0 + Lr * 0.04;
                P.frame.push(turned(x0, yb, [[ra * 0.7, 0], [ra, 0.004], [ra, xf - x0 - 0.004], [ra * 0.85, xf - x0]], 32));
                P.metal.push(turned(xr0 - 0.014, yb, [[ra * 0.35, 0], [ra * 0.62, 0.004], [ra * 0.72, 0.02], [ra * 0.72, x0 - xr0 + 0.016]], 24));
                const root = [xr0 + Lr * 0.22, yb + ra * 0.1, ra * 0.3], knob = [xr0 + Lr * 0.17, yb - ra * 1.1, ra + 0.024];
                P.metal.push(Mesh.polyTube([root, [root[0] - 0.004, root[1] - ra * 0.3, ra + 0.006], [knob[0] + 0.002, knob[1] + 0.008, knob[2] - 0.004], knob], 0.0035, 10));
                P.metal.push(Mesh.lathe([[0, 0], [0.006, 0], [0.0085, 0.003], [0.0085, 0.013], [0.006, 0.016], [0, 0.016]], 20, { base: [knob[0], knob[1], knob[2] - 0.008], dir: [0, 0, 1], sharp: 0.5 }));
                put(P.dark, HS.plate(rect(xr0 + Lr * 0.42, yb - ra * 0.2, xr0 + Lr * 0.7, yb + ra * 0.62), 0.004, 0.0008, { center: ra * 0.78 }));
                plate(P.under, HS.cut(rect(xr0 - 0.002, -0.004, xf + 0.004, yb - ra * 0.2), [0.004, 0.006, 0.002, 0.002]), W * 1.04, ch * 1.2);
                out.top = Hr; out.rail = [x0 + 0.004, xf - 0.006];
                out.pins = [[xr0 + Lr * 0.12, yb * 0.35, W * 0.52], [xf - Lr * 0.12, yb * 0.35, W * 0.52]];
                out.selector = [xr0 + Lr * 0.02, Hr * 0.95, 0];
            } else if (style === 'monocoque') {
                // A sealed shell in two plates over a dark core, a dark seam between them, cooling fins on the back.
                const fx = xf + 0.004;
                plate(P.under, rect(xr0 + 0.004, Hr * 0.08, xf - 0.002, Hr * 0.88), W * 0.84, ch);
                const lo = Hr * 0.42, hi = Hr * 1.04, strips = [];
                const s0 = xr0 + Lr * 0.24, s1 = fx - Lr * 0.24;
                if (s1 - s0 > 0.02) strips.push({ outline: [[s0, Hr * 0.55], [s1, Hr * 0.55], [s1 + Hr * 0.06, Hr * 0.63], [s0 + Hr * 0.06, Hr * 0.63]], depth: 0.0016, draft: 0.0004, side: 'both', apart: true });
                if (s1 - s0 > 0.06) strips.push({ outline: rect(s0 + Hr * 0.14, Hr * 0.74, s1 - Hr * 0.06, Hr * 0.79), depth: 0.0012, draft: 0.0003, side: 'both', apart: true });
                plate(P.frame, [[xr0 - 0.005, Hr * 0.56], [xr0 + Lr * 0.07, lo], [fx - Lr * 0.3, lo], [fx - Lr * 0.24, Hr * 0.32], [fx, Hr * 0.32], [fx, Hr * 0.74], [fx - Lr * 0.14, hi], [xr0 + Lr * 0.2, hi], [xr0 - 0.005, Hr * 0.9]], W + 0.004, ch * 1.3, { inset: strips }, strip);
                plate(P.furniture, HS.cut(rect(xr0 + Lr * 0.05, -0.002, fx - Lr * 0.33, Hr * 0.36), [0.004, Hr * 0.2, 0.002, 0.002]), W + 0.002, ch);
                for (let k = 0; k < 4; k++) cbox(P.metal, [xr0 + Lr * (0.06 + k * 0.034), hi + Hr * 0.06, 0], [Math.max(0.0025, Lr * 0.012), Hr * 0.14, W * 0.62], 0.0006);
                out.top = hi; out.rail = [xr0 + Lr * 0.22, fx - Lr * 0.16];
                out.pins = [[xr0 + Lr * 0.12, Hr * 0.7, W / 2 + 0.002], [fx - Lr * 0.08, Hr * 0.5, W / 2 + 0.002]];
            } else if (style === 'truss') {
                // An open frame: windows onto a glowing core, a carry handle that is also the rail.
                const hi = Hr * 1.38, hb = Hr * 1.02, holes = [HS.cut(rect(xr0 + Lr * 0.24, hb, xf - Lr * 0.24, hi - Hr * 0.13), Hr * 0.06)];
                const spans = [[0.3, 0.46], [0.52, 0.68], [0.74, 0.86]];
                for (const [u0, u1] of spans) holes.push(HS.cut(rect(xr0 + Lr * u0, Hr * 0.3, xr0 + Lr * u1, Hr * 0.72), Hr * 0.08));
                plate(P.frame, HS.cut([[xr0, Hr * 0.15], [xr0 + Lr * 0.06, 0], [xf - Lr * 0.08, 0], [xf, Hr * 0.25], [xf, Hr * 0.88], [xf - Lr * 0.1, hi], [xr0 + Lr * 0.12, hi], [xr0, Hr * 1.0]], Hr * 0.06, [5, 6]), W, ch, { holes });
                plate(P.under, rect(xr0 + Lr * 0.26, Hr * 0.22, xf - Lr * 0.1, Hr * 0.8), W * 0.36, ch * 0.6);
                const cr = Math.min(W * 0.3, Hr * 0.17);
                (glowing ? P.glow : P.metal).push(rod(xr0 + Lr * 0.28, xf - Lr * 0.12, Hr * 0.51, cr, 16));
                for (const [u0, u1] of spans) P.metal.push(turned(xr0 + Lr * (u1 + 0.005), Hr * 0.51, [[cr * 1.25, 0], [cr * 1.25, Lr * 0.04]], 16, 0.9));
                plate(P.under, HS.cut(rect(gx - 0.006, -0.003, Math.min(xf - 0.01, mxs + md + 0.012), Hr * 0.3), 0.004, [0, 1]), W * 0.86, ch);
                out.top = hi; out.rail = [xr0 + Lr * 0.14, xf - Lr * 0.12];
                out.pins = [[xr0 + Lr * 0.12, Hr * 0.55, W / 2], [xf - Lr * 0.05, Hr * 0.55, W / 2]];
            } else {
                // Heavy: a dark core under two armor plates (vents in the rear, glow bars in the front), a carry handle on top.
                plate(P.under, rect(xr0 + 0.004, Hr * 0.05, xf - 0.004, Hr * 0.9), W * 0.88, ch);
                const vents = [];
                for (let k = 0; k < 5; k++) { const x = xr0 + Lr * (0.1 + k * 0.06); vents.push({ outline: HS.slot(x, Hr * 0.62, Math.max(0.003, Hr * 0.045), Hr * 0.42, 2), depth: 0.003, side: 'both', apart: true }); }
                plate(P.frame, [[xr0 - 0.008, Hr * 0.2], [xr0 + Lr * 0.05, -0.004], [xr0 + Lr * 0.46, -0.004], [xr0 + Lr * 0.53, Hr * 0.48], [xr0 + Lr * 0.46, Hr * 1.02], [xr0 + Lr * 0.04, Hr * 1.02], [xr0 - 0.008, Hr * 0.8]], W + 0.008, ch * 1.6, { inset: vents });
                const bars = [];
                for (let k = 0; k < 3; k++) { const x = xr0 + Lr * (0.62 + k * 0.1); bars.push({ outline: [[x, Hr * 0.3], [x + Lr * 0.035, Hr * 0.3], [x + Lr * 0.05, Hr * 0.72], [x + Lr * 0.015, Hr * 0.72]], depth: 0.002, draft: 0.0005, side: 'both', apart: true }); }
                plate(P.frame, [[xr0 + Lr * 0.5, Hr * 0.1], [xf - Lr * 0.04, Hr * 0.1], [xf + 0.006, Hr * 0.3], [xf + 0.006, Hr * 0.78], [xf - Lr * 0.08, Hr * 0.96], [xr0 + Lr * 0.49, Hr * 0.96], [xr0 + Lr * 0.55, Hr * 0.5]], W + 0.005, ch * 1.4, { inset: bars }, strip);
                plate(P.under, [[xr0 + Lr * 0.14, Hr * 0.9], [xr0 + Lr * 0.76, Hr * 0.9], [xr0 + Lr * 0.68, Hr * 1.36], [xr0 + Lr * 0.22, Hr * 1.36]], W * 0.34, ch,
                    { holes: [HS.cut(rect(xr0 + Lr * 0.27, Hr * 1.04, xr0 + Lr * 0.63, Hr * 1.22), Hr * 0.05)] });
                for (const s of [-1, 1]) {
                    const z = s * (W / 2 + 0.009), x0 = xr0 + Lr * 0.6;
                    P.metal.push(Mesh.lathe([[0.004, 0], [0.009, 0.003], [0.009, Lr * 0.28], [0.004, Lr * 0.28 + 0.003]], 16, { base: [x0, Hr * 0.18, z], dir: [1, 0, 0], sharp: 0.5 }));
                    strip.push(Mesh.lathe([[0.0094, 0], [0.0094, Lr * 0.05]], 16, { base: [x0 + Lr * 0.11, Hr * 0.18, z], dir: [1, 0, 0] }));
                }
                out.top = Hr * 1.36; out.rail = [xr0 + Lr * 0.25, xr0 + Lr * 0.65];
                out.pins = [[xr0 + Lr * 0.42, Hr * 0.12, W / 2 + 0.004]];
            }
            return out;
        }

        // ── the barrel and its muzzle ──────────────────────────────────────
        const bx0 = front - 0.005, bx1 = r.slide ? front + 0.008 : xr1 + Lb, L = bx1 - bx0, boreDepth = Math.min(0.025, L * 0.7);
        const step = r.slide ? 0 : Math.min(0.03, L * 0.1);
        const barrelProfile = [[0, 0], [rb * (step ? 1.3 : 1), 0], ...(step ? [[rb * 1.3, step], [rb, step + 0.004]] : []), [rb, L - 0.0015], [rb * 0.86, L], [rb * 0.58, L], [rb * 0.58, L - boreDepth], [0, L - boreDepth]];
        if (style === 'bolt' && L > 0.25) {
            // A fluted heavy barrel.
            const f0 = L * 0.22, f1 = L * 0.72, prof = [[rb * 1.3, 0], [rb * 1.3, step], [rb, step + 0.004], [rb, f0], [rb, f0 + 0.01], [rb, f1 - 0.01], [rb, f1], [rb, L - 0.0015], [rb * 0.86, L], [rb * 0.58, L], [rb * 0.58, L - boreDepth], [0, L - boreDepth]];
            const fl = CM.revolve([[0, 0], ...prof], 48, { radius: (t, y, rad) => (y > f0 + 0.005 && y < f1 - 0.005 && rad >= rb * 0.99 ? rad * (1 - 0.1 * Math.max(0, Math.cos(t * Math.PI * 12)) ** 3) : rad) });
            CM.transform(fl, ([x, y, z]) => [bx0 + y, yb + x, -z], ([x, y, z]) => [y, x, -z]);
            P.metal.push(fl);
        } else P.metal.push(Mesh.lathe(barrelProfile, 40, { base: [bx0, yb, 0], dir: [1, 0, 0] }));
        P.dark.push(Mesh.lathe([[rb * 0.55, 0], [rb * 0.55, 0.0015], [0, 0.0015]], 10, { base: [bx1 - boreDepth + 0.0002, yb, 0], dir: [1, 0, 0] }));
        let mx = bx1;
        if (r.muzzle === 'brake') {
            // A ported block: three windows through each side, the bore showing through them.
            const len = 0.05, h = rb * 1.7, x0 = bx1 - 0.006, holes = [];
            for (let k = 0; k < 3; k++) { const x = bx1 + 0.007 + k * 0.012; holes.push(HS.cut(rect(x, yb - h * 0.62, x + 0.0075, yb + h * 0.62), 0.0015)); }
            plate(P.under, HS.cut(rect(x0, yb - h, bx1 + len, yb + h), [0, h * 0.35, h * 0.35, 0]), rb * 3.2, Math.min(rb * 0.4, 0.002), { holes });
            P.dark.push(rod(x0, bx1 + len - 0.001, yb, rb * 0.62, 12));
            mx = bx1 + len;
        } else if (r.muzzle === 'suppressor') {
            // A can: hex mount, two banded sections, a recessed front cap.
            const len = Lb * 0.6 + 0.09, R = rb * 2.2, body = [[R * 0.88, 0.016], [R, 0.02]];
            for (const t of [0.34, 0.68]) body.push([R, len * t], [R * 0.93, len * t + 0.002], [R * 0.93, len * t + 0.006], [R, len * t + 0.008]);
            body.push([R, len - 0.008], [R * 0.9, len - 0.002], [R * 0.66, len - 0.002], [R * 0.6, len - 0.006], [rb * 0.7, len - 0.006], [rb * 0.7, len - 0.003], [0, len - 0.003]);
            P.under.push(turned(bx1 - 0.004, yb, [[rb * 1.15, 0], [rb * 1.9, 0.002], [rb * 1.9, 0.016]], 6, 0.9));
            P.under.push(turned(bx1, yb, body, 32));
            P.dark.push(turned(bx1 + len - 0.0035, yb, [[rb * 0.68, 0], [0, 0.0004]], 12));
            mx = bx1 + len;
        } else if (r.muzzle === 'flash') {
            // Four prongs on a collar.
            const len = Math.max(0.04, rb * 6);
            P.under.push(turned(bx1 - 0.004, yb, [[rb * 1.15, 0], [rb * 1.55, 0.002], [rb * 1.55, len * 0.32]], 24));
            for (let k = 0; k < 4; k++) { const prong = HS.chamferedBox([bx1 + len * 0.64, yb + rb * 1.12, 0], [len * 0.68, rb * 0.7, rb * 0.9], Math.min(0.0008, rb * 0.15)); P.under.push(HS.turn(prong, 'x', Math.PI / 4 + k * Math.PI / 2, [0, yb, 0])); }
            P.dark.push(rod(bx1 + len * 0.3, bx1 + len - 0.002, yb, rb * 0.8, 12));
            mx = bx1 + len;
        } else if (r.muzzle === 'emitter') {
            // A flared emitter: six fins on the flare, a lens sunk in its mouth, a glowing band in a groove.
            (scifi ? P.frame : P.metal).push(turned(bx1, yb, [[rb, 0], [rb * 1.9, 0.012], [rb * 2.2, 0.026], [rb * 2.2, 0.03], [rb * 2.05, 0.031], [rb * 2.05, 0.034], [rb * 2.2, 0.035], [rb * 2.2, 0.04], [rb * 1.8, 0.045], [rb * 1.3, 0.045], [rb * 1.2, 0.04]], 32));
            P.glow.push(turned(bx1 + 0.031, yb, [[rb * 2.1, 0], [rb * 2.1, 0.003]], 32));
            P.glow.push(turned(bx1 + 0.036, yb, [[rb * 1.22, 0], [0, 0.002]], 24));
            for (let k = 0; k < 6; k++) { const fin = HS.plate([[bx1 + 0.004, 0], [bx1 + 0.026, 0], [bx1 + 0.024, rb * 0.9], [bx1 + 0.012, rb * 0.9]], Math.max(0.0012, rb * 0.18), 0.0004, { frame: { o: [0, yb + rb * 1.5, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] } }); P.under.push(HS.turn(fin, 'x', k * Math.PI / 3, [0, yb, 0])); }
            mx = bx1 + 0.045;
        } else if (!r.slide) P.under.push(turned(bx1 - 0.012, yb, [[rb * 1.12, 0], [rb * 1.18, 0.001], [rb * 1.18, 0.0095], [rb * 1.05, 0.0105]], 24));
        marks.muzzle = [mx, yb, 0];
        if (S.rib) {
            // A ventilated rib along the barrel's top: posts with windows between them, a bead at its end.
            const x0 = xr1 + 0.004, x1 = bx1 - 0.004, y0 = yb + rb * 0.75, y1 = yb + rb + 0.0065, holes = [];
            for (let x = x0 + 0.012; x + 0.018 < x1 - 0.006; x += 0.024) holes.push(rect(x, y0 + 0.0012 + rb * 0.25, x + 0.018, y1 - 0.0016));
            plate(P.metal, rect(x0, y0, x1, y1), 0.0065, 0.0007, { holes });
        }

        // ── the grip, trigger and guard ────────────────────────────────────
        const loft = style === 'classic' || style === 'bolt';
        if (loft) {
            // A swelled, rounded grip turned in 32 around and 12 down; uvs run around and down it (meters), so its normal map has a frame.
            const g = new CM.Geo(), ring = t => Array.from({ length: 33 }, (_, j) => { const an = j / 32 * Math.PI * 2, bulge = 1 + 0.12 * Math.sin(t * Math.PI), x = Math.sign(Math.cos(an)) * Math.abs(Math.cos(an)) ** 0.55, z = Math.sign(Math.sin(an)) * Math.abs(Math.sin(an)) ** 0.55; return [gx + gd * 0.5 - back * t + x * gd * 0.5 * bulge, -gl * t, z * gw * 0.5]; });
            const around = 2 * (gd + gw) / 32, flatUv = p => [p[0] - gx, p[2]];
            let prev = ring(0);
            g.poly(prev.slice(0, -1), prev.slice(0, -1).map(flatUv), [0, 1, 0]);
            for (let k = 1; k <= 12; k++) {
                const next = ring(k / 12), v0 = gl * (k - 1) / 12, v1 = gl * k / 12;
                for (let j = 0; j < 32; j++) g.poly([prev[j], next[j], next[j + 1], prev[j + 1]], [[j * around, v0], [j * around, v1], [(j + 1) * around, v1], [(j + 1) * around, v0]], [Math.cos((j + 0.5) / 32 * Math.PI * 2), 0, Math.sin((j + 0.5) / 32 * Math.PI * 2)]);
                prev = next;
            }
            g.poly(prev.slice(0, -1), prev.slice(0, -1).map(flatUv), [0, -1, 0]);
            P.furniture.push(CM.smoothNormals(g.done(), 0.8));
            for (const s of [-1, 1]) for (let j = 0; j < r.gripRibs; j++) { const t = (j + 1) / (r.gripRibs + 1); P.dark.push(Mesh.box([gx + gd * 0.4 - back * t, -gl * t, s * (gw * 0.5 + 0.0004)], [gd * 0.7, 0.0016, 0.0014])); }
        } else {
            // A moulded grip: palm swell behind, three finger grooves in front, a flared base; grip ribs sunk in its sides.
            const pts = [], n = 14;
            for (let k = 0; k <= 6; k++) { const t = 1 - k / 6; pts.push([gx - back * t - 0.0015 * Math.sin(Math.PI * t), -gl * t]); }
            pts.push([gx - 0.002, 0.003]);
            for (let k = 0; k <= n; k++) { const t = k / n, groove = t > 0.12 && t < 0.92 ? 0.0028 * Math.max(0, Math.sin((t - 0.12) / 0.8 * Math.PI * 3)) : 0; pts.push([gx + gd - back * t - groove, -gl * t + (k ? 0 : 0.003)]); }
            pts.push([gx + gd - back + 0.002, -gl - 0.003], [gx - back - 0.003, -gl - 0.003]);
            const insets = [], c = style === 'truss' ? Math.min(gw * 0.24, 0.0035) : gw * 0.24;
            for (let j = 0; j < r.gripRibs; j++) {
                const t = 0.22 + 0.66 * (j + 0.5) / r.gripRibs, h = Math.min(0.0009, gl * 0.6 / (r.gripRibs * 3)), y = -gl * t;
                const xb = gx - back * t + c + 0.0035, xf = gx + gd - back * t - c - 0.006;
                if (xf - xb > 0.004) insets.push({ outline: [[xb, y - h], [xf - back * (h / gl), y - h], [xf + back * (h / gl), y + h], [xb + back * (2 * h / gl), y + h]], depth: 0.0009, draft: 0.0003, side: 'both', apart: true });
            }
            const holes = style === 'truss' ? [HS.cut([[gx + gd * 0.4 - back * 0.22, -gl * 0.22], [gx + gd * 0.6 - back * 0.22, -gl * 0.22], [gx + gd * 0.6 - back * 0.72, -gl * 0.72], [gx + gd * 0.4 - back * 0.72, -gl * 0.72]], 0.002)] : [];
            plate(P.furniture, pts, gw, c, { smooth: 40, inset: insets, holes });
        }
        marks.gripTop = [gx + gd / 2, 0, 0]; marks.gripBottom = [gx + gd / 2 - back, -gl, 0];
        // The guard: a plate with its loop cut through, from the frame down round the trigger and back to the grip.
        const gy = -0.034, gb = Math.min(gripFront(gy) + 0.001, tx - 0.008), guard = [[gripFront(0) - 0.003, 0.003], [tx + 0.031, 0.003], [tx + 0.034, -0.02], [tx + 0.02, gy - 0.002], [gb, gy - 0.002]];
        const loopOf = HS.offset(guard, 0.0045).map(([x, y]) => [x, Math.min(y, -0.0025)]);
        plate(style === 'slide' || style === 'carbine' || style === 'classic' ? P.frame : P.under, style === 'classic' ? HS.round(guard, 0.008, 3, [2, 3]) : HS.cut(guard, 0.006, [2, 3]), 0.0075, 0.0013, { holes: [style === 'classic' ? HS.round(loopOf, 0.005, 2, [2, 3]) : HS.cut(loopOf, 0.004, [2, 3])] });
        plate(P.metal, [[tx - 0.002, 0.002], [tx + 0.004, 0.002], [tx + 0.0035, -0.007], [tx + 0.0012, -0.0145], [tx - 0.0025, -0.0185], [tx - 0.0038, -0.0168], [tx - 0.001, -0.012], [tx - 0.0012, -0.004]], 0.005, 0.0009);
        marks.trigger = [tx, -0.012, 0];
        let rear = [xr0, Hr * 0.5, 0];

        // ── the magazine ───────────────────────────────────────────────────
        const well = () => plate(style === 'slide' || style === 'carbine' ? P.frame : P.under, [[mxs - 0.005, 0.003], [mxs + md + 0.005, 0.003], [mxs + md + 0.007 + curve * 0.08, -0.016], [mxs - 0.007 + curve * 0.08, -0.016]], mw + 0.006, ch);
        if (r.magazine === 'box') {
            // A curved box with pressed side panels and a flared floor plate.
            const pts = [];
            for (let k = 0; k <= 6; k++) { const t = k / 6; pts.push([mxs + md + curve * t * t, 0.004 - (mh + 0.004) * t]); }
            for (let k = 6; k >= 0; k--) { const t = k / 6; pts.push([mxs + curve * t * t, 0.004 - (mh + 0.004) * t]); }
            // A pressed panel down each side, following the curve, in from the edges.
            const mc = Math.min(ch, mw * 0.12), m = mc + 0.004, panel = [], yt = -0.02, yl = -mh + 0.012;
            for (let k = 0; k <= 6; k++) { const y = yt + (yl - yt) * k / 6, t = (0.004 - y) / (mh + 0.004); panel.push([mxs + md + curve * t * t - m, y]); }
            for (let k = 6; k >= 0; k--) { const y = yt + (yl - yt) * k / 6, t = (0.004 - y) / (mh + 0.004); panel.push([mxs + curve * t * t + m, y]); }
            plate(P.under, pts, mw, mc, { smooth: 20, inset: mh > 0.05 ? { outline: panel, depth: 0.0012, side: 'both' } : null });
            plate(P.furniture, HS.cut(rect(mxs + curve - 0.002, -mh - 0.005, mxs + md + curve + 0.004, -mh + 0.005), 0.002, [0, 1]), mw + 0.004, Math.min(ch, 0.0015));
            well();
        } else if (r.magazine === 'drum') {
            // A drum: chamfered rims, a raised band, ribs out from a hub on both faces, a winding key; a neck up into the well.
            const R = 0.045 * ms + 0.02, dz = 0.054 * ms + 0.024, c = [mxs + R * 0.6, -R * 0.85, 0];
            const prof = [[0, -0.005], [R * 0.16, -0.005], [R * 0.2, -0.002], [R * 0.2, 0], [R * 0.84, 0], [R * 0.88, 0.002], [R * 0.96, 0.002], [R, 0.006], [R, dz * 0.32], [R * 1.03, dz * 0.34], [R * 1.03, dz * 0.66], [R, dz * 0.68], [R, dz - 0.006], [R * 0.96, dz - 0.002], [R * 0.88, dz - 0.002], [R * 0.84, dz], [R * 0.2, dz], [R * 0.2, dz + 0.002], [R * 0.16, dz + 0.005], [0, dz + 0.005]];
            (scifi ? P.frame : P.under).push(Mesh.lathe(prof, 48, { base: [c[0], c[1], -dz / 2], dir: [0, 0, 1], sharp: 0.5 }));
            for (const s of [-1, 1]) for (let k = 0; k < 6; k++) P.metal.push(HS.turn(HS.chamferedBox([c[0] + R * 0.52, c[1], s * (dz / 2 + 0.0008)], [R * 0.56, 0.004, 0.0025], 0.0006), 'z', k * Math.PI / 3, c));
            cbox(P.metal, [c[0], c[1], dz / 2 + 0.008], [R * 0.5, 0.006, 0.004], 0.001);
            plate(P.under, [[mxs, 0.004], [mxs + 0.032, 0.004], [mxs + 0.034, c[1] + R * 0.7], [mxs - 0.002, c[1] + R * 0.7]], 0.02, ch);
            well();
        } else if (r.magazine === 'cylinder') {
            // Six chambers in a fluted cylinder above the trigger.
            const R = Math.max(Hr * 0.55, 0.018) * ms, len = Math.min(0.05, Lr * 0.35), cx = xr1 - len - 0.005;
            const prof = [[R * 0.85, 0], [R, 0.004], [R, len - 0.004], [R * 0.85, len]];
            const cyl = CM.revolve([[0, 0], ...prof, [0, len]], 72, { radius: (t, y, rad) => rad * (1 - 0.045 * Math.max(0, Math.cos(t * Math.PI * 12)) ** 4) }); CM.transform(cyl, ([x, y, z]) => [cx + y, yb + x, -z], ([x, y, z]) => [y, x, -z]);
            P.metal.push(cyl);
            for (let k = 0; k < 6; k++) { const ang = k * Math.PI / 3; P.dark.push(Mesh.lathe([[R * 0.24, 0], [R * 0.24, 0.002], [0, 0.002]], 8, { base: [cx + len - 0.0005, yb + Math.cos(ang) * R * 0.55, Math.sin(ang) * R * 0.55], dir: [1, 0, 0] })); }
            P.metal.push(rod(cx - 0.004, cx + len + 0.004, yb, R * 0.12, 10));
        } else if (r.magazine === 'tube') {
            // A tube under the barrel, a capped end and a band holding it to the barrel.
            const tr = 0.009 * ms + 0.004, ty = yb - rb - 0.012, t1 = xr1 + Lb * 0.8;
            P.metal.push(turned(xr1, ty, [[tr, 0], [tr, t1 - xr1], [tr * 1.18, t1 - xr1], [tr * 1.18, t1 - xr1 + 0.012], [tr * 0.95, t1 - xr1 + 0.016], [0, t1 - xr1 + 0.016]], 20));
            const bx = Math.min(t1 - 0.03, xr1 + Lb * 0.7);
            plate(P.under, HS.round(rect(-tr * 1.35, ty - tr * 1.35, tr * 1.35, yb + rb * 1.35), Math.min(tr, rb) * 1.2, 3), 0.009, 0.0012, across(bx, 0.009));
        } else if (r.magazine === 'cell') {
            // An energy cell in a well: a dark block with a glowing window down each side and a ribbed cap.
            const cd = 0.026 * ms + 0.012, chh = 0.05 * ms + 0.02, cw = Math.min(W * 0.84, 0.03);
            const win = HS.slot(mxs + cd * 0.55, -chh / 2, Math.max(0.004, cd * 0.24), chh - 0.026, 2);
            plate(P.under, HS.cut([[mxs, 0.004], [mxs + cd, 0.004], [mxs + cd + 0.004, -chh], [mxs + 0.004, -chh]], 0.004, [2, 3]), cw, ch, { inset: chh > 0.03 ? { outline: win, depth: 0.0018, draft: 0.0005, side: 'both', apart: true } : null }, P.glow);
            for (let k = 0; k < 3; k++) cbox(P.metal, [mxs + cd / 2 + 0.003, -chh - 0.002 - k * 0.0035, 0], [cd + 0.004 - k * 0.003, 0.0025, cw + 0.002], 0.0006);
            well();
        }

        // ── the forend ─────────────────────────────────────────────────────
        const f0 = xr1 + 0.004, f1 = xr1 + Math.min(Lb * 0.6, 0.36), fT = yb + rb + 0.012, fB = yb - rb - 0.03, fW = Math.max(0.03, rb * 3);
        if (r.forend) {
            const slots = [], n = Math.max(0, Math.floor((f1 - f0 - 0.02) / 0.034));
            if (style === 'classic') {
                // A pump: rounded, grooved across its grip.
                for (let k = 0; k < (f1 - f0 > 0.07 ? 7 : 0); k++) { const x = f0 + (f1 - f0) * (0.25 + k * 0.075); slots.push({ outline: rect(x, fB + 0.007, x + 0.0028, fT - 0.007), depth: 0.0014, draft: 0.0005, side: 'both' }); }
                plate(P.furniture, HS.round(rect(f0, fB, f1, fT), Math.min(0.012, (fT - fB) * 0.4), 3), fW, Math.min(0.004, fW * 0.16), { smooth: 40, inset: slots });
            } else if (style === 'bolt') {
                // The stock's fore part, floating clear under the barrel, with vent slots.
                for (let k = 0; k < n; k++) { const x = f0 + 0.012 + k * 0.034; slots.push({ outline: HS.slot(x + 0.011, (fB + yb - rb) / 2 - 0.002, 0.022, 0.006, 2), depth: 0.002, side: 'both', apart: true }); }
                plate(P.furniture, HS.cut(rect(f0 - 0.006, fB, f1, yb - rb - 0.003), [0, 0.012, 0.003, 0]), fW, Math.min(0.003, fW * 0.12), { inset: slots });
            } else if (scifi) {
                // A shroud: angular, a sunk strip (glowing when the gun glows) and a heat-sink notch under it.
                const s = [{ outline: [[f0 + 0.012, yb - rb * 0.2], [f1 - 0.03, yb - rb * 0.2], [f1 - 0.024, yb + rb * 0.6], [f0 + 0.018, yb + rb * 0.6]], depth: 0.0018, draft: 0.0004, side: 'both', apart: true }];
                plate(P.furniture, HS.cut(rect(f0, fB, f1, fT), [0.004, 0.014, 0.008, 0.002]), fW, Math.min(0.003, fW * 0.12), { inset: f1 - f0 > 0.07 ? s : null }, strip);
                plate(P.under, rect(f0 + 0.01, fB - 0.006, f0 + (f1 - f0) * 0.55, fB + 0.004), fW * 0.6, ch);
            } else {
                // A handguard with rows of accessory slots, round the barrel.
                for (let k = 0; k < n; k++) { const x = f0 + 0.014 + k * 0.034; for (const y of [yb, fB + 0.009]) slots.push({ outline: HS.slot(x + 0.011, y, 0.022, 0.0055, 2), depth: Math.min(0.003, fW * 0.12), side: 'both', apart: true }); }
                plate(P.furniture, HS.cut(rect(f0, fB, f1, fT), [0.003, 0.008, 0.003, 0.003]), fW, Math.min(0.003, fW * 0.12), { inset: slots });
                P.under.push(turned(f1 - 0.002, yb, [[rb * 1.25, 0], [Math.min(fW * 0.42, (fT - fB) * 0.42), 0.002], [Math.min(fW * 0.42, (fT - fB) * 0.42), 0.008], [rb * 1.25, 0.01]], 24));
            }
            marks.foreGrip = [(f0 + f1) / 2, yb - rb - 0.018, 0];
        }

        // ── the stock ──────────────────────────────────────────────────────
        if (r.stock === 'full') {
            const s0 = xr0 + 0.004, s1 = xr0 - 0.26 - Lr * 0.15, top = Hr * 0.8, sw = Math.min(0.04, W * 1.05);
            const outline = [[s0, top], [s0, Hr * 0.12], [s1 + 0.04, -0.07], [s1, -0.072], [s1, top + 0.012], [s1 + 0.06, top + 0.016]];
            const topAt = x => top + 0.016 * Math.min(1, (s0 - x) / Math.max(0.01, s0 - s1 - 0.06)), botAt = x => Hr * 0.12 + (-0.07 - Hr * 0.12) * Math.min(1, (s0 - x) / Math.max(0.01, s0 - s1 - 0.04));
            const holes = [];
            const bar = 0.013, xa = s1 + 0.034, xb = s0 - 0.034;
            if (style === 'classic') { /* solid, a classic comb */ }
            else if (style === 'bolt') { const x0 = s0 - 0.075, x1 = s0 - 0.02; holes.push(HS.round(rect(x0, botAt(x0) + 0.012, x1, topAt(x1) - 0.018), 0.008, 2)); }
            else if (xb - xa > 0.06) {
                // Skeleton: a lightening window, split by a diagonal strut on the open frames.
                const q = [[xa, botAt(xa) + bar + 0.004], [xb, botAt(xb) + bar], [xb, topAt(xb) - bar], [xa, topAt(xa) - bar]];
                if (style === 'truss' || style === 'heavy') { for (const tri of [[q[0], q[1], q[3]], [q[1], q[2], q[3]]]) { const h = HS.offset(tri, 0.005); if (h.length && Math.abs(HS.area(h)) > 4e-5) holes.push(h); } }
                else holes.push(HS.cut(q, 0.008));
            }
            if (style === 'carbine') P.under.push(Mesh.lathe([[0.012, 0], [0.012, s0 - s1 - 0.05], [0.009, s0 - s1 - 0.045]], 24, { base: [xr0 - 0.002, Hr * 0.55, 0], dir: [-1, 0, 0], sharp: 0.5 }));
            plate(P.furniture, outline, sw, Math.min(style === 'classic' || style === 'bolt' ? 0.006 : 0.003, sw * 0.18), { holes, smooth: 40 });
            if (style === 'bolt') plate(P.under, HS.cut(rect(s1 + 0.07, top + 0.004, s0 - 0.04, topAt(s0 - 0.04) + 0.012), 0.004, [2, 3]), sw * 0.6, ch);
            plate(P.dark, rect(s1 - 0.012, -0.072, s1 + 0.001, top + 0.012), Math.min(0.042, sw + 0.003), 0.002);
            marks.stock = [s1 - 0.012, (top - 0.06) / 2, 0]; rear = marks.stock;
        } else if (r.stock === 'folding') {
            // A side-folding frame: a stamped loop with a hinge knuckle and a ribbed butt plate.
            const s1 = xr0 - 0.22, o = [[xr0 + 0.004, Hr * 0.75], [xr0 + 0.004, Hr * 0.15], [s1 + 0.03, -0.05], [s1, -0.06], [s1 - 0.004, -0.06], [s1 - 0.004, Hr * 0.65], [s1 + 0.02, Hr * 0.72]];
            plate(P.under, o, 0.013, 0.002, { holes: [HS.cut(HS.offset(o, 0.0105), 0.005)] });
            P.metal.push(Mesh.lathe([[0.006, 0], [0.006, 0.016]], 16, { base: [xr0 + 0.002, Hr * 0.45, -0.008], dir: [0, 0, 1] }));
            plate(P.dark, rect(s1 - 0.012, -0.06, s1 + 0.002, Hr * 0.65), 0.04, 0.002);
            marks.stock = [s1 - 0.01, Hr * 0.3 - 0.03, 0]; rear = marks.stock;
        }
        marks.rear = rear;

        // ── rails and sights ───────────────────────────────────────────────
        const top = S.top;
        /** A picatinny rail at real scale: a base and a crown of teeth on a 10 mm pitch, the dovetail in the crown's chamfer. */
        const rail = (x0, x1, y, list) => {
            if (x1 - x0 < 0.02) return;
            const n = Math.floor((x1 - x0 - 0.004) / 0.01), pad = (x1 - x0 - n * 0.01) / 2, pts = [[x0, y + 0.0035], [x1, y + 0.0035]];
            for (let k = n - 1; k >= 0; k--) { const xa = x0 + pad + k * 0.01; pts.push([xa + 0.0074, y + 0.0035 + 0.003], [xa + 0.0074, y + 0.0095], [xa + 0.0021, y + 0.0095], [xa + 0.0021, y + 0.0065]); }
            pts.splice(2, 0, [x1, y + 0.0065]); pts.push([x0, y + 0.0065]);
            plate(list || P.frame, pts, Math.min(0.021, W * 0.95), 0.0011, { smooth: 0 });
            cbox(list || P.frame, [(x0 + x1) / 2, y + 0.002, 0], [x1 - x0, 0.004, Math.min(0.0156, W * 0.7)], 0.0006);
        };
        if (r.rails) {
            rail(S.rail[0], S.rail[1], top);
            if (r.forend && style !== 'classic' && style !== 'bolt') rail(f0 + 0.004, f1 - 0.006, fT, P.frame);
        }
        const sightBase = top + (r.rails ? 0.0095 : 0);
        const long = r.stock !== 'none' || Lb > 0.3;
        if (r.sight === 'iron') {
            if (style === 'classic') {
                // A ramp blade at the muzzle (or a bead on the rib), a notch at the rear.
                if (r.magazine === 'cylinder' || !long) plate(P.frame, [[bx1 - 0.03, yb + rb * 0.6], [bx1 - 0.004, yb + rb * 0.6], [bx1 - 0.004, yb + rb + 0.008], [bx1 - 0.011, yb + rb + 0.008]], 0.0035, 0.0006);
                else P.metal.push(Mesh.sphere([bx1 - 0.008, yb + rb + 0.0085, 0], 0.0022, 12));
                put(P.metal, HS.plate([[-0.006, 0], [0.006, 0], [0.006, 0.006], [0.0015, 0.006], [0.0015, 0.003], [-0.0015, 0.003], [-0.0015, 0.006], [-0.006, 0.006]], 0.005, 0.0006, { frame: { o: [xr0 + Lr * 0.12 + 0.0025, sightBase - 0.001, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } }));
            } else if (!long) {
                // Pistol sights: a dovetailed notch at the rear, a post at the front.
                put(P.metal, HS.plate([[-0.0065, 0], [0.0065, 0], [0.0065, 0.006], [0.0016, 0.006], [0.0016, 0.0028], [-0.0016, 0.0028], [-0.0016, 0.006], [-0.0065, 0.006]], 0.006, 0.0008, { frame: { o: [xr0 + 0.008, sightBase - 0.0008, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } }));
                cbox(P.metal, [front - 0.008, sightBase + 0.0025, 0], [0.005, 0.0066, 0.003], 0.0005);
            } else {
                // Rifle sights: an aperture tower at the rear, a post between protective ears on a block at the front.
                const ry = sightBase - 0.0008, rx = r.rails ? S.rail[0] + 0.006 : xr0 + Lr * 0.12, fx = r.forend ? Math.min(bx1 - 0.03, f1 + 0.018) : bx1 - 0.03, fy = yb + rb;
                put(P.metal, HS.plate(HS.cut([[-0.0075, 0], [0.0075, 0], [0.0075, 0.015], [-0.0075, 0.015]], 0.004, [2, 3]), 0.006, 0.0008, { holes: [HS.circle(0, 0.0095, 0.0022, 10)], frame: { o: [rx, ry, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } }));
                cbox(P.under, [fx, fy, 0], [0.016, rb * 1.2 + 0.006, Math.max(0.014, rb * 2.6)], 0.0012);
                const tall = Math.max(sightBase, fy + 0.012) - fy + 0.004;
                put(P.metal, HS.plate([[-0.008, 0], [0.008, 0], [0.008, tall], [0.005, tall], [0.005, 0.006], [-0.005, 0.006], [-0.005, tall], [-0.008, tall]], 0.007, 0.0009, { frame: { o: [fx, fy + 0.002, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } }));
                cbox(P.metal, [fx, fy + 0.002 + (0.006 + tall - 0.002) / 2, 0], [0.002, tall - 0.004, 0.002], 0.0004);
            }
        } else if (r.sight === 'dot') {
            // A red dot: an angled hood with its window cut through, glass in it, a battery turret on the side.
            const x = xr0 + Lr * 0.3, len = 0.028, hood = HS.cut(rect(-0.013, 0, 0.013, 0.026), [0.003, 0.003, 0.008, 0.008]), win = HS.cut(rect(-0.0095, 0.006, 0.0095, 0.022), 0.0065);
            plate(P.under, HS.cut(rect(x - 0.006, sightBase, x + len + 0.004, sightBase + 0.006), 0.002, [2, 3]), 0.024, 0.0012);
            put(P.under, HS.plate(hood, len, 0.0012, { holes: [win], frame: { o: [x + len / 2, sightBase + 0.002, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } }));
            put(P.glass, HS.plate(win, 0.0015, 0, { frame: { o: [x + len * 0.7, sightBase + 0.002, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } }));
            P.metal.push(Mesh.lathe([[0.0055, 0], [0.0055, 0.005], [0.0045, 0.0062], [0, 0.0062]], 16, { base: [x + len * 0.45, sightBase + 0.013, 0.012], dir: [0, 0, 1], sharp: 0.5 }));
        } else if (r.sight === 'scope') {
            const sr = 0.014 + Lb * 0.012, sl = 0.14 + Lb * 0.18, sx = xr0 + Lr * 0.15, sy = sightBase + sr + 0.016;
            P.metal.push(Mesh.lathe([[sr * 1.35, 0], [sr * 1.35, 0.03], [sr, 0.05], [sr, sl - 0.05], [sr * 1.6, sl - 0.02], [sr * 1.6, sl]], 32, { base: [sx, sy, 0], dir: [1, 0, 0], sharp: 0.5 }));
            // Rings: a plate across the bore, its hole the tube, its foot on the rail.
            for (const k of [0.25, 0.7]) {
                const R = sr * 1.28, th = Math.acos(0.8 / 1.28), ringOutline = [[-sr * 0.8, 0], [sr * 0.8, 0]];
                for (let j = 0; j <= 12; j++) { const t = -th + j / 12 * (Math.PI + 2 * th); ringOutline.push([R * Math.cos(t), sy - sightBase + R * Math.sin(t)]); }
                put(P.under, HS.plate(ringOutline, 0.011, 0.0012, { holes: [HS.circle(0, sy - sightBase, sr * 1.002, 20)], frame: { o: [sx + sl * k, sightBase, 0], u: [0, 0, 1], v: [0, 1, 0], n: [1, 0, 0] } }));
            }
            P.glass.push(Mesh.lathe([[sr * 1.5, 0], [0, 0.001]], 24, { base: [sx + sl - 0.004, sy, 0], dir: [1, 0, 0] }), Mesh.lathe([[sr * 1.25, 0], [0, 0.001]], 24, { base: [sx + 0.004, sy, 0], dir: [-1, 0, 0] }));
        }

        // ── sci-fi: coils round the barrel, vents ──────────────────────────
        if (r.coils) {
            const windowed = style === 'truss' || style === 'heavy', c0 = (r.slide ? front : xr1) + 0.006, c1 = c0 + Math.max(0.014, Math.min(Lb - 0.021, r.coils * (windowed ? 0.042 : 0.026) + 0.01)), cl = c1 - c0;
            (glowing ? P.glow : P.dark).push(rod(c0, c1, yb, rb * (windowed ? 1.25 : 1.08), 20));
            if (windowed) {
                // A windowed hex shroud: six plates, a window per coil in each, the glowing core behind.
                const Rs = rb * 2.3 + 0.002, wf = Rs * 2 * Math.tan(Math.PI / 6) * 1.14, holes = [];
                for (let k = 0; k < r.coils; k++) { const u = -cl / 2 + cl * (k + 0.5) / r.coils, hw = cl / r.coils * 0.32; if (hw > 0.002) holes.push(HS.cut(rect(u - hw, -wf * 0.3, u + hw, wf * 0.3), Math.min(hw, wf * 0.3) * 0.5)); }
                for (let k = 0; k < 6; k++) {
                    const an = k * Math.PI / 3 + Math.PI / 6, cy = Math.cos(an), cz = Math.sin(an);
                    put(P.under, HS.plate(rect(-cl / 2, -wf / 2, cl / 2, wf / 2), 0.0022, 0.0006, { holes, frame: { o: [c0 + cl / 2, yb + cy * Rs, cz * Rs], u: [1, 0, 0], v: [0, -cz, cy], n: [0, cy, cz] } }));
                }
                for (const x of [c0 - 0.004, c1 - 0.002]) P.metal.push(turned(x, yb, [[rb * 1.1, 0], [Rs * 1.3, 0.001], [Rs * 1.3, 0.006], [rb * 1.1, 0.007]], 6, 0.9, Math.PI / 6));
            } else {
                // Finned: rings standing off the core, a spine along their tops.
                const fw = Math.min(0.009, cl / (r.coils * 1.9)), fr = rb * 2.4 + 0.002, lip = Math.min(0.0014, fw * 0.3);
                for (let k = 0; k < (fw > 0.0015 ? r.coils : 0); k++) { const x = c0 + cl * (k + 0.5) / r.coils - fw / 2; P.under.push(turned(x, yb, [[rb * 1.1, 0], [fr, lip], [fr, fw - lip], [rb * 1.1, fw]], 32)); }
                for (const x of [c0 - 0.004, c1 - 0.002]) P.metal.push(turned(x, yb, [[rb * 1.05, 0], [fr * 0.82, 0.001], [fr * 0.82, 0.006], [rb * 1.05, 0.007]], 24));
                plate(P.frame, HS.cut(rect(c0 - 0.004, yb + fr - 0.003, c1 + 0.003, yb + fr + 0.004), 0.002, [1, 2]), Math.max(0.004, rb * 0.8), 0.0008);
            }
        }
        if (r.vents) {
            // A louvered vent bank on the receiver's sides.
            const x0 = xr0 + Lr * 0.48, x1 = xr0 + Lr * 0.72, y0 = Hr * 0.22, y1 = Hr * 0.4, louvers = [];
            for (let k = 0; k < 4; k++) { const x = x0 + (x1 - x0) * (0.08 + k * 0.23); louvers.push({ outline: rect(x, y0 + 0.0025, x + (x1 - x0) * 0.13, y1 - 0.0025), depth: 0.0022, draft: 0.0006, side: 'both', apart: true }); }
            if (y1 - y0 > 0.007) plate(P.under, HS.cut(rect(x0, y0, x1, y1), 0.002), W + (scifi ? 0.012 : 0.005), 0.0008, { inset: louvers });
        }
        const construction = Construction.assemble({ recipe: r, r, P, marks, S, W, xr0, xr1, Lr, Hr, Lb, rb, yb, gx, gd, gw, back, gl, mxs, md, mh, mw, curve, f0, f1, fT, fB, fW, front, top, sightBase, loft, glowing, scifi, tx });
        return { P, marks, W, construction };
    }

    // ── the build ──────────────────────────────────────────────────────────
    const rigid = mesh => {
        const n = mesh.positions.length / 3, w = new Float32Array(n * 4);
        for (let i = 0; i < w.length; i += 4) w[i] = 1;
        return Object.assign(mesh, { joints: new Uint16Array(n * 4), weights: w });
    };
    /** Gun space to the world: on its side on the floor, its top away from the viewer. */
    const toWorld = ([x, y, z]) => [x, z, -y];

    function build(recipe, cache) {
        const r = normalize(recipe), c = cache || {}, { P, marks, construction } = body(r), textures = {};
        const frame = LOOK[r.frame], furn = FURNITURE_LOOK[r.furniture], chrome = r.frame === 'chrome';
        const parts = [];
        const add = (list, props) => { const m = list.length ? Mesh.merge(list) : null; if (m && m.index.length) parts.push(Object.assign(m, props)); return m; };
        add(P.frame, { name: 'Frame', kind: 'metal', color: frame.color || r.paint, roughness: frame.roughness, metalness: frame.metalness });
        add(P.under, { name: 'Underframe', kind: 'metal', color: chrome ? '#3a3d42' : '#363a41', roughness: 0.6, metalness: 0.35 });
        const furniture = add(P.furniture, { name: 'Furniture', kind: 'prop', color: r.furniture === 'painted' ? r.paint : furn.color, roughness: furn.roughness, metalness: furn.metalness });
        if (furniture && r.furniture === 'wood') {
            if (!c.wood) c.wood = Paint.wood('#7a4a28', 21);
            textures['wood.png'] = c.wood; furniture.texture = 'wood.png'; Mesh.planarUv(furniture, 0.25);
        }
        add(P.metal, { name: 'Metal', kind: 'metal', color: chrome ? '#d4d8de' : '#5d626b', roughness: chrome ? 0.16 : 0.34, metalness: 0.75 });
        add(P.dark, { name: 'Details', kind: 'metal', color: '#111113', roughness: 0.7, metalness: 0.3 });
        add(P.glass, { name: 'Lens', kind: 'glass', color: '#3a5a7a', roughness: 0.05, metalness: 0.2 });
        add(P.glow, { name: 'Glow', kind: 'prop', color: r.glow, roughness: 0.3, metalness: 0, emissive: r.glow });
        Surface.apply(parts, textures, p => ['Frame', 'Underframe', 'Metal', 'Details'].includes(p.name) ? 'metal' : p.name === 'Furniture' ? (r.furniture === 'wood' ? 'wood' : 'rubber') : null);
        for (const p of parts) Mesh.transform(p, toWorld, toWorld);
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p.positions[i + k]); hi[k] = Math.max(hi[k], p.positions[i + k]); }
        const shift = [-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2], move = p => [p[0] + shift[0], p[1] + shift[1], p[2] + shift[2]];
        for (const p of parts) { Mesh.transform(p, move); Object.assign(p, rigid(p)); Mesh.shade(p); }
        const round = v => Math.round(v * 10000) / 10000, markers = {};
        for (const [k, v] of Object.entries(marks)) markers[k] = move(toWorld(v)).map(round);
        let tall = 0;
        for (const p of parts) for (let i = 1; i < p.positions.length; i += 3) tall = Math.max(tall, p.positions[i]);
        // The Prop Builder shows the gun standing up (its top up, its right side to the viewer), clear of the floor; it saves lying down.
        const depth = hi[2] - lo[2], preview = { turn: [Math.PI / 2, 0, 0], lift: round(depth / 2 + Math.max(0.03, depth * 0.3)) };
        return {
            kind: 'gun', recipe: r, construction, parts, bones: [{ name: 'Prop', head: [0, 0, 0], parent: -1 }], clips: [], loop: null, textures, cloth: null,
            height: Math.max(0.05, tall), wall: null, length: round(hi[0] - lo[0]), markers, sidecarExtra: { rig: { template: 'gun', markers } }, holdable: 'gun', preview
        };
    }

    /**
     * A random firearm of one family (its own when only the shape or details
     * roll): sizes a little off its preset; details swap muzzle, sight, stock,
     * rails and magazine where the family allows; colors the frame, furniture, paint and glow.
     */
    function random(seed, recipe, scope) {
        const R = Rand.roll(seed), cur = normalize(recipe), out = JSON.parse(JSON.stringify(cur)), has = part => Rand.covers(scope, part);
        const family = !scope || scope === 'all' ? R.pick(PRESETS) : PRESETS.find(p => p[0] === cur.preset);
        const base = family[3], scifi = family[2] === 'scifi', long = base.stock !== 'none' || base.barrel.length > 0.3;
        out.preset = family[0];
        if (has('shape')) {
            out.barrel = { length: R.jitter(base.barrel.length, 0.15, 0.04, 1.2), thickness: R.jitter(base.barrel.thickness, 0.12, 0.006, 0.07) };
            out.receiver = { length: R.jitter(base.receiver.length, 0.12, 0.08, 0.7), height: R.jitter(base.receiver.height, 0.12, 0.025, 0.14) };
            out.grip = { angle: Math.max(0, Math.min(40, base.grip.angle + R.range(-5, 5))), length: R.jitter(base.grip.length, 0.1, 0.06, 0.16) };
            out.magSize = R.jitter(base.magSize || 1, 0.2, 0.4, 2);
        }
        if (has('details')) {
            const keep = (key, d) => (base[key] !== undefined ? base[key] : d);
            out.muzzle = scifi ? 'emitter' : R.chance(0.35) ? R.pick(['plain', 'brake', 'flash', 'suppressor']) : keep('muzzle', 'plain');
            out.style = R.chance(0.3) ? R.pick(STYLES.filter(st => SCIFI_STYLES.includes(st[0]) === scifi).map(st => st[0])) : base.style;
            out.sight = R.chance(0.35) ? R.pick(long ? ['iron', 'dot', 'scope'] : ['iron', 'dot', 'none']) : keep('sight', 'iron');
            out.rails = long ? R.chance(0.6) : R.chance(0.2);
            out.stock = base.stock === 'none' ? 'none' : R.chance(0.25) ? R.pick(['folding', 'full']) : base.stock;
            out.magazine = base.magazine === 'cylinder' || base.magazine === 'tube' || base.magazine === 'none' ? base.magazine : scifi ? R.pick(['cell', 'cell', 'drum']) : R.chance(0.2) ? 'drum' : base.magazine;
            if (scifi) { out.coils = Math.max(0, Math.min(8, (base.coils || 0) + R.int(-1, 2))); out.vents = R.chance(0.7); }
            out.forend = long ? R.chance(0.7) : !!base.forend;
        }
        if (has('colors')) {
            if (scifi) { out.frame = R.weighted([['painted', 4], ['chrome', 1], ['gunmetal', 1]]); out.furniture = R.pick(['painted', 'polymer']); out.paint = R.pick(Rand.PALETTES.paint); out.glow = R.pick(Rand.PALETTES.glow); }
            else { out.frame = R.weighted([['gunmetal', 4], ['polymer', base.frame === 'polymer' ? 3 : 1], ['chrome', family[0] === 'revolver' ? 2 : 0.4], ['painted', 0.6]]); out.furniture = R.weighted([['polymer', 3], ['wood', long || family[0] === 'revolver' ? 2.5 : 0.5], ['painted', 0.5]]); out.paint = R.pick(['#5a6a3a', '#3a3f4a', '#7a6a4a', '#1b1b1f', '#8a8a7a']); }
        }
        return normalize(out);
    }

    const api = { MAGAZINES, STOCKS, SIGHTS, MUZZLES, STYLES, FRAMES, FURNITURE, PRESETS, normalize, build, random };
    root.RRGunProp = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    const Model = root.RRPropModel, Catalog = root.RRPropCatalog || (typeof require === 'function' ? require('./PropCatalog.js') : null);
    if (Model && Model.register) Model.register({ id: 'gun', label: 'Firearm', normalize, build, random, randomScopes: [Rand.SCOPES.all, Rand.SCOPES.shape, Rand.SCOPES.details, Rand.SCOPES.colors] });
    if (Catalog) {
        const icon = { pistol: 'pistol', revolver: 'pistol', rifle: 'rifle', shotgun: 'shotgun', smg: 'rifle', sniper: 'rifle', blasterPistol: 'blaster', blasterRifle: 'blaster', plasma: 'cannon', laser: 'blaster' };
        for (const [id, label, category] of PRESETS) Catalog.add({ id: 'gun-' + id, category, label, icon: icon[id], kind: 'gun', keywords: 'gun weapon firearm ranged ' + id, start: () => normalize({ preset: id }), matches: r => r.preset === id });
        Catalog.ui('gun', {
            placeholder: 'Firearm',
            tabs: [['body', 'Body'], ['parts', 'Parts'], ['look', 'Look']],
            reset: recipe => normalize({ preset: recipe.preset }),
            panel(tab) {
                const r = this.recipe;
                if (tab === 'body') {
                    return this._section('Barrel') + this._slider({ path: 'barrel.length', label: 'Length', range: [0.04, 1.2], step: 0.01, format: 'm' })
                        + this._slider({ path: 'barrel.thickness', label: 'Thickness', range: [0.006, 0.07], step: 0.001, format: 'm' }) + this._select('muzzle', 'Muzzle', MUZZLES)
                        + this._section('Receiver') + this._select('style', 'Style', STYLES) + this._slider({ path: 'receiver.length', label: 'Length', range: [0.08, 0.7], step: 0.01, format: 'm' })
                        + this._slider({ path: 'receiver.height', label: 'Height', range: [0.025, 0.14], step: 0.002, format: 'm' })
                        + this._section('Grip') + this._slider({ path: 'grip.angle', label: 'Angle', range: [0, 40], step: 1, format: 'deg' }) + this._slider({ path: 'grip.length', label: 'Length', range: [0.06, 0.16], step: 0.005, format: 'm' });
                }
                if (tab === 'parts') {
                    return this._section('Parts') + this._select('magazine', 'Magazine', MAGAZINES) + (r.magazine !== 'none' ? this._slider({ path: 'magSize', label: 'Magazine size', range: [0.4, 2], format: 'x' }) : '')
                        + this._check('fasteners','Fasteners') + this._slider({path:'gripRibs',label:'Grip ribs',range:[0,16],step:1}) + this._select('stock', 'Stock', STOCKS) + this._select('sight', 'Sight', SIGHTS) + this._check('rails', 'Rails') + this._check('forend', 'Forend')
                        + this._section('Sci-fi') + this._slider({ path: 'coils', label: 'Glowing coils', range: [0, 8], step: 1, format: 'int' }) + this._check('vents', 'Vents');
                }
                return this._section('Materials') + this._select('frame', 'Body finish', FRAMES) + this._select('furniture', 'Grip and stock', FURNITURE)
                    + (r.frame === 'painted' || r.furniture === 'painted' ? this._color('paint', 'Paint', ['#d8dce4', '#3a3f4a', '#5a6a3a', '#7a2a22', '#1b1b1f']) : '')
                    + (r.coils>0||r.muzzle==='emitter'||r.magazine==='cell'?this._color('glow', 'Glow color', ['#38c8ff', '#ff5a3a', '#7aff6a', '#c86aff', '#ffd24a']):'');
            }
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
