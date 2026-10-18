/** Procedural hard armor: beveled plates fitted to the body, rigid on the bones that carry them. */
(function(root) {
    'use strict';
    const Outfit = root.RRCharacterOutfit || require('./CharacterOutfit.js');
    const add = (a, b) => a.map((x, i) => x + b[i]);
    const sub = (a, b) => a.map((x, i) => x - b[i]);
    const mul = (a, t) => a.map(x => x * t);
    const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
    const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const norm = a => mul(a, 1 / (Math.hypot(...a) || 1));
    const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
    const X = [1,0,0], Y = [0,1,0], Z = [0,0,1];
    const OCTAGON = [[-.65,1],[.65,1],[1,.65],[1,-.65],[.65,-1],[-.65,-1],[-1,-.65],[-1,.65]];

    class Mesh {
        constructor() { this.p=[]; this.n=[]; this.c=[]; this.j=[]; this.w=[]; this.i=[]; }
        face(points, color, joint, outward) {
            let n = norm(cross(sub(points[1], points[0]), sub(points[2], points[0])));
            if (outward && dot(n, outward) < 0) { points=points.slice().reverse(); n=mul(n,-1); }
            const base=this.p.length/3;
            for (const p of points) { this.p.push(...p); this.n.push(...n); this.c.push(...color); this.j.push(joint,0,0,0); this.w.push(1,0,0,0); }
            for (let k=1;k+1<points.length;k++) this.i.push(base,base+k,base+k+1);
        }
        /**
         * Rings of points (each the same count, closed round) joined into one smooth surface: shared
         * vertices, normals averaged from the faces round them, facing away from `inside`.
         */
        loft(rings, color, joint, inside, colorAt) {
            const base = this.p.length / 3, n = rings[0].length;
            rings.forEach((ring, r) => ring.forEach((p, k) => { this.p.push(...p); this.n.push(0, 0, 0); this.c.push(...(colorAt ? colorAt(r, k) : color)); this.j.push(joint, 0, 0, 0); this.w.push(1, 0, 0, 0); }));
            const first = this.i.length;
            for (let r = 0; r + 1 < rings.length; r++) for (let k = 0; k < n; k++) {
                const a = base + r * n + k, b = base + r * n + (k + 1) % n, c = base + (r + 1) * n + k, d = base + (r + 1) * n + (k + 1) % n;
                this.i.push(a, b, d, a, d, c);
            }
            // Wound to face out: test one face against the way out from the inside point.
            const at = q => [this.p[q * 3], this.p[q * 3 + 1], this.p[q * 3 + 2]];
            const mid = Math.floor(rings.length / 2) * n;
            const t = [this.i[first + mid * 6], this.i[first + mid * 6 + 1], this.i[first + mid * 6 + 2]];
            if (t.every(Number.isFinite)) {
                const fn = cross(sub(at(t[1]), at(t[0])), sub(at(t[2]), at(t[0])));
                if (dot(fn, sub(at(t[0]), inside(at(t[0])))) < 0) for (let q = first; q < this.i.length; q += 3) { const x = this.i[q + 1]; this.i[q + 1] = this.i[q + 2]; this.i[q + 2] = x; }
            }
            for (let q = first; q < this.i.length; q += 3) {
                const [a, b, c] = [this.i[q], this.i[q + 1], this.i[q + 2]];
                const fn = cross(sub(at(b), at(a)), sub(at(c), at(a)));
                for (const v of [a, b, c]) { this.n[v * 3] += fn[0]; this.n[v * 3 + 1] += fn[1]; this.n[v * 3 + 2] += fn[2]; }
            }
            for (let v = base; v < this.p.length / 3; v++) { const l = Math.hypot(this.n[v * 3], this.n[v * 3 + 1], this.n[v * 3 + 2]) || 1; this.n[v * 3] /= l; this.n[v * 3 + 1] /= l; this.n[v * 3 + 2] /= l; }
            return base;
        }
        part(name, material) {
            return Object.assign({ name, positions:Float32Array.from(this.p), normals:Float32Array.from(this.n), colors:Float32Array.from(this.c),
                joints:Uint8Array.from(this.j), weights:Float32Array.from(this.w), index:Uint32Array.from(this.i) },material);
        }
    }

    /** Closed plate, with an inset face and a real bevel instead of a painted edge. */
    function plate(mesh, outline, outward, depth, bevel, color, joint) {
        const center=mul(outline.reduce(add,[0,0,0]),1/outline.length);
        const inset=outline.map(p=>add(p,mul(norm(sub(center,p)),bevel)));
        const rings=[outline.map(p=>sub(p,mul(outward,depth))), outline.map(p=>sub(p,mul(outward,bevel))), inset];
        mesh.face(rings[0],mul(color,.62),joint,mul(outward,-1));
        for(let r=0;r<2;r++) for(let k=0;k<outline.length;k++) {
            const next=(k+1)%outline.length;
            const side=norm(sub(lerp(outline[k],outline[next],.5),center));
            mesh.face([rings[r][k],rings[r][next],rings[r+1][next],rings[r+1][k]],mul(color,r===0?.72:.93),joint,r===0?side:norm(add(side,outward)));
        }
        mesh.face(inset,color,joint,outward);
    }
    function rectangle(mesh, center, a, b, width, height, normal, color, joint, depth=.006, bevel=.002) {
        plate(mesh,[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>add(center,add(mul(a,x*width/2),mul(b,y*height/2)))),normal,depth,bevel,color,joint);
    }

    function context(pack,built,item) {
        const an=Outfit.anatomy(pack), P=built.shaped, ids=[...new Set(pack.body.source)];
        const bones=built.bones, bone=name=>bones.find(b=>b.name===name), joint=name=>bones.findIndex(b=>b.name===name);
        const scale=built.height/1.7, bulk=Math.max(0,Math.min(1.5,item.bulk??.6));
        const color=Outfit.linear(item.color||'#606d70'), trim=Outfit.linear(item.trim||'#273137'), accent=Outfit.linear(item.color2||'#e5ad55');
        const shell=new Mesh(), hardware=new Mesh(), indicators=new Mesh();
        const at=(v)=>[P[v*3],P[v*3+1],P[v*3+2]];
        const torsoIds=ids.filter(v=>an.member[v*5]>.55);
        function section(y) {
            let vertices=[];
            for(const band of [.024,.05,.1]) { vertices=torsoIds.filter(v=>Math.abs(P[v*3+1]-y)<band*scale); if(vertices.length>8)break; }
            let left=Infinity,right=-Infinity,front=-Infinity,back=Infinity;
            for(const v of vertices) { left=Math.min(left,P[v*3]);right=Math.max(right,P[v*3]);front=Math.max(front,P[v*3+2]);back=Math.min(back,P[v*3+2]); }
            return {left,right,front,back,cx:(left+right)/2,cz:(front+back)/2,width:(right-left)/2};
        }
        function envelope(name,family,t0,t1) {
            // Pack tails are drawing handles, not always the next articulation.
            const next=name.replace(/(ForeArm|UpLeg|Arm|Leg)$/, part=>({Arm:'ForeArm',ForeArm:'Hand',UpLeg:'Leg',Leg:'Foot'}[part]));
            const B=bone(name), end=bone(next).head, along=norm(sub(end,B.head));
            const front=norm(sub(Z,mul(along,dot(Z,along)))), side=norm(cross(along,front));
            const length=Math.hypot(...sub(end,B.head));
            let rx=.02*scale,rz=.02*scale;
            for(const v of ids) {
                if(an.member[v*5+family]<.45)continue;
                const q=sub(at(v),B.head),t=dot(q,along)/length;
                if(t<t0||t>t1)continue;
                rx=Math.max(rx,Math.abs(dot(q,side)));rz=Math.max(rz,Math.abs(dot(q,front)));
            }
            return {B,along,front,side,length,rx,rz,point:t=>lerp(B.head,end,t)};
        }
        return {pack,built,item,an,P,ids,bone,joint,scale,bulk,color,trim,accent,shell,hardware,indicators,at,section,envelope};
    }

    /** A rounded section (a squarish ellipse) of `n` points round an axis. */
    function roundSection(center, side, front, rx, rz, n=20, e=3) {
        return Array.from({length:n},(_,k)=>{ const a=k/n*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a), r=1/Math.pow(Math.pow(Math.abs(ca),e)+Math.pow(Math.abs(sa),e),1/e); return add(center,add(mul(front,ca*r*rz),mul(side,sa*r*rx))); });
    }
    /** A smooth tube through points (armored cabling), radius r. */
    function cable(mesh, points, r, color, joint) {
        const rings=points.map((p,i)=>{ const a=points[Math.max(0,i-1)], b=points[Math.min(points.length-1,i+1)], d=norm(sub(b,a)); const x=norm(cross(d,Math.abs(d[1])<.9?Y:X)), y=cross(d,x); return Array.from({length:8},(_,k)=>add(p,add(mul(x,Math.cos(k/8*Math.PI*2)*r),mul(y,Math.sin(k/8*Math.PI*2)*r)))); });
        mesh.loft(rings,color,joint,p=>points.reduce((best,q)=>Math.hypot(...sub(p,q))<Math.hypot(...sub(p,best))?q:best,points[0]));
        // Ribbed sleeves along it.
        for(let i=1;i+1<points.length;i+=2) mesh.loft([0,1].map(t=>rings[i].map(q=>add(q,mul(norm(sub(q,points[i])),r*.35+t*0)))).map((ring,t)=>ring.map(q=>add(q,mul(norm(sub(points[i+1],points[i])),(t-.5)*r*.8)))),mul(color,.8),joint,()=>points[i]);
    }
    /** A bolt head: a short hex on a face. */
    function bolt(mesh, at, normal, r, color, joint) {
        const x=norm(cross(normal,Math.abs(normal[1])<.9?Y:X)), y=cross(normal,x);
        const ring=h=>Array.from({length:6},(_,k)=>add(add(at,mul(normal,h)),add(mul(x,Math.cos(k/6*Math.PI*2)*r),mul(y,Math.sin(k/6*Math.PI*2)*r))));
        mesh.loft([ring(0),ring(r*.6)],color,joint,()=>sub(at,mul(normal,r)));
        mesh.face(ring(r*.6),mul(color,1.15),joint,normal);
    }

    /**
     * A rigid limb housing: a rounded, tapered shell (smooth, many-sided), a raised
     * rim at each end, a recessed seam round its middle, a raised front panel with
     * a reveal, and bolts at its ends.
     */
    function housing(C,name,family,lo,hi,extra=0) {
        const E=C.envelope(name,family,lo,hi), s=C.scale;
        const gap=(.015+.014*C.bulk+extra)*s;
        const radius=[E.rx+gap,E.rz+gap], joint=C.joint(name);
        const taper=/ForeArm$/.test(name)?.68:/UpLeg$/.test(name)?.78:/Leg$/.test(name)?.63:.82;
        const ts=[lo,lo+.02,lo+.05,.5*(lo+hi)-.012,.5*(lo+hi),.5*(lo+hi)+.012,hi-.05,hi-.02,hi];
        const width=t=>1+(taper-1)*(t-lo)/(hi-lo);
        // Rims stand proud, the seam sinks in.
        const swell=[.985,1.02,1,1,.965,1,1,1.02,.985];
        const rings=ts.map((t,r)=>roundSection(E.point(t),E.side,E.front,radius[0]*width(t)*swell[r],radius[1]*width(t)*swell[r]));
        C.shell.loft(rings,C.color,joint,p=>E.point(Math.max(lo,Math.min(hi,dot(sub(p,E.B.head),E.along)/E.length))),(r)=>r===4?mul(C.color,.5):r===1||r===7?mul(C.color,.92):C.color);
        // The ends closed with a dark cap (the undersuit shows through only at the joint).
        for(const [r,dir] of [[0,-1],[ts.length-1,1]]) C.shell.face(rings[r],mul(C.color,.6),joint,mul(E.along,dir));
        // A raised front panel with a narrow reveal.
        const frontCenter=add(E.point((lo+hi)/2-.08*(hi-lo)),mul(E.front,radius[1]*width((lo+hi)/2)+.003*s));
        const w=radius[0]*1.1,h=E.length*(hi-lo)*.42;
        plate(C.shell,OCTAGON.map(([x,y])=>add(frontCenter,add(mul(E.side,x*w/2),mul(E.along,y*h/2)))),E.front,.006*s,.0025*s,mul(C.color,1.05),joint);
        rectangle(C.hardware,add(frontCenter,mul(E.along,-h*.36)),E.side,E.along,w*.55,.006*s,E.front,C.trim,joint,.002*s,.0008*s);
        // Bolts round both rims.
        for(const t of [ts[1],ts[ts.length-2]]) for(const k of [3,8,13,18]) {
            const ring=roundSection(E.point(t),E.side,E.front,radius[0]*width(t)*1.02,radius[1]*width(t)*1.02), p=ring[k], n=norm(sub(p,E.point(t)));
            bolt(C.hardware,p,n,.0035*s,mul(C.trim,1.3),joint);
        }
        return E;
    }

    /** A layered joint guard: a main plate and a smaller one over it. */
    function layeredGuard(C,center,front,side,up,width,height,joint) {
        guard(C,center,front,side,up,width,height,joint);
        guard(C,add(add(center,mul(front,.008*C.scale)),mul(up,height*.12)),front,side,up,width*.62,height*.5,joint);
        bolt(C.hardware,add(add(center,mul(front,.016*C.scale)),mul(up,height*.12)),front,.004*C.scale,mul(C.trim,1.3),joint);
    }

    function guard(C,center,front,side,up,width,height,joint) {
        plate(C.shell,OCTAGON.map(([x,y])=>add(center,add(mul(side,x*width/2),mul(up,y*height/2)))),front,.012*C.scale,.005*C.scale,C.color,joint);
    }

    function torso(C) {
        const s=C.scale, gap=(.022+.018*C.bulk)*s;
        const hip=C.bone('Hips').head[1], neck=C.bone('Neck').head[1];
        const chestLow=C.bone('Spine1').head[1]+.025*s, top=neck-.018*s;
        const mid=(top+chestLow)/2, section=C.section(mid);
        const samples=Array.from({length:10},(_,i)=>C.section(chestLow+(top-chestLow)*i/9));
        const w=Math.max(...samples.map(v=>v.width))+.012*s;
        const front=Math.max(...samples.map(v=>v.front))+gap, back=Math.min(...samples.map(v=>v.back))-gap;
        const outline=[[-.65,1],[.65,1],[1,.6],[.86,-.6],[.45,-1],[-.45,-1],[-.86,-.6],[-1,.6]];
        for(const [z,normal] of [[front,Z],[back,mul(Z,-1)]]) {
            const points=outline.map(([x,y])=>[section.cx+x*w,mid+y*(top-chestLow)/2,z]);
            if(normal[2]<0)plate(C.shell,points,normal,.022*s,.007*s,C.color,C.joint('Spine2'));
            else for(const side of [-1,1]) {
                const half=[[.018,1],[.65,1],[1,.6],[.86,-.6],[.45,-1],[.018,-.87]];
                const slope=.025*s/w;
                plate(C.shell,half.map(([x,y])=>[section.cx+side*x*w,mid+y*(top-chestLow)/2,z+(1-x)*.025*s]),norm([side*slope,0,1]),.022*s,.006*s,C.color,C.joint('Spine2'));
            }
            // Recessed vent banks, kept low contrast; color is reserved for status lights.
            for(const side of [-1,1]) for(let row=0;row<3;row++) rectangle(C.hardware,[section.cx+side*w*.48,mid+.035*s-row*.016*s,z+normal[2]*.002*s+(normal[2]>0?.014*s:0)],X,Y,w*.3,.007*s,normal,C.trim,C.joint('Spine2'),.002*s,.0008*s);
        }
        // Wrap below the arm openings: the cuirass has real depth when seen from the side.
        for(const side of [-1,1]) for(const [a,b] of [[[1,.6],[.86,-.6]],[[.86,-.6],[.45,-1]]]) {
            const at=(p,z)=>[section.cx+side*p[0]*w,mid+p[1]*(top-chestLow)/2,z];
            C.shell.face([at(a,front+(1-a[0])*.025*s),at(a,back),at(b,back),at(b,front+(1-b[0])*.025*s)],mul(C.color,.76),C.joint('Spine2'),[side,0,0]);
        }
        rectangle(C.indicators,[section.cx-w*.42,top-.033*s,front+.021*s],X,Y,.035*s,.009*s,Z,C.accent,C.joint('Spine2'),.003*s,.001*s);
        // Rib housings wrap the torso below the arm openings.
        for(const side of [-1,1]) {
            const normal=[side,0,0], y=chestLow+.045*s, q=C.section(y);
            rectangle(C.hardware,[side>0?q.right+gap:q.left-gap,y,q.cz],Z,Y,(q.front-q.back)*.82,.085*s,normal,C.trim,C.joint('Spine1'),.012*s,.005*s);
        }
        // The abdomen has independent plates on successive spine bones, with breathing gaps.
        const bottom=hip+.01*s, end=chestLow-.012*s, count=3;
        for(let row=0;row<count;row++) {
            const y=bottom+(end-bottom)*(row+.5)/count,q=C.section(y),h=(end-bottom)/count-.009*s;
            const width=q.width*.9;
            for(const [z,normal] of [[q.front+gap*.75,Z],[q.back-gap*.75,mul(Z,-1)]]) {
                const points=OCTAGON.map(([x,yy])=>[q.cx+x*width,y+yy*h/2,z]);
                plate(C.shell,points,normal,.014*s,.004*s,mul(C.color,.89),C.joint(row===2?'Spine1':'Spine'));
            }
        }
        // Pelvic armor ends above the hip flexion crease; the dark suit remains visible between pieces.
        const pelvis=C.section(hip-.055*s);
        guard(C,[pelvis.cx,hip-.07*s,pelvis.front+gap],Z,X,Y,pelvis.width*1.45,.13*s,C.joint('Hips'));
        for(const side of [-1,1]) {
            const x=side>0?pelvis.right+gap:pelvis.left-gap;
            rectangle(C.shell,[x,hip-.035*s,pelvis.cz],Z,Y,(pelvis.front-pelvis.back)*.7,.14*s,[side,0,0],C.color,C.joint('Hips'),.018*s,.005*s);
        }
        // A gorget: a raised collar of two overlapping rings round the neck, meeting the helmet's rim.
        {
            const neck=C.bone('Neck').head, n=C.section(neck[1]-.01*s), joint=C.joint('Spine2');
            const rx=n.width+gap*.8, rz=(n.front-n.back)/2+gap*.8, c=[n.cx,neck[1],(n.front+n.back)/2];
            const rings=[[-.03,1.25],[-.012,1.18],[-.006,1.08],[.012,1.0],[.02,.97]].map(([dy,k])=>roundSection(add(c,[0,dy*s,0]),X,Z,rx*k,rz*k,24,3));
            C.shell.loft(rings,C.color,joint,p=>[c[0],p[1],c[2]],r=>r===2?mul(C.color,.55):C.color);
        }
        // A ridge down the breastplate and seams across it.
        C.shell.face([[section.cx-.008*s,top-.02*s,front+.026*s],[section.cx+.008*s,top-.02*s,front+.026*s],[section.cx+.008*s,chestLow+.02*s,front+.026*s],[section.cx-.008*s,chestLow+.02*s,front+.026*s]],mul(C.color,1.1),C.joint('Spine2'),Z);
        for(const k of [.3,.62]) for(const side of [-1,1]) rectangle(C.hardware,[section.cx+side*w*.55,chestLow+(top-chestLow)*k,front+.006*s+(1-.55)*.025*s],X,Y,w*.62,.0035*s,norm([side*.025*s/w,0,1]),C.trim,C.joint('Spine2'),.0015*s,.0006*s);
        // A compact power unit sits flush on the back plate.
        rectangle(C.hardware,[section.cx,mid,back-.035*s],X,Y,w*.85,(top-chestLow)*.62,mul(Z,-1),C.trim,C.joint('Spine2'),.05*s,.01*s);
        for(const side of [-1,1]) rectangle(C.shell,[section.cx+side*w*.26,mid,back-.04*s],X,Y,.04*s,(top-chestLow)*.44,mul(Z,-1),mul(C.color,.9),C.joint('Spine2'),.008*s,.003*s);
    }

    function undersuit(C,hands) {
        const body=C.built.parts[0], source=C.pack.body.source, hidden=new Set(), keep=[];
        // Gauntlets alone (item.only 'hands'): the glove from just above the wrist.
        const onHand=v=>(C.an.member[v*5+1]>.5&&C.an.s[v*5+1]>2.7)||(C.an.member[v*5+2]>.5&&C.an.s[v*5+2]>2.7);
        const cover=hands?onHand:v=>!(C.an.member[v*5]>.5&&C.an.s[v*5]>4.5);
        for(let t=0;t<body.index.length;t+=3) {
            const tri=[body.index[t],body.index[t+1],body.index[t+2]];
            if(!tri.every(v=>cover(source[v])))continue;
            keep.push(...tri);for(const v of tri)hidden.add(source[v]);
        }
        const positions=Float32Array.from(body.positions),colors=new Float32Array(positions.length);
        const rubber=Outfit.linear('#20272c');
        for(let i=0;i<positions.length;i+=3) {
            for(let k=0;k<3;k++)positions[i+k]+=body.normals[i+k]*.009*C.scale;
            colors.set(rubber,i);
        }
        return {part:Object.assign({},body,{name:'Power armor undersuit',positions,colors,index:Uint32Array.from(keep),texture:null,roughness:.88,metalness:0}),hidden};
    }

    function build(pack,built,item) {
        const C=context(pack,built,item),s=C.scale,hands=item.only==='hands';
        if(!hands)torso(C);
        for(const [side,armFamily,legFamily] of [['Left',1,3],['Right',2,4]]) {
            if(!hands) {
            // Shoulder plates pivot with the upper arm, leaving a clear elbow articulation.
            housing(C,side+'Arm',armFamily,.02,.32,.025);
            housing(C,side+'Arm',armFamily,.43,.84);
            const forearm=housing(C,side+'ForeArm',armFamily,.13,.91);
            const thigh=housing(C,side+'UpLeg',legFamily,.14,.85);
            const shin=housing(C,side+'Leg',legFamily,.15,.86);
            const elbow=add(forearm.B.head,mul(forearm.front,forearm.rz+.027*s));
            layeredGuard(C,elbow,forearm.front,forearm.side,forearm.along,forearm.rx*1.35,.075*s,C.joint(side+'ForeArm'));
            const knee=add(shin.B.head,mul(shin.front,Math.max(thigh.rz,shin.rz)+.026*s));
            layeredGuard(C,knee,shin.front,shin.side,shin.along,shin.rx*1.7,.105*s,C.joint(side+'Leg'));
            // Armored cables from the back unit over the shoulder, and down the outside of the thigh.
            const sx=side==='Left'?1:-1, chestTop=C.bone('Neck').head[1]-.04*s, back=C.section(chestTop).back-(.03+.02*C.bulk)*s;
            const arm=C.bone(side+'Arm').head;
            cable(C.hardware,[[sx*.06*s,chestTop-.06*s,back-.02*s],[sx*.11*s,chestTop+.0*s,back+.01*s],[arm[0]-sx*.02*s,arm[1]+.05*s,arm[2]-.03*s]],.007*s,C.trim,C.joint('Spine2'));
            }
            // Rigid hand back; the fingers stay on the flexible glove and bend freely.
            const hand=C.bone(side+'Hand'),index=C.bone(side+'HandIndex1'),pinky=C.bone(side+'HandPinky1');
            if(index&&pinky) {
                const across=norm(sub(index.head,pinky.head)),along=norm(sub(lerp(index.head,pinky.head,.5),hand.head));
                let normal=norm(cross(across,along));if(dot(normal,Z)>0)normal=mul(normal,-1);
                const center=add(lerp(hand.head,lerp(index.head,pinky.head,.5),.55),mul(normal,.016*s));
                guard(C,center,normal,across,along,Math.hypot(...sub(index.head,pinky.head))*.95,.065*s,C.joint(side+'Hand'));
            }
        }
        const base=undersuit(C,hands);
        const parts=[base.part,C.shell.part('Power armor plating',{roughness:.38,metalness:.65}),C.hardware.part('Power armor hardware',{roughness:.62,metalness:.25}),C.indicators.part('Power armor indicators',{roughness:.3,metalness:.25})];
        return {parts:parts.filter(p=>p.index.length),hidden:base.hidden};
    }

    /**
     * The helmet: a closed, rounded shell from the neck over the crown (each
     * height's section fitted round the head, jaw and chin included), a visor
     * set back into its face, a chin guard with breathing vents, ear modules,
     * a crest along the top and a status light.
     */
    function helmet(pack,built,item) {
        const C=context(pack,built,item),s=C.scale,P=C.P,head=C.joint('Head');
        const ids=C.ids.filter(v=>C.an.member[v*5]>.6&&C.an.s[v*5]>4.2);
        const eyes=built.parts.find(p=>p.name==='Eyes').positions;
        let eyeY=0;for(let i=1;i<eyes.length;i+=3)eyeY+=eyes[i];eyeY/=eyes.length/3;
        const crown=Math.max(...ids.map(v=>P[v*3+1])), neckY=C.bone('Neck').head[1]+.012*s;
        const gap=.016*s, SIDES=28, e=2.6;
        // Section extents at a height: forward, back, out to the sides (ears included), grown to their neighbors'.
        const extent=y=>{
            let f=-Infinity,b=Infinity,w=0,cx=0,n=0;
            for(const v of ids){ if(Math.abs(P[v*3+1]-y)>.014*s)continue; f=Math.max(f,P[v*3+2]); b=Math.min(b,P[v*3+2]); w=Math.max(w,Math.abs(P[v*3])); cx+=P[v*3]; n++; }
            return n?{f,b,w,cx:cx/n}:null;
        };
        // Heights: the neck, the jaw, the visor's edges (a sharp step there), the brow, toward the crown.
        const vLow=eyeY-.03*s, vHigh=eyeY+.026*s;
        const ys=[neckY, neckY+(vLow-neckY)*.3, neckY+(vLow-neckY)*.6, vLow-.008*s, vLow, eyeY, vHigh, vHigh+.008*s, vHigh+(crown-vHigh)*.45, crown-.03*s];
        const secs=ys.map(extent);
        for(let i=0;i<secs.length;i++) if(!secs[i]) secs[i]=secs[i-1]||secs.find(Boolean);
        for(const k of ['f','w']){ const raw=secs.map(x=>x[k]); secs.forEach((x,i)=>{ x[k]=Math.max(...raw.slice(Math.max(0,i-2),i+3)); }); }
        { const raw=secs.map(x=>x.b); secs.forEach((x,i)=>{ x.b=Math.min(...raw.slice(Math.max(0,i-2),i+3)); }); }
        // The neck ring narrower than the head: the shell closes under the jaw onto the collar.
        secs[0].w*=.92;
        const ringAt=(sec,y,grow,recess)=>Array.from({length:SIDES},(_,k)=>{
            const a=k/SIDES*Math.PI*2, ca=Math.cos(a), sa=Math.sin(a), cz=(sec.f+sec.b)/2;
            const hz=(ca>0?sec.f-cz:cz-sec.b)+gap, hx=sec.w+gap;
            let r=1/Math.pow(Math.pow(Math.abs(ca)/hz,e)+Math.pow(Math.abs(sa)/hx,e),1/e)*grow;
            // The visor's face set back into the shell.
            if(recess&&ca>Math.cos(1.0)) r-=recess*Math.min(1,(ca-Math.cos(1.0))/.12);
            return [sec.cx+sa*r,y,cz+ca*r];
        });
        const rings=ys.map((y,i)=>ringAt(secs[i],y,1,(i>=4&&i<=6)?.009*s:0));
        // Over the crown: rings closing to the top.
        const topSec=secs[secs.length-1], peak=crown+gap;
        for(let k=1;k<=5;k++){ const ph=k/5*Math.PI/2; rings.push(ringAt(topSec,topSec&&ys[ys.length-1]+(peak-ys[ys.length-1])*Math.sin(ph),Math.max(.04,Math.cos(ph)),0)); }
        const center=[0,eyeY,(secs[5].f+secs[5].b)/2];
        const shade=(r,k)=>{ const a=k/SIDES*Math.PI*2; const front=Math.cos(a)>Math.cos(1.0)&&r>=4&&r<=6; return front?mul(C.trim,.7):r===0?mul(C.color,.8):C.color; };
        C.shell.loft(rings,C.color,head,()=>center,shade);
        // The visor: a curved, dark glass band in the recess, just off its floor.
        const glass=[ringAt(secs[4],vLow+.002*s,1,.006*s),ringAt(secs[5],eyeY,1,.006*s),ringAt(secs[6],vHigh-.002*s,1,.006*s)].map(r=>r.filter((_,k)=>Math.cos(k/SIDES*Math.PI*2)>Math.cos(.95)));
        const order=r=>{ const front=r.map((p,k)=>[p,Math.atan2(p[0],p[2]-center[2])]).sort((a,b)=>a[1]-b[1]); return front.map(x=>x[0]); };
        const strips=glass.map(order);
        for(let r=0;r+1<strips.length;r++) for(let k=0;k+1<strips[r].length;k++) C.hardware.face([strips[r][k],strips[r][k+1],strips[r+1][k+1],strips[r+1][k]],Outfit.linear('#0c141b'),head,sub(lerp(strips[r][k],strips[r+1][k+1],.5),center));
        rectangle(C.indicators,add(strips[1][Math.floor(strips[1].length*.2)],[0,.006*s,.002*s]),X,Y,.03*s,.003*s,Z,C.accent,head,.001*s,.0005*s);
        // The chin guard: vents in a raised block under the visor.
        const chin=ringAt(secs[2],ys[2],1,0)[0];
        rectangle(C.hardware,add(chin,[0,0,.004*s]),X,Y,.05*s,.03*s,Z,C.trim,head,.006*s,.002*s);
        for(let i=-2;i<=2;i++) rectangle(C.shell,add(chin,[i*.009*s,0,.011*s]),X,Y,.004*s,.022*s,Z,mul(C.color,.55),head,.003*s,.001*s);
        // Ear modules: round housings either side.
        for(const side of [-1,1]){
            const ear=ringAt(secs[5],eyeY-.01*s,1,0)[side>0?Math.round(SIDES/4):Math.round(SIDES*3/4)];
            plate(C.hardware,OCTAGON.map(([x,y])=>add(ear,[0,y*.022*s,x*.022*s])),[side,0,0],.012*s,.004*s,C.trim,head);
            plate(C.indicators,OCTAGON.map(([x,y])=>add(ear,[side*.012*s,y*.006*s,x*.006*s])),[side,0,0],.003*s,.001*s,C.accent,head);
        }
        // A crest along the top, front to back.
        const crestPts=rings.slice(7).map(r=>r[0]).concat(rings.slice(7).reverse().map(r=>r[Math.round(SIDES/2)]));
        for(let k=0;k+1<crestPts.length;k++){ const a=crestPts[k],b=crestPts[k+1],up=norm(sub(lerp(a,b,.5),center)); C.shell.face([add(a,[-.006*s,0,0]),add(b,[-.006*s,0,0]),add(add(b,mul(up,.006*s)),[0,0,0]),add(add(a,mul(up,.006*s)),[0,0,0])],mul(C.color,1.08),head,[-1,0,0]); C.shell.face([add(a,[.006*s,0,0]),add(a,mul(up,.006*s)),add(b,mul(up,.006*s)),add(b,[.006*s,0,0])],mul(C.color,1.08),head,[1,0,0]); }
        const hidden=new Set(C.ids.filter(v=>C.an.member[v*5]>.5&&C.an.s[v*5]>4.3));
        return {parts:[C.shell.part('Power helmet plating',{roughness:.38,metalness:.65}),C.hardware.part('Power helmet visor',{roughness:.12,metalness:.6}),C.indicators.part('Power helmet indicators',{roughness:.3,metalness:.25})],hidden};
    }
    const api={build,helmet};
    root.RRCharacterPowerArmor=api;
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
