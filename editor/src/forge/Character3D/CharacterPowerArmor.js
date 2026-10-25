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

    const clamp01=v=>Math.max(0,Math.min(1,v));
    const smooth=(a,b,x)=>{const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
    const mix=(a,b,t)=>a.map((x,i)=>x+(b[i]-x)*t);
    /** A worn edge catches more light than the face it bounds. */
    const lighten=(c,k=.14)=>c.map(x=>Math.min(1,x*(1+k)+k*.3));
    const nearest=(list,p)=>{let best=list[0],d=Infinity;for(const q of list){const e=(q[0]-p[0])**2+(q[1]-p[1])**2+(q[2]-p[2])**2;if(e<d){d=e;best=q;}}return best;};
    /** Each surface material: roughness, metalness and the tiled finish RRCharacterGarmentDetails.armorFinish gives it. */
    const SURFACE={metal:{rough:.3,metal:.85,finish:'steel'},gold:{rough:.26,metal:.95,finish:'steel'},leather:{rough:.62,metal:0,finish:'leather'},
        cloth:{rough:.78,metal:0,finish:'painted'},silk:{rough:.5,metal:0,finish:'painted'},plastic:{rough:.42,metal:0,finish:'painted'},rubber:{rough:.7,metal:0,finish:'painted'}};

    /** Triangles with a texture coordinate per vertex: metres along the
     * surface times `uv` tiles per metre, so a tiled finish keeps its size. */
    class Mesh {
        constructor(uv=8) { this.p=[]; this.n=[]; this.c=[]; this.j=[]; this.w=[]; this.i=[]; this.t=[]; this.uv=uv; }
        push(p,n,c,joint,u=0,v=0) { this.p.push(p[0],p[1],p[2]); this.n.push(n[0],n[1],n[2]); this.c.push(c[0],c[1],c[2]); this.j.push(joint,0,0,0); this.w.push(1,0,0,0); this.t.push(u*this.uv,v*this.uv); return this.p.length/3-1; }
        face(points, color, joint, outward) {
            // Newell's normal: robust for a fan whose first corners are nearly in line.
            let n=[0,0,0];
            for(let k=0;k<points.length;k++){const a=points[k],b=points[(k+1)%points.length];n=add(n,[(a[1]-b[1])*(a[2]+b[2]),(a[2]-b[2])*(a[0]+b[0]),(a[0]-b[0])*(a[1]+b[1])]);}
            n=norm(n);
            if (outward && dot(n, outward) < 0) { points=points.slice().reverse(); n=mul(n,-1); }
            const a=norm(cross(n,Math.abs(n[1])<.9?Y:X)),b=cross(n,a),base=this.p.length/3;
            for (const p of points) this.push(p,n,color,joint,dot(p,a),dot(p,b));
            for (let k=1;k+1<points.length;k++) this.i.push(base,base+k,base+k+1);
        }
        /**
         * Rings of points (each the same count, closed round unless `open`) joined into one smooth
         * surface: normals averaged from the faces round them, facing away from `inside`. A closed
         * ring repeats its first point so the finish's coordinates do not wrap back across one face.
         */
        loft(rings, color, joint, inside, colorAt, open = false) {
            const base = this.p.length / 3, n = rings[0].length, cols = open ? n : n + 1;
            let v = 0;
            rings.forEach((ring, r) => {
                if (r) { let d = 0; for (let k = 0; k < n; k++) d += Math.hypot(...sub(ring[k], rings[r - 1][k])); v += d / n; }
                let u = 0;
                for (let k = 0; k < cols; k++) { const q = k % n; if (k) u += Math.hypot(...sub(ring[q], ring[k - 1])); this.push(ring[q], [0, 0, 0], colorAt ? colorAt(r, q) : color, joint, u, v); }
            });
            const first = this.i.length;
            for (let r = 0; r + 1 < rings.length; r++) for (let k = 0; k + 1 < cols; k++) {
                const a = base + r * cols + k, b = a + 1, c = a + cols, d = c + 1;
                this.i.push(a, b, d, a, d, c);
            }
            // Wound to face out: every face votes, weighted by its area, against the way out from the inside.
            const at = q => [this.p[q * 3], this.p[q * 3 + 1], this.p[q * 3 + 2]];
            let vote = 0;
            for (let q = first; q < this.i.length; q += 3) {
                const A = at(this.i[q]), fn = cross(sub(at(this.i[q + 1]), A), sub(at(this.i[q + 2]), A));
                vote += dot(fn, sub(A, inside(A)));
            }
            if (vote < 0) for (let q = first; q < this.i.length; q += 3) { const x = this.i[q + 1]; this.i[q + 1] = this.i[q + 2]; this.i[q + 2] = x; }
            for (let q = first; q < this.i.length; q += 3) {
                const [a, b, c] = [this.i[q], this.i[q + 1], this.i[q + 2]];
                const fn = cross(sub(at(b), at(a)), sub(at(c), at(a)));
                for (const x of [a, b, c]) { this.n[x * 3] += fn[0]; this.n[x * 3 + 1] += fn[1]; this.n[x * 3 + 2] += fn[2]; }
            }
            if (!open) for (let r = 0; r < rings.length; r++) {
                const a = base + r * cols, b = a + n;
                for (let k = 0; k < 3; k++) { const s = this.n[a * 3 + k] + this.n[b * 3 + k]; this.n[a * 3 + k] = this.n[b * 3 + k] = s; }
            }
            for (let x = base; x < this.p.length / 3; x++) { const l = Math.hypot(this.n[x * 3], this.n[x * 3 + 1], this.n[x * 3 + 2]) || 1; this.n[x * 3] /= l; this.n[x * 3 + 1] /= l; this.n[x * 3 + 2] /= l; }
            return base;
        }
        part(name, material) {
            return Object.assign({ name, positions:Float32Array.from(this.p), normals:Float32Array.from(this.n), colors:Float32Array.from(this.c),
                joints:Uint8Array.from(this.j), weights:Float32Array.from(this.w), index:Uint32Array.from(this.i), armorUvs:Float32Array.from(this.t), uvDensity:this.uv },material);
        }
    }

    /**
     * Closed plate: a back, a side wall and a rounded chamfer onto its face, all one smooth
     * surface (no dark painted bevel); `opts.roll` adds a rolled bead of that radius along the
     * outline, `opts.edge` how much lighter the worn chamfer is.
     */
    function plate(mesh, outline, outward, depth, bevel, color, joint, opts={}) {
        outward=norm(outward);
        const n=outline.length, center=mul(outline.reduce(add,[0,0,0]),1/n);
        let turn=[0,0,0];
        for(let k=0;k<n;k++)turn=add(turn,cross(sub(outline[k],center),sub(outline[(k+1)%n],center)));
        if(dot(turn,outward)<0)outline=outline.slice().reverse();
        const inward=outline.map((p,k)=>{
            const a=outline[(k+n-1)%n],b=outline[(k+1)%n],n1=norm(cross(outward,norm(sub(p,a)))),n2=norm(cross(outward,norm(sub(b,p)))),m=norm(add(n1,n2));
            return mul(m,1/Math.max(.45,dot(m,n1)));
        });
        const reach=Math.min(...outline.map(p=>Math.hypot(...sub(p,center))));
        bevel=Math.min(bevel,depth*.85,reach*.4);
        const at=(k,inset,h)=>add(add(outline[k],mul(inward[k],inset)),mul(outward,h));
        const edge=opts.edge??1.12;
        // Slats and small hardware need no rounding step; their chamfer alone catches the light.
        const profile=bevel<.0012?[[0,-depth,.72],[0,-bevel,1],[bevel,0,edge]]:[[0,-depth,.72],[0,-bevel,1],[bevel*.29,-bevel*.29,edge],[bevel,0,1.03]];
        const rings=profile.map(([i,h])=>outline.map((_,k)=>at(k,i,h)));
        mesh.loft(rings,color,joint,p=>add(center,mul(outward,dot(sub(p,center),outward)-depth)),(r)=>mul(color,profile[r][2]));
        mesh.face(rings.at(-1),color,joint,outward);
        mesh.face(rings[0],mul(color,.62),joint,mul(outward,-1));
        if(opts.roll)bead(mesh,outline.map((_,k)=>at(k,opts.roll*.55,-opts.roll*.3)),true,opts.roll,lighten(color,.1),joint,()=>outward,opts.sides||8);
    }
    /** A rectangle; anything larger than a slat gets rounded corners. */
    function rectangle(mesh, center, a, b, width, height, normal, color, joint, depth=.006, bevel=.002, opts) {
        const r=Math.min(width,height)>.03?Math.min(width,height)*.2:0;
        const corners=[[1,1],[-1,1],[-1,-1],[1,-1]];
        const outline=r?corners.flatMap(([x,y],c)=>[0,1,2].map(q=>{const t=(c+q/2*1)*Math.PI/2;const cx=x*(width/2-r),cy=y*(height/2-r);return [cx+Math.cos(t)*r,cy+Math.sin(t)*r];})):corners.map(([x,y])=>[x*width/2,y*height/2]);
        plate(mesh,outline.map(([x,y])=>add(center,add(mul(a,x),mul(b,y)))),normal,depth,bevel,color,joint,opts);
    }
    /** A rolled bead (a smooth tube of `sides`) along a path; `outwardAt` lifts it off its surface by `lift`·r. */
    function bead(mesh, path, closed, r, color, joint, outwardAt, sides=8, lift=0) {
        const N=path.length; if(N<2)return;
        const rings=[],centers=[];
        for(let i=0;i<N;i++){
            const prev=path[closed?(i+N-1)%N:Math.max(0,i-1)],next=path[closed?(i+1)%N:Math.min(N-1,i+1)];
            const T=norm(sub(next,prev));let O=outwardAt(path[i],i);O=norm(sub(O,mul(T,dot(O,T))));const B=cross(T,O);
            const c=add(path[i],mul(O,r*lift));centers.push(c);
            rings.push(Array.from({length:sides},(_,k)=>{const a=k/sides*Math.PI*2;return add(c,add(mul(O,Math.cos(a)*r),mul(B,Math.sin(a)*r)));}));
        }
        if(closed){rings.push(rings[0]);centers.push(centers[0]);}
        mesh.loft(rings,color,joint,p=>nearest(centers,p));
        if(!closed){mesh.face(rings[0],color,joint,sub(centers[0],centers[1]));mesh.face(rings.at(-1),color,joint,sub(centers.at(-1),centers.at(-2)));}
    }
    /** A domed rivet head. */
    function rivet(mesh, at, normal, r, color, joint) {
        normal=norm(normal);
        const x=norm(cross(normal,Math.abs(normal[1])<.9?Y:X)),y=cross(normal,x);
        const ring=(h,k)=>Array.from({length:5},(_,i)=>add(add(at,mul(normal,h)),add(mul(x,Math.cos(i/5*Math.PI*2)*k),mul(y,Math.sin(i/5*Math.PI*2)*k))));
        const mid=ring(r*.38,r*.78),tip=add(at,mul(normal,r*.66));
        mesh.loft([ring(-r*.3,r),mid],color,joint,()=>sub(at,mul(normal,r*2)));
        for(let i=0;i<5;i++)mesh.face([mid[i],mid[(i+1)%5],tip],color,joint,add(normal,norm(sub(lerp(mid[i],mid[(i+1)%5],.5),at))));
    }
    /** A buckle: a rectangular frame `bar` thick standing off the strap, and its tongue. */
    function buckle(mesh, center, a, b, w, h, bar, normal, color, joint) {
        const ring=(dw,dh,lift)=>[[1,1],[-1,1],[-1,-1],[1,-1]].map(([x,y])=>add(add(center,mul(normal,lift)),add(mul(a,x*(w/2+dw)),mul(b,y*(h/2+dh)))));
        mesh.loft([ring(0,0,0),ring(0,0,bar),ring(-bar,-bar,bar),ring(-bar,-bar,0),ring(0,0,0)],color,joint,()=>sub(center,mul(normal,bar*4)),null,false);
        const t=[add(center,mul(b,h*.42)),add(center,mul(b,-h*.42))].map(p=>add(p,mul(normal,bar*1.1)));
        mesh.face([add(t[0],mul(a,-bar*.4)),add(t[0],mul(a,bar*.4)),add(t[1],mul(a,bar*.4)),add(t[1],mul(a,-bar*.4))],lighten(color,.08),joint,normal);
    }
    /** A pyramid stud (studded leather). */
    function stud(mesh, at, normal, r, color, joint, up=Y) {
        normal=norm(normal);
        const x=norm(cross(normal,Math.abs(dot(normal,up))<.9?up:X)),y=cross(normal,x),tip=add(at,mul(normal,r*.9));
        const base=[[1,1],[-1,1],[-1,-1],[1,-1]].map(([a,b])=>add(add(at,mul(normal,-r*.2)),add(mul(x,a*r),mul(y,b*r))));
        for(let k=0;k<4;k++)mesh.face([base[k],base[(k+1)%4],tip],mul(color,k%2?1.06:.94),joint,add(mul(normal,.5),norm(sub(lerp(base[k],base[(k+1)%4],.5),at))));
    }
    /**
     * A decorative band (etched steel or tooled leather) lying just off its plate between two
     * rows of points: `u` runs along it in band heights, `v` across it, for the band picture.
     */
    function band(mesh, rowA, rowB, color, joint, outAt, lift) {
        if(rowA.length<2)return;
        const base=mesh.p.length/3;let u=0;
        const width=rowA.reduce((s,p,k)=>s+Math.hypot(...sub(p,rowB[k])),0)/rowA.length||1;
        for(let k=0;k<rowA.length;k++){
            if(k)u+=Math.hypot(...sub(rowA[k],rowA[k-1]));
            for(const [row,v] of [[rowA,0],[rowB,1]]){const n=outAt(row[k]);mesh.push(add(row[k],mul(n,lift)),n,color,joint,u/width/4,v);}
        }
        const P=q=>[mesh.p[q*3],mesh.p[q*3+1],mesh.p[q*3+2]];
        for(let k=0;k+1<rowA.length;k++){
            const a=base+k*2,b=a+1,c=a+2,d=a+3,fn=cross(sub(P(c),P(a)),sub(P(b),P(a)));
            if(dot(fn,outAt(P(a)))>0)mesh.i.push(a,c,b,b,c,d);else mesh.i.push(a,b,c,b,d,c);
        }
    }
    /** A point `dist` along column `k` of a stack of rings, from its first (or last) ring. */
    function along(rings, k, dist, fromEnd=false) {
        const list=fromEnd?rings.slice().reverse():rings;
        for(let r=0;r+1<list.length;r++){const a=list[r][k],b=list[r+1][k],l=Math.hypot(...sub(b,a));if(dist<=l||r+2===list.length)return lerp(a,b,Math.min(1,dist/(l||1)));dist-=l;}
        return list.at(-1)[k];
    }
    /**
     * A thin rigid sheet over a grid of points (rows × columns): its outer face, an inner face
     * `thickness` under it (toward `inward(p)`), and the walls round its border.
     */
    function sheet(mesh, grid, thickness, color, joint, inward, colorAt) {
        const inner=grid.map(row=>row.map(p=>add(p,mul(inward(p),thickness))));
        mesh.loft(grid,color,joint,p=>add(p,inward(p)),colorAt,true);
        mesh.loft(inner,mul(color,.7),joint,p=>sub(p,inward(p)),null,true);
        const R=grid.length,K=grid[0].length;
        const border=(g)=>g[0].concat(g.slice(1).map(r=>r[K-1]),g[R-1].slice(0,-1).reverse(),g.slice(1,-1).reverse().map(r=>r[0]));
        const center=mul(grid.flat().reduce(add,[0,0,0]),1/(R*K));
        mesh.loft([border(grid),border(inner)],mul(color,1.08),joint,p=>{const q=sub(center,p);return add(p,mul(norm(q),.001));});
    }
    /** Angles round a section, closer together at the front (angle 0) where flutes and relief need them. */
    function frontAngles(n, focus=1) { return Array.from({length:n},(_,k)=>{const x=2*k/n-1;return Math.PI*x*(focus+(1-focus)*x*x);}); }

    /** Project a formed shell's silhouette in two planes. The convex outlines
     * bridge skin folds vertically, so neighboring armor rows cannot turn into
     * alternating wide discs and narrow bands on an exaggerated torso. */
    function formedSections(points) {
        const hull=axis=>{
            const list=points.map(p=>[p[1],p[axis]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
            const a=[],b=[];
            for(const p of list){while(a.length>1&&cross(a.at(-2),a.at(-1),p)<=0)a.pop();a.push(p);}
            for(let i=list.length-1;i>=0;i--){const p=list[i];while(b.length>1&&cross(b.at(-2),b.at(-1),p)<=0)b.pop();b.push(p);}
            return a.slice(0,-1).concat(b.slice(0,-1));
        };
        const sides=hull(0),depth=hull(2),low=Math.min(...points.map(p=>p[1])),high=Math.max(...points.map(p=>p[1]));
        const extent=(polygon,y)=>{
            let lo=Infinity,hi=-Infinity;
            for(let i=0;i<polygon.length;i++){
                const a=polygon[i],b=polygon[(i+1)%polygon.length];if(y<Math.min(a[0],b[0])-1e-7||y>Math.max(a[0],b[0])+1e-7)continue;
                if(Math.abs(a[0]-b[0])<1e-9){lo=Math.min(lo,a[1],b[1]);hi=Math.max(hi,a[1],b[1]);continue;}
                const v=a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]);lo=Math.min(lo,v);hi=Math.max(hi,v);
            }return[lo,hi];
        };
        return y=>{y=Math.max(low+1e-6,Math.min(high-1e-6,y));const[left,right]=extent(sides,y),[back,front]=extent(depth,y);return{left,right,front,back,cx:(left+right)/2,cz:(front+back)/2,width:(right-left)/2};};
    }

    function context(pack,built,item) {
        const an=Outfit.anatomy(pack), P=built.shaped, ids=[...new Set(pack.body.source)];
        const bones=built.bones, bone=name=>bones.find(b=>b.name===name), joint=name=>bones.findIndex(b=>b.name===name);
        const scale=built.height/1.7, bulk=Math.max(0,Math.min(1.5,item.bulk??.6));
        const color=Outfit.linear(item.color||'#606d70'), trim=Outfit.linear(item.trim||'#273137'), accent=Outfit.linear(item.color2||'#e5ad55');
        const shell=new Mesh(), hardware=new Mesh(), indicators=new Mesh();
        const at=(v)=>[P[v*3],P[v*3+1],P[v*3+2]];
        const torsoIds=ids.filter(v=>an.member[v*5]>.55);
        const section=formedSections(torsoIds.filter(v=>an.s[v*5]>.0&&an.s[v*5]<4.05).map(at));
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

    /** An inset vent: a dark floor inside a raised bezel, crossed by slats. */
    function vent(mesh, center, a, b, w, h, normal, color, joint, s) {
        rectangle(mesh,center,a,b,w,h,normal,mul(color,.5),joint,.0015*s,.0005*s);
        for(const [x,y,ww,hh] of [[0,h/2,w+.006*s,.003*s],[0,-h/2,w+.006*s,.003*s],[w/2,0,.003*s,h],[-w/2,0,.003*s,h]])
            rectangle(mesh,add(center,add(mul(a,x),mul(b,y))),a,b,ww,hh,normal,mul(color,1.25),joint,.0042*s,.0014*s);
        for(let i=1;i<5;i++)rectangle(mesh,add(center,mul(b,-h/2+h*i/5)),a,b,w*.94,.0026*s,normal,mul(color,1.15),joint,.0028*s,.0009*s);
    }
    /** A hazard panel: diagonal stripes in `color` over a black field. */
    function hazard(mesh, center, a, b, w, h, normal, color, joint, s) {
        rectangle(mesh,center,a,b,w,h,normal,Outfit.linear('#15181b'),joint,.0015*s,.0005*s);
        const m=.0025*s, lift=add(center,mul(normal,.0004*s)), step=w/5, slope=h*.7;
        const clip=(poly,keep,cut)=>{const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],kp=keep(p),kq=keep(q);if(kp)out.push(p);if(kp!==kq)out.push(cut(p,q));}return out;};
        const along=(k,v)=>(p,q)=>{const t=(v-p[k])/(q[k]-p[k]);return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];};
        for(let i=-2;i<=5;i++){
            const x0=-w/2+i*step;let poly=[[x0,-h/2],[x0+step/2,-h/2],[x0+step/2+slope,h/2],[x0+slope,h/2]];
            for(const [k,v,sg] of [[0,-w/2+m,1],[0,w/2-m,-1],[1,-h/2+m,1],[1,h/2-m,-1]])if(poly.length)poly=clip(poly,p=>(p[k]-v)*sg>=0,along(k,v));
            if(poly.length>2)mesh.face(poly.map(([x,y])=>add(lift,add(mul(a,x),mul(b,y)))),color,joint,normal);
        }
    }
    /**
     * A soft pouch: a rounded, slightly bellied body hung on the surface at `at` (facing +z),
     * a stitched flap folded over its top and down its front, and a snap.
     */
    function pouch(body, fittings, at, w, h, d, color, joint, s, snapColor) {
        const K=16, rows=[[-.5,.82,.72],[-.42,.97,.95],[0,1,1.05],[.38,1,1],[.5,.97,.96]];
        const ring=(y,sx,sz)=>Array.from({length:K},(_,k)=>{const a=k/K*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),r=1/Math.pow(Math.abs(ca)**4+Math.abs(sa)**4,.25);return add(at,[sa*r*w/2*sx,y*h,d/2+ca*r*d/2*sz]);});
        const rings=rows.map(([y,sx,sz])=>ring(y,sx,sz)), mid=add(at,[0,0,d/2]);
        body.loft(rings,color,joint,p=>[mid[0],p[1],mid[2]],(r,k)=>mul(color,r===0?.8:1));
        body.face(rings[0],mul(color,.8),joint,[0,-1,0]);body.face(rings.at(-1),mul(color,.9),joint,[0,1,0]);
        // The flap: over the top from the back, round the front edge and two fifths down the front.
        const flap=mul(color,.92), path=[];
        for(let i=0;i<=3;i++){const t=i/3;path.push([d*(-.05+.85*t),h*.5+.004*s*Math.sin(Math.PI*t)]);}
        for(let i=1;i<=2;i++){const a=i/2*Math.PI/2;path.push([d*.8+Math.sin(a)*d*.22,h*.5+.004*s-(1-Math.cos(a))*d*.22]);}
        for(let i=1;i<=3;i++)path.push([d*1.02+.001*s,h*.5-d*.22-(h*.4-d*.22)*i/3]);
        const cols=Array.from({length:9},(_,c)=>-.5-.03+c/8*1.06);
        const grid=path.map(([z,y],r)=>cols.map(u=>{const round=r>=path.length-2?1-.12*(r-path.length+3)*Math.abs(u*2)**6:1;return add(at,[u*w*round*1.04,y,z+.002*s]);}));
        sheet(body,grid,.002*s,flap,joint,p=>norm(sub(mid,p)));
        const tip=grid.at(-1)[4];
        rivet(fittings,add(tip,[0,.007*s,.0012*s]),Z,.004*s,snapColor,joint);
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
        const N=24, grooves=[3,N-3];
        const rings=ts.map((t,r)=>roundSection(E.point(t),E.side,E.front,radius[0]*width(t)*swell[r],radius[1]*width(t)*swell[r],N));
        // Recessed panel lines down the front, either side of the raised panel.
        rings.forEach((ring,r)=>{if(r<2||r>ts.length-3)return;const c=E.point(ts[r]);for(const k of grooves)ring[k]=sub(ring[k],mul(norm(sub(ring[k],c)),.0017*s));});
        C.shell.loft(rings,C.color,joint,p=>E.point(Math.max(lo,Math.min(hi,dot(sub(p,E.B.head),E.along)/E.length))),(r,k)=>r===4?mul(C.color,.5):grooves.includes(k)&&r>1&&r<ts.length-2?mul(C.color,.55):r===1||r===7?mul(C.color,.92):C.color);
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
        E.shell=radius;E.ts=[lo,hi];
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
        // A housing follows several chest sections instead of a box sized
        // from the widest/deepest sample anywhere between belly and collar.
        // It stays one rigid piece on Spine2; its rest shape is formed metal.
        const chestRings=Array.from({length:9},(_,r)=>{
            const t=r/8,y=chestLow+(top-chestLow)*t,q=C.section(y),axis=[q.cx,y,q.cz];
            let rx=q.width+gap,rz=(q.front-q.back)/2+gap,grow=1;
            for(const v of C.ids)if(C.an.member[v*5]>.55&&Math.abs(C.P[v*3+1]-y)<.025*s){
                grow=Math.max(grow,(Math.abs((C.P[v*3]-q.cx)/rx)**3+Math.abs((C.P[v*3+2]-q.cz)/rz)**3)**(1/3));
            }
            rx*=grow;rz*=grow;
            return roundSection(axis,X,Z,rx,rz,32,3);
        });
        // Panel lines: two grooves down the breast either side of the ridge, one across under the vents.
        const chestGrooves=[5,27];
        chestRings.forEach((ring,r)=>{const q=C.section(ring[0][1]),c=[q.cx,ring[0][1],q.cz];ring.forEach((p,k)=>{
            const cut=(r>0&&r<8&&chestGrooves.includes(k))||(r===3&&Math.cos(k/32*Math.PI*2)>-.2);
            if(cut)ring[k]=sub(p,mul(norm([p[0]-c[0],0,p[2]-c[2]]),.0017*s));});});
        C.shell.loft(chestRings,C.color,C.joint('Spine2'),p=>{const q=C.section(p[1]);return[q.cx,p[1],q.cz];},(r,k)=>(r>0&&r<8&&chestGrooves.includes(k))||(r===3&&Math.cos(k/32*Math.PI*2)>-.2)?mul(C.color,.55):C.color);
        const chestFace=(x,y,side=1)=>{
            const u=Math.max(0,Math.min(7.99999,(y-chestLow)/(top-chestLow)*8)),r=Math.floor(u),t=u-r;
            const ring=chestRings[r].map((p,k)=>lerp(p,chestRings[r+1][k],t));
            let z=side>0?-Infinity:Infinity;
            for(let k=0;k<ring.length;k++){const a=ring[k],b=ring[(k+1)%ring.length];if(x<Math.min(a[0],b[0])||x>Math.max(a[0],b[0])||Math.abs(a[0]-b[0])<1e-9)continue;const d=(x-a[0])/(b[0]-a[0]),v=a[2]+d*(b[2]-a[2]);z=side>0?Math.max(z,v):Math.min(z,v);}
            return Number.isFinite(z)?z:side>0?C.section(y).front+gap:C.section(y).back-gap;
        };
        for(const side of [-1,1]) {
            const normal=[0,0,side];
            // Inset vent banks, kept low contrast; color is reserved for status lights.
            for(const hand of side>0?[-1,1]:[]){
                const y=mid+.02*s,q=C.section(y),x=q.cx+hand*q.width*.5;
                vent(C.hardware,[x,y,chestFace(x,y,side)+side*.003*s],X,Y,q.width*.3,.04*s,normal,C.trim,C.joint('Spine2'),s);
            }
        }
        const lightY=top-.033*s,lightX=C.section(lightY).cx-C.section(lightY).width*.42;
        rectangle(C.indicators,[lightX,lightY,chestFace(lightX,lightY)+.006*s],X,Y,.035*s,.009*s,Z,C.accent,C.joint('Spine2'),.003*s,.001*s);
        // Light channels running down beside the breast ridge.
        for(const hand of [-1,1]){const y=chestLow+(top-chestLow)*.42,x=C.section(y).cx+hand*.026*s;rectangle(C.indicators,[x,y,chestFace(x,y)+.0035*s],Y,X,(top-chestLow)*.34,.0035*s,Z,C.accent,C.joint('Spine2'),.002*s,.0007*s);}
        // Rib housings wrap the torso below the arm openings.
        for(const side of [-1,1]) {
            const normal=[side,0,0], y=chestLow+.045*s, q=C.section(y);
            rectangle(C.hardware,[side>0?q.right+gap:q.left-gap,y,q.cz],Z,Y,(q.front-q.back)*.82,.085*s,normal,C.trim,C.joint('Spine1'),.012*s,.005*s);
        }
        // Articulated lames overlap along the actual abdomen. Flat front/back
        // plaques left black steps and floated clear of a broad belly.
        const bottom=hip+.01*s, end=chestLow+.008*s, count=3;
        for(let row=0;row<count;row++) {
            const lo=bottom+(end-bottom)*row/count,hi=bottom+(end-bottom)*(row+1)/count+.008*s;
            const joint=C.joint(row===2?'Spine1':'Spine');
            const rings=Array.from({length:5},(_,r)=>{
                const y=lo+(hi-lo)*r/4,q=C.section(y),lip=r===0?.003*s:0;
                return roundSection([q.cx,y,q.cz],X,Z,q.width+gap+lip,(q.front-q.back)/2+gap+lip,32,3);
            });
            C.shell.loft(rings,mul(C.color,.89),joint,p=>{const q=C.section(p[1]);return[q.cx,p[1],q.cz];},r=>r===0?mul(C.color,.65):mul(C.color,.89));
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
            const neck=C.bone('Neck').head, joint=C.joint('Spine2');
            const points=C.ids.filter(v=>C.an.s[v*5]>3.9&&C.an.s[v*5]<4.6&&Math.abs(C.P[v*3+1]-neck[1])<.028*s);
            const n=points.length?{width:Math.max(...points.map(v=>Math.abs(C.P[v*3]))),front:Math.max(...points.map(v=>C.P[v*3+2])),back:Math.min(...points.map(v=>C.P[v*3+2])),cx:neck[0]}:C.section(neck[1]);
            const rx=n.width+gap*.8, rz=(n.front-n.back)/2+gap*.8, c=[n.cx,neck[1],(n.front+n.back)/2];
            const rings=[[-.03,1.25],[-.012,1.18],[-.006,1.08],[.012,1.0],[.02,.97]].map(([dy,k])=>roundSection(add(c,[0,dy*s,0]),X,Z,rx*k,rz*k,24,3));
            C.shell.loft(rings,C.color,joint,p=>[c[0],p[1],c[2]],r=>r===2?mul(C.color,.55):C.color);
        }
        // A ridge down the breastplate and seams across it.
        for(let r=0;r<8;r++){
            const a=chestRings[r][0],b=chestRings[r+1][0];
            C.shell.face([add(a,[-.005*s,0,.002*s]),add(a,[.005*s,0,.002*s]),add(b,[.005*s,0,.002*s]),add(b,[-.005*s,0,.002*s])],mul(C.color,1.1),C.joint('Spine2'),Z);
        }
        for(const k of [.3,.62])for(const side of [-1,1]){
            const y=chestLow+(top-chestLow)*k,q=C.section(y),x=q.cx+side*q.width*.55;
            rectangle(C.hardware,[x,y,chestFace(x,y)+.004*s],X,Y,q.width*.38,.0035*s,Z,C.trim,C.joint('Spine2'),.0015*s,.0006*s);
        }
        // A compact power unit sits flush on the back plate.
        rectangle(C.hardware,[section.cx,mid,chestFace(section.cx,mid,-1)-.012*s],X,Y,section.width*.65,(top-chestLow)*.42,mul(Z,-1),C.trim,C.joint('Spine2'),.025*s,.006*s);
        hazard(C.hardware,[section.cx,mid-(top-chestLow)*.13,chestFace(section.cx,mid,-1)-.0255*s],X,Y,section.width*.42,.022*s,mul(Z,-1),C.accent,C.joint('Spine2'),s);
        for(const side of [-1,1]){const x=section.cx+side*section.width*.26;rectangle(C.shell,[x,mid,chestFace(x,mid,-1)-.018*s],X,Y,.025*s,(top-chestLow)*.32,mul(Z,-1),mul(C.color,.9),C.joint('Spine2'),.008*s,.003*s);}
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
        const joints=Uint8Array.from(body.joints),weights=Float32Array.from(body.weights);
        if(!hands&&C.item.rigidFeet!==false)for(let v=0;v<positions.length/3;v++){
            const src=source[v],family=positions[v*3]>0?3:4;
            if(C.an.member[src*5+family]<.5)continue;
            Outfit.rigidFootSkin(C.built,positions.subarray(v*3,v*3+3),{joints:joints.subarray(v*4,v*4+4),weights:weights.subarray(v*4,v*4+4)});
        }
        return {part:Object.assign({},body,{name:'Power armor undersuit',positions,colors,joints,weights,index:Uint32Array.from(keep),texture:null,roughness:.88,metalness:0}),hidden};
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
            for(const [E,panel] of [[thigh,'hazard'],[forearm,'light']]){
                const out=dot(E.side,[Math.sign(E.B.head[0])||1,0,0])>=0?E.side:mul(E.side,-1),t=(E.ts[0]+E.ts[1])/2+.12*(E.ts[1]-E.ts[0]);
                const at=add(E.point(t),mul(out,E.shell[0]*(1-.25*(t-E.ts[0])/(E.ts[1]-E.ts[0]))+.0022*s)),up=E.along,across=norm(cross(out,up));
                if(panel==='hazard')hazard(C.hardware,at,across,up,.05*s,.032*s,out,C.accent,C.joint(E.B.name),s);
                else rectangle(C.indicators,at,up,across,E.length*(E.ts[1]-E.ts[0])*.45,.004*s,out,C.accent,C.joint(E.B.name),.002*s,.0007*s);
            }
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
        const glow={emissive:item.color2||'#e5ad55',emissiveIntensity:.65};
        const parts=[base.part,C.shell.part('Power armor plating',{roughness:.38,metalness:.65,finish:'painted'}),C.hardware.part('Power armor hardware',{roughness:.62,metalness:.25}),C.indicators.part('Power armor indicators',Object.assign({roughness:.3,metalness:.25},glow))];
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
        const gap=.016*s, SIDES=44, e=2.6;
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
        for(let i=0;i<secs.length;i++) if(!secs[i]) secs[i]=Object.assign({},secs[i-1]||secs.find(Boolean));
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
        C.shell.face(rings[rings.length-1],C.color,head,Y);
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
        return {parts:[C.shell.part('Power helmet plating',{roughness:.38,metalness:.65}),C.hardware.part('Power helmet visor',{roughness:.12,metalness:.6}),C.indicators.part('Power helmet indicators',{roughness:.3,metalness:.25,emissive:item.color2||'#e5ad55',emissiveIntensity:.65})],hidden};
    }
    /**
     * Medieval plate uses broad formed sheets, rather than the clothing helper's muscle contours.
     * Every sheet has a rolled or chamfered edge that catches light, lames overlap with real steps,
     * and `item.style` picks the plate style: smooth (Milanese), fluted (Gothic), riveted
     * (brigandine-like lames) or, for the breastplate, an idealized anatomical cuirass.
     * `worn` holds parts already built for the outfit (a sabaton fits over its own liner).
     */
    function medieval(pack, built, item, kind, layers=[], worn=[]) {
        const C=context(pack,built,item), s=C.scale, uv=8/s;
        const surf=SURFACE[item.material]||SURFACE.metal, style=item.style||'smooth';
        const metal=new Mesh(uv), edge=new Mesh(uv), etch=new Mesh(1), straps=new Mesh(uv);
        const plateColor=C.color, tint=item.trim?Outfit.linear(item.trim):lighten(plateColor,.06);
        // Worn steel edges are lighter; worn leather edges burnish darker; painted plate shows bare metal.
        const edgeColor=surf.finish==='steel'?lighten(plateColor):surf.finish==='leather'?mul(plateColor,.72):mix(plateColor,[.42,.43,.45],.55);
        const strapColor=Outfit.linear('#3b2a1d'), ironColor=Outfit.linear('#7d7f84');
        const etchOn=(item.trimWidth??0)>.004, etchWidth=Math.min(.026,.005+(item.trimWidth||0)*.14)*s;
        const etchColor=surf.finish==='leather'?mul(plateColor,.62):mix(plateColor,tint,.55);
        const clearance=.010*s, hidden=new Set(), extraParts=[];
        const fitted=C.ids.map(v=>({p:C.at(v),family:Array.from({length:5},(_,f)=>C.an.member[v*5+f]).reduce((a,b,f,all)=>b>all[a]?f:a,0)}));
        for(const layer of layers)for(let v=0;v<(layer.rimStart??layer.positions.length/3);v++) {
            const family=layer.field?.[v]?.fam;
            if(family!=null&&!layer.hang)fitted.push({p:Array.from(layer.positions.subarray(v*3,v*3+3)),family});
        }
        const torsoPoints=fitted.filter(v=>v.family===0).map(v=>v.p);
        const hipY=C.bone('Hips').head[1],neckY=C.bone('Neck').head[1];
        // The fauld overlaps the sewn skirt waist, even though cuisses must
        // fit inside that hanging skirt. Keep these two fitting envelopes separate.
        for(const layer of layers)if(layer.hang)for(let v=0;v<(layer.rimStart??layer.positions.length/3);v++){
            const y=layer.positions[v*3+1];if(y>hipY-.10*s&&y<hipY+.16*s)torsoPoints.push(Array.from(layer.positions.subarray(v*3,v*3+3)));
        }
        const section=formedSections(torsoPoints.filter(p=>p[1]>hipY-.16*s&&p[1]<neckY+.015*s));
        const radial=axis=>p=>norm(sub(p,axis(p)));
        /** Etched/tooled bands `d0`..`d0+etchWidth` in from the first (or last) ring of a stack. */
        function etchBands(rings,axis,joint,fromEnd,d0=.011*s,closed=true,cols) {
            if(!etchOn)return;
            const ks=cols||rings[0].map((_,k)=>k);
            const rowA=ks.map(k=>along(rings,k,d0,fromEnd)),rowB=ks.map(k=>along(rings,k,d0+etchWidth,fromEnd));
            if(closed){rowA.push(rowA[0]);rowB.push(rowB[0]);}
            band(etch,rowA,rowB,etchColor,joint,radial(axis),.0007*s);
        }
        const every=(list,step=2)=>list.filter((_,k)=>k%step===0);

        // A formed oval encloses its sampled section. No per-vertex muscle/breast displacement
        // is copied onto the plate; an axial keel gives the front its forged ridge.
        function oval(center, rx, front, back, keel, angles) {
            return angles.map(a=>{
                const sn=Math.sin(a), cs=Math.cos(a), r=1/Math.pow(Math.abs(sn)**2.3+Math.abs(cs)**2.3,1/2.3);
                return [center[0]+sn*rx*r,center[1],center[2]+cs*r*(cs>=0?front:back)+keel*Math.max(0,cs)**10];
            });
        }
        /** Raised style relief on a cuirass at height `t` (0 waist .. 1 collar), angle `a` (0 front). */
        function relief(t,a,scale=1) {
            const front=smooth(.12,.55,Math.cos(a)), x=Math.sin(a);
            if(style==='fluted'){
                let d=0;for(const f of [-.66,-.4,-.16,.16,.4,.66]){const c=f*(.42+.72*t);d+=Math.exp(-(((a-c)/.05)**2));}
                return front*d*.0062*s*smooth(.03,.28,t)*(1-smooth(.8,.97,t))*scale;
            }
            if(style==='anatomical'||scale<1){
                const bump=(x0,t0,sx,sy)=>Math.exp(-(((x-x0)/sx)**2+((t-t0)/sy)**2));
                let d=0;
                for(const sg of [-1,1]){d+=.011*s*bump(sg*.40,.70,.27,t<.70?.085:.16);for(const t0 of [.15,.29,.43])d+=.0042*s*bump(sg*.165,t0,.1,.055);}
                d-=.0022*s*Math.exp(-((x/.035)**2))*smooth(.05,.45,t)*(1-smooth(.56,.7,t));
                return front*d*scale;
            }
            return 0;
        }
        function cuirass() {
            const hip=C.bone('Hips').head[1], neck=C.bone('Neck').head[1];
            const waist=C.bone('Spine1').head[1]+.015*s, top=neck-.045*s;
            const chest=section(waist+(top-waist)*.65);
            const cx=(chest.front+chest.back)/2;
            const R=style==='smooth'?13:19, N=style==='smooth'?40:60, angles=frontAngles(N,style==='smooth'?.8:.5);
            // A single convex breast, shared across both sides. The waist is visibly pinched,
            // while the chest is broad and gently keeled, without two inflated breast cups.
            const rings=Array.from({length:R},(_,r)=>{
                const t=r/(R-1), y=waist+(top-waist)*t, q=section(y), center=(q.front+q.back)/2;
                const shoulderCut=Math.max(0,(t-.55)/.45);
                let w=Math.min(q.width,chest.width*(1-.26*shoulderCut))+clearance*.65, front=q.front-center+clearance*.8, back=center-q.back+clearance*.8, grow=1;
                for(const p of torsoPoints)if(Math.abs(p[1]-y)<.025*s&&Math.abs(p[0])<w*.90) {
                    const dz=p[2]-center, depth=dz>0?front:back;
                    grow=Math.max(grow,(Math.abs(p[0]/w)**2.3+Math.abs(dz/depth)**2.3)**(1/2.3)+.015);
                }
                w*=grow;
                const ring=oval([0,y,center],w,front*grow,back*grow,style==='anatomical'?.006*s:.024*s,angles);
                ring.forEach((p,k)=>{const d=relief(t,angles[k]);if(d){const o=norm([p[0],0,p[2]-center]);p[0]+=o[0]*d;p[2]+=o[2]*d;}});
                if(r===R-1)ring.forEach((p,k)=>{p[1]-=.048*s*Math.abs(Math.sin(angles[k]))**4;});
                if(r===0)ring.forEach((p,k)=>{p[1]-=.018*s*Math.max(0,Math.cos(angles[k]))**8;});
                return ring;
            });
            const inside=p=>[0,p[1],cx], joint=C.joint('Spine2');
            metal.loft(rings,plateColor,joint,inside);
            // Full-resolution paths: a decimated chord would sink the bead into the lames tucked under it.
            bead(edge,N>40?every(rings[0]):rings[0],true,.0025*s,edgeColor,joint,radial(inside),5,.9);bead(edge,N>40?every(rings.at(-1)):rings.at(-1),true,.0029*s,edgeColor,joint,radial(inside),6,.35);
            etchBands(rings,inside,joint,true);etchBands(rings,inside,joint,false,.016*s);
            // A fluted breastplate wears a pointed plackart; a riveted one, overlapping belly lames.
            const sample=(u,a)=>{
                const r=Math.max(0,Math.min(R-1.0001,u)),i=Math.floor(r),f=r-i;
                let k=angles.findIndex((b,j)=>j+1<angles.length&&b<=a&&angles[j+1]>a);if(k<0)k=0;
                const g=(a-angles[k])/(angles[k+1]-angles[k]);
                return lerp(lerp(rings[i][k],rings[i][k+1],g),lerp(rings[i+1][k],rings[i+1][k+1],g),f);
            };
            const overlay=(cols,rowsOf,lift,j)=>{
                const grid=rowsOf.map(row=>cols.map((a,c)=>{const u=row(a,c),p=sample(u,a),o=norm([p[0],0,p[2]-cx]);return add(p,mul(o,lift(u)));}));
                sheet(metal,grid,.0016*s,plateColor,j,p=>mul(norm([p[0],0,p[2]-cx]),-1));
                return grid;
            };
            if(style==='fluted') {
                const cols=Array.from({length:23},(_,c)=>-1.2+c/22*2.4), apex=(R-1)*.62, flank=(R-1)*.16;
                const grid=overlay(cols,Array.from({length:7},(_,r)=>(a)=>r/6*(apex-(apex-flank)*Math.abs(a)/1.2)),u=>.0045*s+.0035*s*Math.exp(-u*.6),joint);
                bead(edge,grid.at(-1),false,.003*s,edgeColor,joint,radial(inside),5,.2);
                for(const p of [grid.at(-1)[11],grid[2][3],grid[2][19]])rivet(edge,p,radial(inside)(p),.0034*s,tint,joint);
            }
            if(style==='riveted') {
                const cols=Array.from({length:25},(_,c)=>-1.3+c/24*2.6);
                for(let lame=0;lame<3;lame++){
                    const u0=(R-1)*(lame*.17),u1=(R-1)*(lame*.17+.22),lift=.0042*s+(2-lame)*.0035*s;
                    const grid=overlay(cols,[0,1,2].map(r=>()=>u0+(u1-u0)*r/2),()=>lift,joint);
                    bead(edge,grid.at(-1),false,.0026*s,edgeColor,joint,radial(inside),5,.2);
                    for(let c=2;c<cols.length;c+=4){const p=lerp(grid[1][c],grid[2][c],.45);rivet(edge,p,radial(inside)(p),.003*s,tint,joint);}
                }
            }
            // Real overlapping fauld lames below the breast, following successive spine bones:
            // each lower lame laps over the one above it with a 3.5 mm step and its own rolled edge.
            const low=hip+.025*s, span=waist-low, angF=frontAngles(32,1);
            // The breastplate's lower edge by angle round its axis: its radius and height.
            const rim=rings[0].map(p=>({a:Math.atan2(p[0],p[2]-cx),r:Math.hypot(p[0],p[2]-cx),y:p[1]})).sort((p,q)=>p.a-q.a);
            const cuirassAt=a=>{let i=rim.findIndex(q=>q.a>a);if(i<=0)return rim[i<0?rim.length-1:0];const p=rim[i-1],q=rim[i],t=(a-p.a)/(q.a-p.a);return {r:p.r+(q.r-p.r)*t,y:p.y+(q.y-p.y)*t};};
            for(let row=0;row<3;row++) {
                const y0=low+span*row/3, y1=low+span*(row+1)/3+.010*s;
                const q=section((y0+y1)/2), cz=(q.front+q.back)/2;
                const lame=Array.from({length:4},(_,r)=>{
                    const y=y0+(y1-y0)*r/3,at=section(y),center=(at.front+at.back)/2,step=(row===0?.0095:row===1?.0055:0)*s+.0015*s*(1-r/3)-(row===2&&r===3?.003*s:0);
                    const ring=oval([0,y,center],at.width+clearance+step,at.front-center+clearance*2.2+step,center-at.back+clearance*2.2+step,.008*s,angF);
                    if(r===0&&style==='fluted')ring.forEach((p,k)=>{p[1]-=.012*s*Math.max(0,Math.cos(angF[k]))**14;});
                    return ring;
                });
                const j=C.joint(row===2?'Spine1':'Spine'), axis=p=>[0,p[1],cz];
                // Whatever rises behind the breastplate stays inside it, clear of its rolled edge.
                // Each ring shrinks as a whole, keeping its form, so it cannot buckle where it meets the edge.
                if(row===2)lame.forEach(ring=>{let k=1;for(const p of ring){const under=cuirassAt(Math.atan2(p[0],p[2]-cx));if(p[1]>under.y-.03*s)k=Math.min(k,(under.r-.011*s)/Math.hypot(p[0],p[2]-cx));}
                    if(k<1)for(const p of ring){p[0]*=k;p[2]=cx+(p[2]-cx)*k;}});
                metal.loft(lame,plateColor,j,axis);
                if(row===0)bead(edge,lame[0],true,.0022*s,edgeColor,j,radial(axis),5,.6);
                if(row<2)bead(edge,lame[3],true,.0019*s,edgeColor,j,radial(axis),5,.95);
                for(const k of style==='riveted'?[4,8,12,20,24,28]:[8,24]){const p=lerp(lame[1][k],lame[2][k],.5);rivet(edge,p,radial(axis)(p),.0028*s,tint,j);}
            }
        }
        function limb(name, family, lo, hi) {
            const E=C.envelope(name,family,lo,hi), joint=C.joint(name);
            const count=13, sides=style==='fluted'?44:32, ang=frontAngles(sides,style==='fluted'?.6:1), rings=[];
            for(let r=0;r<count;r++) {
                const t=lo+(hi-lo)*r/(count-1), center=E.point(t), band=(hi-lo)*.12;
                let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,samples=[];
                for(const v of fitted) {
                    if(v.family!==family)continue;
                    const d=sub(v.p,E.B.head),u=dot(d,E.along)/E.length;
                    if(u<lo||u>hi||Math.abs(u-t)>band)continue;
                    const x=dot(d,E.side),z=dot(d,E.front);
                    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);samples.push([x,z]);
                }
                if(!samples.length){minX=-E.rx;maxX=E.rx;minZ=-E.rz;maxZ=E.rz;}
                const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
                center.splice(0,3,...add(center,add(mul(E.side,cx),mul(E.front,cz))));
                let rx=(maxX-minX)/2+clearance,rz=(maxZ-minZ)/2+clearance,grow=1;
                for(const [x,z]of samples)grow=Math.max(grow,(Math.abs((x-cx)/rx)**2.5+Math.abs((z-cz)/rz)**2.5)**.4);
                rx*=grow;rz*=grow;
                const ring=ang.map(a=>{const ca=Math.cos(a),sa=Math.sin(a),k=1/Math.pow(Math.abs(ca)**2.5+Math.abs(sa)**2.5,1/2.5);return add(center,add(mul(E.front,ca*k*rz),mul(E.side,sa*k*rx)));});
                // A shallow central ridge, rather than an extra bulb over the entire limb.
                ring.forEach((p,k)=>{const cs=Math.cos(ang[k]);if(cs>0)for(let a=0;a<3;a++)p[a]+=E.front[a]*.005*s*cs**8;});
                rings.push(ring);
            }
            const axis=p=>E.point(dot(sub(p,E.B.head),E.along)/E.length);
            // Bridge local muscle fluctuations with one continuous silhouette along each column.
            for(let k=0;k<rings[0].length;k++)for(let pass=0;pass<4;pass++){
                const prev=rings.map(r=>r[k]);
                for(let j=1;j+1<rings.length;j++){
                    const center=axis(prev[j]),v=sub(prev[j],center),radius=Math.hypot(...v),wanted=(Math.hypot(...sub(prev[j-1],axis(prev[j-1])))+2*radius+Math.hypot(...sub(prev[j+1],axis(prev[j+1]))))/4;
                    rings[j][k]=add(center,mul(v,Math.max(radius,wanted)/radius));
                }
            }
            // Gothic flutes run the length of the plate, fading out before its rolled ends.
            if(style==='fluted')rings.forEach((ring,r)=>{const u=r/(count-1),fade=smooth(0,.18,u)*(1-smooth(.82,1,u));ring.forEach((p,k)=>{let d=0;for(const c of [-.46,0,.46])d+=Math.exp(-(((ang[k]-c)/.075)**2));if(d*fade>.01)ring[k]=add(p,mul(norm(sub(p,axis(p))),d*fade*.0042*s));});});
            metal.loft(rings,plateColor,joint,axis);
            const rivets=style==='riveted'?[-.8,-.45,0,.45,.8]:[-.7,.7];
            for(const t of [lo+.06*(hi-lo),hi-.06*(hi-lo)])for(const x of rivets){
                const p=add(E.point(t),add(mul(E.side,E.rx*x),mul(E.front,E.rz*Math.sqrt(1-x*x*.6)+clearance*1.5)));
                rivet(edge,p,norm(add(mul(E.front,Math.sqrt(1-x*x*.5)),mul(E.side,x*.7))),.0026*s,tint,joint);
            }
            // Rolled edges: a narrow formed bead, not a broad inflatable cuff.
            for(const ring of [rings[0],rings.at(-1)])bead(edge,every(ring),true,.0025*s,edgeColor,joint,radial(axis),5,.35);
            etchBands(rings,axis,joint,false);etchBands(rings,axis,joint,true);
            return E;
        }
        function shoulder(name,family) {
            const bulk=C.bulk, E=C.envelope(name,family,-.12,.48), joint=C.joint(name);
            const up=norm(sub(Y,mul(E.along,dot(Y,E.along))));
            const fw=norm(cross(E.along,up));
            let radiusUp=E.rx, radiusFront=E.rz;
            for(const v of fitted) {
                const d=sub(v.p,E.B.head), t=dot(d,E.along)/E.length;
                if(v.family!==family||t<-.12||t>.4||Math.hypot(...d)>.13*s)continue;
                radiusUp=Math.max(radiusUp,dot(d,up));radiusFront=Math.max(radiusFront,Math.abs(dot(d,fw)));
            }
            // One dished shoulder cap, followed by two close overlapping lames.
            // The front/back cut edges remain open over the mail articulation.
            const axis=p=>E.point(dot(sub(p,E.B.head),E.along)/E.length);
            for(let row=0;row<3;row++) {
                const lo=[-.12,.32,.39][row],hi=[.36,.40,.47][row],R=row?3:7,K=style==='fluted'&&!row?40:28;
                const rings=Array.from({length:R+1},(_,j)=>{
                    const t=j/R,along=lo+(hi-lo)*t;
                    const crown=row===0?(.50+.50*Math.sin(Math.PI*t*.82)):1-.10*t;
                    const rx=(radiusUp+(.010+.006*bulk-row*.0035)*s)*crown;
                    const rz=(radiusFront+(.009+.005*bulk-row*.0035)*s)*crown;
                    return Array.from({length:K+1},(_,k)=>{
                        const angle=-1.72+k/K*3.44;
                        let p=add(E.point(along),add(mul(up,Math.cos(angle)*rx),mul(fw,Math.sin(angle)*rz)));
                        if(row===0&&style==='fluted'){let d=0;for(const c of [-1.1,-.55,0,.55,1.1])d+=Math.exp(-(((angle-c)/.085)**2));p=add(p,mul(norm(sub(p,E.point(along))),d*.0038*s*Math.sin(Math.PI*Math.min(1,t*1.1))**.6));}
                        return p;
                    });
                });
                metal.loft(rings,plateColor,joint,axis,null,true);
                // A rolled lower lip and small attachment rivets resolve the scale of the metal.
                bead(edge,every(rings.at(-1)),false,.0023*s,edgeColor,joint,radial(axis),5,.75);
                for(const f of style==='riveted'?[.1,.3,.5,.7,.9]:[.16,.5,.84]){
                    const p=rings[R-1][Math.round(K*f)],n=norm(sub(p,axis(p)));
                    rivet(edge,add(p,mul(n,.001*s)),n,.0026*s,tint,joint);
                }
                if(row===0)etchBands(rings,axis,joint,true,.009*s,false);
            }
        }
        /** Elbow cop with a fan on its outer side, carried by the forearm. */
        function couter(side,family) {
            const E=C.envelope(side+'ForeArm',family,0,.25), joint=C.joint(side+'ForeArm'), back=mul(E.front,-1);
            let ext=E.rz;
            for(const v of fitted)if(v.family===family){const d=sub(v.p,E.B.head);if(Math.abs(dot(d,E.along))<.05*s)ext=Math.max(ext,dot(d,back));}
            const Rc=Math.max(E.rx,E.rz)*.9+.005*s, apex=add(E.B.head,mul(back,ext+clearance+.004*s)), K=16;
            const rings=[.2,.48,.78,1.04,1.22].map(th=>Array.from({length:K},(_,k)=>{const f=k/K*Math.PI*2,rr=Rc*Math.sin(th);return add(sub(apex,mul(back,Rc*(1-Math.cos(th)))),add(mul(E.along,Math.cos(f)*rr*.85),mul(E.side,Math.sin(f)*rr)));}));
            const sphere=sub(apex,mul(back,Rc));
            metal.loft(rings,plateColor,joint,()=>sphere);metal.face(rings[0],plateColor,joint,back);
            bead(edge,rings.at(-1),true,.0028*s,edgeColor,joint,p=>norm(sub(p,sphere)),5,.1);
            const outside=dot(E.side,[Math.sign(E.B.head[0])||1,0,0])>=0?E.side:mul(E.side,-1);
            const c=add(E.B.head,add(mul(outside,E.rx+clearance+.007*s),mul(back,ext*.3)));
            const fan=[[0,1],[.55,.85],[.92,.35],[.78,-.35],[.32,-.85],[-.32,-.85],[-.78,-.35],[-.92,.35],[-.55,.85]];
            plate(metal,fan.map(([x,y])=>add(c,add(mul(E.along,x*.03*s),mul(back,y*.028*s)))),outside,.003*s,.0012*s,plateColor,joint,{roll:.0022*s,sides:6});
            rivet(edge,add(c,mul(outside,.001*s)),outside,.003*s,tint,joint);
        }
        /** Knee cop with a side wing, carried by the shin. */
        function poleyn(side,family,shin,thigh) {
            const joint=C.joint(side+'Leg'), fw=shin.front;
            let ext=Math.max(thigh.rz,shin.rz);
            for(const v of fitted)if(v.family===family){const d=sub(v.p,shin.B.head);if(Math.abs(dot(d,shin.along))<.05*s)ext=Math.max(ext,dot(d,fw));}
            const Rc=shin.rx*.95, apex=add(shin.B.head,mul(fw,ext+.016*s)), K=18;
            const rings=[.22,.52,.8,1.02].map(th=>Array.from({length:K},(_,k)=>{const f=k/K*Math.PI*2,rr=Rc*Math.sin(th);
                // A Gothic cop rises to a point above and below the knee.
                const point=style==='fluted'?1+.18*Math.abs(Math.cos(f))**6:1;
                return add(sub(apex,mul(fw,Rc*(1-Math.cos(th))*.8)),add(mul(shin.along,Math.cos(f)*rr*1.02*point),mul(shin.side,Math.sin(f)*rr)));}));
            const sphere=sub(apex,mul(fw,Rc*.8));
            metal.loft(rings,plateColor,joint,()=>sphere);metal.face(rings[0],plateColor,joint,fw);
            bead(edge,rings.at(-1),true,.003*s,edgeColor,joint,p=>norm(sub(p,sphere)),5,.1);
            const outside=dot(shin.side,[Math.sign(shin.B.head[0])||1,0,0])>=0?shin.side:mul(shin.side,-1);
            const c=add(shin.B.head,add(mul(outside,shin.rx+clearance+.006*s),mul(fw,ext*.45)));
            const fan=[[0,1],[.55,.85],[.92,.35],[.85,-.3],[.4,-.8],[0,-.95],[-.4,-.8],[-.85,-.3],[-.92,.35],[-.55,.85]];
            plate(metal,fan.map(([x,y])=>add(c,add(mul(fw,x*.034*s),mul(shin.along,-y*.036*s)))),outside,.003*s,.0012*s,plateColor,joint,{roll:.0024*s,sides:6});
            rivet(edge,add(c,mul(outside,.001*s)),outside,.0032*s,tint,joint);
        }
        /** Points near a limb as (distance along its bone, radial vector), from the body and every layer over it. */
        function aroundBone(E,family,reach) {
            const list=[],take=p=>{const d=sub(p,E.B.head),t=dot(d,E.along),q=sub(d,mul(E.along,t));if(Math.hypot(...q)<reach)list.push({t,q});};
            for(const v of fitted)if(v.family===family)take(v.p);
            for(const layer of layers)for(let v=0;v<(layer.rimStart??layer.positions.length/3);v++)take(Array.from(layer.positions.subarray(v*3,v*3+3)));
            return list;
        }
        /** The farthest surface along `dir` near distance `t` down a bone. */
        const reachAt=(list,t,dir,band,fallback)=>{let r=fallback;for(const p of list){if(Math.abs(p.t-t)>band)continue;const q=Math.hypot(...p.q)||1,c=dot(p.q,dir)/q;if(c>.93)r=Math.max(r,dot(p.q,dir));}return r;};
        /** Thigh tassets: curved overlapping lames hung on straps and buckles from the fauld. */
        function tassets() {
            const hip=C.bone('Hips').head[1], count=(item.length??.3)<.18?3:4, H=(.09+clamp01(item.length??.3)*.24)*s, flare=clamp01(item.flare??.3);
            for(const [side,family] of [['Left',3],['Right',4]]) {
                const E=C.envelope(side+'UpLeg',family,0,.6), joint=C.joint(side+'UpLeg'), hipJoint=C.joint('Hips');
                const outside=dot(E.side,[Math.sign(E.B.head[0])||1,0,0])>=0?E.side:mul(E.side,-1);
                const dC=norm(add(E.front,mul(outside,.14))), dS=norm(cross(E.along,dC)), K=10, span=.52;
                const list=aroundBone(E,family,.2*s), dTop=(hip-.024*s-E.B.head[1])/Math.min(-.3,E.along[1]);
                // The inner edge stops short of the middle, clear of the other tasset; the rest wraps outward.
                const dirAt=f=>norm(add(mul(dC,Math.cos(f)),mul(dS,Math.sin(f)))), sx=Math.sign(E.B.head[0])||1, reachOut=Math.max(E.rx,E.rz)+.035*s;
                const inward=sx*dirAt(.5)[0]<sx*dirAt(-.5)[0]?1:-1;
                // Checked at the bottom too: the thighs converge toward the knees and the lower lames flare.
                const lowest=add(E.B.head,mul(E.along,(hip-.024*s-H-E.B.head[1])/Math.min(-.3,E.along[1]))), reachLow=reachOut+(flare*.024+.004*count)*s;
                // Measured over what the tasset actually covers (a mail skirt over both thighs makes it wider).
                const tLow=dot(sub(lowest,E.B.head),E.along), fit=f=>Math.max(reachAt(list,dTop,dirAt(f),.03*s,0),reachAt(list,tLow,dirAt(f),.03*s,0),Math.max(E.rx,E.rz));
                const clear=f=>{const r=fit(f);return sx*add(E.B.head,mul(dirAt(f),r+.035*s))[0]>.016*s&&sx*add(lowest,mul(dirAt(f),r+reachLow-reachOut+.035*s))[0]>.016*s;};
                let inner=-span;while(inner<span&&clear(inward*(inner+.05)))inner+=.05;
                const cols=Array.from({length:K+1},(_,c)=>inward*inner-inward*c/K*2*span), dirs=cols.map(dirAt);
                const lameH=H/count;
                // One fitted radius per column for the whole tasset: the lames step out, never in.
                const base=cols.map((f,c)=>{let r=0;for(let t=dTop;t<=dTop+H;t+=lameH/2)r=Math.max(r,reachAt(list,t,dirs[c],.03*s,Math.max(E.rx,E.rz)));return r;});
                const smoothBase=base.map((r,c)=>Math.max(r,(base[Math.max(0,c-1)]+2*r+base[Math.min(K,c+1)])/4));
                const axisOf=p=>add(E.B.head,mul(E.along,dot(sub(p,E.B.head),E.along)));
                // A point `r` out along `dir` from the thigh's axis, at height `y`.
                const yTop=hip-.024*s, levelAt=(dir,r,y)=>{const q=add(E.B.head,mul(dir,r));return add(q,mul(E.along,(y-q[1])/Math.min(-.3,E.along[1])));};
                const grids=[];
                for(let k=0;k<count;k++) {
                    const d0=dTop+k*lameH, d1=d0+lameH+(k<count-1?.014*s:0);
                    const grid=[0,.5,1].map(v=>{
                        const down=(k+v)/count;
                        return cols.map((f,c)=>{
                            let r=smoothBase[c]+.015*s+k*.0035*s+flare*.024*s*down+.0015*s*Math.sin(Math.PI*v);
                            if(style==='fluted')r+=.0032*s*Math.exp(-((f/.12)**2));
                            let y=yTop-(d0-dTop)-(d1-d0)*v;if(style==='fluted'&&k===count-1&&v===1)y-=.018*s*Math.exp(-((f/.3)**2));
                            return levelAt(dirs[c],r,y);
                        });
                    });
                    sheet(metal,grid,.0016*s,plateColor,joint,p=>norm(sub(axisOf(p),p)));
                    // Each lower lame laps over the one above it: its top edge is the one that shows.
                    bead(edge,grid[0],false,.0022*s,edgeColor,joint,radial(axisOf),5,.45);
                    if(k===count-1){bead(edge,grid[2],false,.0024*s,edgeColor,joint,radial(axisOf),5,.4);etchBands(grid,axisOf,joint,true,.008*s,false);}
                    for(const c of style==='riveted'?[1,3,5,7,9]:[1,K-1]){const p=lerp(grid[0][c],grid[1][c],.45);rivet(edge,p,radial(axisOf)(p),.0027*s,tint,joint);}
                    grids.push(grid);
                }
                // Two leather straps from the fauld, buckled at the waist, riveted to the top lame.
                for(const c of [2,K-2]) {
                    const dir=dirs[c], r=smoothBase[c]+.015*s+.0045*s, w=.011*s, across=norm(cross(E.along,dir));
                    const at=y=>levelAt(dir,r,y);
                    // The strap runs up under the fauld's lowest lame; its buckle rides the top lame.
                    const grid=[hip+.022*s,yTop-.012*s,yTop-.04*s].map(y=>{const p=at(y);return [add(p,mul(across,-w)),add(p,mul(across,w))];});
                    sheet(straps,grid,.0018*s,strapColor,joint,p=>norm(sub(axisOf(p),p)));
                    buckle(edge,add(at(yTop-.008*s),mul(dir,.0022*s)),across,E.along,.026*s,.022*s,.0022*s,dir,tint,joint);
                    rivet(edge,add(at(yTop-.034*s),mul(dir,.002*s)),dir,.0026*s,tint,joint);
                }
            }
        }
        /** The hands' flexible leather glove from the skin (it bends with every finger bone), and the skin it hides. */
        function glove(minS,color) {
            const body=C.built.parts[0], source=C.pack.body.source, map=new Map(), keep=[];
            const on=v=>[1,2].some(f=>C.an.member[v*5+f]>.5&&C.an.s[v*5+f]>minS);
            for(let t=0;t<body.index.length;t+=3) {
                const tri=[body.index[t],body.index[t+1],body.index[t+2]];
                if(!tri.every(v=>on(source[v])))continue;
                for(const v of tri){if(!map.has(v))map.set(v,map.size);keep.push(map.get(v));hidden.add(source[v]);}
            }
            const n=map.size, P=new Float32Array(n*3), N=new Float32Array(n*3), J=new Uint8Array(n*4), W=new Float32Array(n*4), Col=new Float32Array(n*3);
            for(const [v,i] of map){for(let k=0;k<3;k++){N[i*3+k]=body.normals[v*3+k];P[i*3+k]=body.positions[v*3+k]+body.normals[v*3+k]*.0028*s;}Col.set(color,i*3);J.set(body.joints.subarray(v*4,v*4+4),i*4);W.set(body.weights.subarray(v*4,v*4+4),i*4);}
            return {name:'Gauntlet gloves',positions:P,normals:N,colors:Col,joints:J,weights:W,index:Uint32Array.from(keep),roughness:.64,metalness:0,finish:'leather'};
        }
        /** A cuff, a metacarpal plate and finger lames that each ride their own finger bone. */
        function gauntlet(side,family) {
            const hand=C.bone(side+'Hand'), i1=C.bone(side+'HandIndex1'), p1=C.bone(side+'HandPinky1');
            if(!hand||!i1||!p1)return;
            const handJ=C.joint(side+'Hand'), knuckles=lerp(i1.head,p1.head,.5), along=norm(sub(knuckles,hand.head));
            let back=norm(cross(norm(sub(i1.head,p1.head)),along));
            const m1=C.bone(side+'HandMiddle1'), m3=C.bone(side+'HandMiddle3');
            if(m1&&m3&&dot(sub(sub(m3.tail,m3.head),sub(m1.tail,m1.head)),back)>0)back=mul(back,-1);
            const across=norm(cross(back,along)), body=C.built.parts[0];
            const bodyNear=jointName=>{const J=C.joint(jointName),out=[];for(let v=0;v<body.positions.length/3;v++){let w=0;for(let k=0;k<4;k++)if(body.joints[v*4+k]===J)w+=body.weights[v*4+k];if(w>.5)out.push(Array.from(body.positions.subarray(v*3,v*3+3)));}return out;};
            const gap=(.0035+.004*C.bulk)*s;
            // Metacarpal plate: fitted to the back of the hand, a rolled knuckle edge.
            const pts=bodyNear(side+'Hand').map(p=>{const q=sub(p,hand.head);return [dot(q,across),dot(q,along),dot(q,back)];});
            const vK=dot(sub(knuckles,hand.head),along), uI=dot(sub(i1.head,hand.head),across), uP=dot(sub(p1.head,hand.head),across);
            const u0=Math.min(uI,uP)-.005*s, u1=Math.max(uI,uP)+.005*s, v0=vK*.2, v1=vK*1.0, Kc=8, Rr=4;
            const heightAt=(u,v)=>{let h=-Infinity;for(const [a,b,c]of pts)if(Math.abs(a-u)<.012*s&&Math.abs(b-v)<.014*s)h=Math.max(h,c);return h;};
            let H=Array.from({length:Rr+1},(_,r)=>Array.from({length:Kc+1},(_,c)=>heightAt(u0+(u1-u0)*c/Kc,v0+(v1-v0)*r/Rr)));
            const top=Math.max(...H.flat().filter(Number.isFinite));
            // Past the hand's edge the plate curls down toward the palm instead of floating flat.
            H=H.map(row=>row.map((h,c)=>Number.isFinite(h)?h:Math.max(...row.filter(Number.isFinite),-1)-.006*s*(1+Math.abs(2*c/Kc-1))));
            for(let pass=0;pass<2;pass++)H=H.map((row,r)=>row.map((h,c)=>Math.max(h,(row[Math.max(0,c-1)]+row[Math.min(Kc,c+1)]+H[Math.max(0,r-1)][c]+H[Math.min(Rr,r+1)][c])/4)));
            const plateGrid=H.map((row,r)=>row.map((h,c)=>{const taper=.82+.18*r/Rr,u=(u0+u1)/2+((u1-u0)*c/Kc-(u1-u0)/2)*taper,v=v0+(v1-v0)*r/Rr,arch=.002*s*(1-((2*c/Kc-1)**2))-.004*s*((2*c/Kc-1)**4);
                let ridge=style==='fluted'?.0022*s*[.25,.75].reduce((a,x)=>a+Math.exp(-(((c/Kc-x)/.07)**2)),0):0;
                return add(hand.head,add(add(mul(across,u),mul(along,v)),mul(back,h+gap+arch+ridge)));}));
            sheet(metal,plateGrid,.0015*s,plateColor,handJ,()=>mul(back,-1));
            bead(edge,plateGrid.at(-1),false,.0022*s,edgeColor,handJ,()=>back,5,.4);
            if(style==='riveted')for(const c of [1,4,7])rivet(edge,plateGrid[1][c],back,.0024*s,tint,handJ);
            // Finger lames: an arched scale over the back of each phalanx, overlapping toward the tip.
            const fingers=['Index','Middle','Ring','Pinky','Thumb'];
            for(const f of fingers)for(let j=1;j<=3;j++) {
                const bone=C.bone(side+'Hand'+f+j);if(!bone||!bone.tail)continue;
                const A=norm(sub(bone.tail,bone.head)), L=Math.hypot(...sub(bone.tail,bone.head)), J=C.joint(side+'Hand'+f+j);
                let bk=f==='Thumb'?norm(add(back,mul(across,dot(sub(bone.head,hand.head),across)>0?.9:-.9))):back;
                bk=norm(sub(bk,mul(A,dot(bk,A))));const sd=norm(cross(A,bk));
                // The finger's own thickness: a high percentile of its skin round the phalanx, not the web between fingers.
                const near=bodyNear(side+'Hand'+f+j).map(p=>sub(p,bone.head)).filter(q=>{const t=dot(q,A)/L;return t>-.05&&t<1.05;});
                const pct=(list,k)=>{list.sort((x,y)=>x-y);return list.length?list[Math.min(list.length-1,Math.floor(list.length*k))]:0;};
                const rb=Math.max(.005*s,pct(near.map(q=>dot(q,bk)),.9)),rs=Math.max(.0045*s,pct(near.map(q=>Math.abs(dot(q,sd))),.8));
                const g=.0036*s+(4-j)*.0004*s, th=.0011*s, phis=Array.from({length:5},(_,k)=>-.92+k/4*1.84);
                const t0=j===1?.14:f==='Thumb'?.1:.04, t1=j===3?.95:f==='Thumb'?.88:.93;
                const ring=(t,scale)=>{const c=add(bone.head,mul(A,t*L));
                    const outer=phis.map(fi=>add(c,add(mul(bk,Math.cos(fi)*(rb+g)*scale),mul(sd,Math.sin(fi)*(rs+g)*scale))));
                    const inner=phis.slice().reverse().map(fi=>add(c,add(mul(bk,Math.cos(fi)*(rb+g-th)*scale),mul(sd,Math.sin(fi)*(rs+g-th)*scale))));
                    return outer.concat(inner);};
                const rings=[ring(t0,.97),ring((t0+t1)/2,1.02),ring(t1,j===3?.7:.94)];
                const axisP=p=>add(bone.head,mul(A,dot(sub(p,bone.head),A)));
                metal.loft(rings,plateColor,J,axisP,(r,k)=>k<5?plateColor:mul(plateColor,.7));
                for(const [r,dir] of [[0,-1],[2,1]]){const q=rings[r];for(let k=0;k<4;k++)metal.face([q[k],q[k+1],q[8-k],q[9-k]],mul(plateColor,1.06),J,mul(A,dir));}
            }
            // A flared cuff over the wrist, carried by the forearm so the hand can bend inside it.
            const E=C.envelope(side+'ForeArm',family,.7,1), lo=Math.max(.6,.88-clamp01(item.length??.25)*.4), hi=1.05, Kf=24;
            const angF=frontAngles(Kf,1), axis=p=>E.point(dot(sub(p,E.B.head),E.along)/E.length);
            const cuff=[0,.5,1].map(v=>{const t=lo+(hi-lo)*v,flare=1+.07*v*v,cx=E.point(t);
                return angF.map(a=>{const ca=Math.cos(a),sa=Math.sin(a);let r=1+(style==='fluted'?.06*Math.exp(-((Math.sin(a*3)/.4)**2))*v:0);
                    return add(cx,add(mul(E.front,ca*(E.rz+clearance*.4+.004*s)*flare*r),mul(E.side,sa*(E.rx+clearance*.4+.004*s)*flare*r)));});});
            metal.loft(cuff,plateColor,C.joint(side+'ForeArm'),axis);
            // Its inside shows past the wrist: a second, inward-facing wall.
            metal.loft(cuff.map(ring=>ring.map(p=>sub(p,mul(radial(axis)(p),.0012*s)))),mul(plateColor,.55),C.joint(side+'ForeArm'),p=>add(p,mul(radial(axis)(p),.01)));
            for(const ring of [cuff[0],cuff.at(-1)])bead(edge,every(ring),true,.0024*s,edgeColor,C.joint(side+'ForeArm'),radial(axis),5,.35);
        }
        /** Sabatons over their leather liner: overlapping instep lames, a toe cap on the toes, a heel cup. */
        function sabaton(side) {
            const foot=C.bone(side+'Foot'), toe=C.bone(side+'ToeBase');if(!foot||!toe)return;
            const sx=Math.sign(foot.head[0])||1, liner=worn.filter(p=>p.armorLiner).at(-1);
            let pts=[];
            if(liner)for(let v=0;v<liner.positions.length/3;v++){const p=Array.from(liner.positions.subarray(v*3,v*3+3));if(Math.sign(p[0])===sx&&p[1]<foot.head[1]+.02*s)pts.push(p);}
            if(pts.length<20)pts=fitted.filter(v=>v.family===(sx>0?3:4)&&v.p[1]<foot.head[1]+.02*s).map(v=>add(v.p,[0,0,0]));
            if(!pts.length)return;
            const F=norm([toe.tail[0]-foot.head[0],0,toe.tail[2]-foot.head[2]]), S=norm(cross(Y,F));
            const loc=pts.map(p=>{const q=sub(p,foot.head);return [dot(q,F),dot(q,S),p[1]];});
            const sole=Math.min(...loc.map(q=>q[2])), aMin=Math.min(...loc.map(q=>q[0])), aMax=Math.max(...loc.map(q=>q[0]));
            const aBall=dot(sub(toe.head,foot.head),F), gap=(.0035+.003*C.bulk)*s, yBase=sole+.017*s;
            const sectionAt=(a,band=.009*s)=>{let lo=Infinity,hi=-Infinity,top=-Infinity;for(const [x,b,y]of loc)if(Math.abs(x-a)<band){lo=Math.min(lo,b);hi=Math.max(hi,b);top=Math.max(top,y);}
                if(!Number.isFinite(lo))return null;return {bc:(lo+hi)/2,w:(hi-lo)/2,top};};
            const K=8, e=2.6, toward=(a,b,y)=>add(add(add(mul(F,a),mul(S,b)),[0,y,0]),[foot.head[0],0,foot.head[2]]);
            const arch=(a,sec,off,scale=1)=>Array.from({length:K+1},(_,k)=>{const phi=-Math.PI/2+k/K*Math.PI,sn=Math.sin(phi),cs=Math.cos(phi);
                const w=(sec.w+gap+off)*scale,h=Math.max(.008*s,Math.min(sec.top,foot.head[1]-.012*s)+gap+off-yBase)*(.4+.6*scale);
                return toward(a,sec.bc+w*Math.sign(sn)*Math.abs(sn)**(2/e),yBase+h*Math.abs(cs)**(2/e));});
            const inwardOf=a=>p=>{const c=toward(a,0,yBase);const d=sub(c,p);d[0]-=dot(d,F)*F[0];d[2]-=dot(d,F)*F[2];return norm(d);};
            const inward=p=>{const a=dot(sub(p,[foot.head[0],0,foot.head[2]]),F);return inwardOf(a)(p);};
            const footJ=C.joint(side+'Foot'), toeJ=C.joint(side+'ToeBase');
            // Instep lames from the front of the ankle to the ball of the foot, each lapping the next.
            const a0=Math.max(aMin+.07*s,.03*s), count=3, L=(aBall-a0)/count;
            let last=sectionAt(a0)||{bc:0,w:.035*s,top:yBase+.03*s};
            for(let k=0;k<count;k++){
                const off=(count-k)*.003*s, rows=[0,.5,1].map(v=>a0+k*L+v*(L+(k<count-1?.01*s:-.004*s)));
                const grid=rows.map(a=>{const sec=sectionAt(a)||last;last=sec;return arch(a,sec,off);});
                if(style==='fluted')grid.forEach(row=>{const m=row[K/2];row[K/2]=add(m,[0,.0025*s,0]);});
                sheet(metal,grid,.0016*s,plateColor,footJ,inward);
                bead(edge,grid.at(-1),false,.0018*s,edgeColor,footJ,p=>mul(inward(p),-1),5,.5);
                for(const c of style==='riveted'?[1,K/2,K-1]:[1,K-1])rivet(edge,lerp(grid[1][c],grid[2][c],.3),mul(inward(grid[1][c]),-1),.0024*s,tint,footJ);
            }
            // The toe cap: rounded (Milanese) or drawn to a Gothic point.
            const tipExtra=style==='fluted'?.03*s:.008*s, aEnd=aMax+gap+tipExtra, rowsT=[aBall-.014*s,aBall+.004*s,aBall+(aMax-aBall)*.35,aBall+(aMax-aBall)*.7,aMax-.004*s,aEnd-(aEnd-aMax)*.45,aEnd];
            let ref=sectionAt(aBall)||last;
            const cap=rowsT.map((a,r)=>{const sec=a<aMax-.006*s?(sectionAt(a)||ref):ref;ref=sec;const f=a>aMax-.006*s?Math.sqrt(Math.max(.02,1-((a-(aMax-.006*s))/(aEnd-aMax+.006*s))**(style==='fluted'?.8:2))):1;
                const row=arch(a,sec,-.0015*s,f);if(style==='fluted'){const m=row[K/2];row[K/2]=add(m,[0,.0025*s*f,0]);}return row;});
            sheet(metal,cap,.0016*s,plateColor,toeJ,inward);
        }
        /** Moulded leather armor over its jerkin: front and back plates with stitched rolled edges, straps and buckles. */
        function leather() {
            const waistY=hipY+.075*s, top=neckY-.05*s, cache=new Map();
            const ring=y=>{const key=Math.round(y/(.004*s));if(cache.has(key))return cache.get(key);
                const q=section(y),center=(q.front+q.back)/2;let w=q.width+.008*s,f=q.front-center+.008*s,b=center-q.back+.008*s,grow=1;
                for(const p of torsoPoints)if(Math.abs(p[1]-y)<.02*s){const dz=p[2]-center;grow=Math.max(grow,(Math.abs(p[0]/w)**2.3+Math.abs(dz/(dz>0?f:b))**2.3)**(1/2.3)+.01);}
                const out={center,w:w*grow,f:f*grow,b:b*grow};cache.set(key,out);return out;};
            const at=(a,y,lift=0)=>{const q=ring(y),sn=Math.sin(a),cs=Math.cos(a),r=1/Math.pow(Math.abs(sn)**2.3+Math.abs(cs)**2.3,1/2.3);
                let p=[sn*q.w*r,y,q.center+cs*r*(cs>=0?q.f:q.b)];const o=norm([p[0],0,p[2]-q.center]);
                const t=(y-waistY)/(top-waistY);const d=lift+(style==='moulded'?relief(t,a,.55):0);return add(p,mul(o,d));};
            const axis=p=>[0,p[1],ring(p[1]).center], out=radial(axis), joint=C.joint('Spine2'), studColor=ironColor, buckleColor=Outfit.linear(style==='moulded'?'#9a7a45':'#7d7f84');
            const threadColor=mix(Outfit.linear('#c8b48c'),plateColor,.25);
            const yTop=(a,front)=>top-.06*s*Math.abs(Math.sin(a))**3-(front?.03*s*Math.max(0,Math.cos(a))**6:0);
            const yBot=(a,front)=>waistY-(front?.02*s*Math.max(0,Math.cos(a))**4:0);
            const plates=[];
            for(const front of [true,false]) {
                const a0=front?-1.22:Math.PI-1.12,a1=front?1.22:Math.PI+1.12,Kp=24;
                if(style==='lamellar') {
                    // Rows of laced lamellae, each row lapping over the one below.
                    const rows=6,lam=14;
                    for(let r=0;r<rows;r++){
                        const grid=[0,1].map(v=>Array.from({length:lam*2+1},(_,c)=>{const a=a0+(a1-a0)*c/(lam*2),lo=yBot(a,front),hi=yTop(a,front),y=lo+(hi-lo)*((r+v*1.25)/rows);
                            return at(a,Math.min(hi,y),.003*s+r*.0026*s-(c%2?0:.0012*s));}));
                        sheet(metal,grid,.002*s,plateColor,joint,p=>mul(out(p),-1),(rr,c)=>mul(plateColor,c%2?(1+.05*Math.sin(c*1.7+r)):.62));
                        bead(edge,grid[0],false,.0022*s,edgeColor,joint,out,5,.2);
                        for(let c=1;c<lam*2;c+=2){const p=lerp(grid[0][c],grid[1][c],.82),n=out(p),x=norm(sub(grid[1][c+1],grid[1][c-1]));
                            straps.face([add(p,add(mul(x,-.002*s),[0,-.004*s,0])),add(p,add(mul(x,.002*s),[0,-.004*s,0])),add(p,add(mul(x,.002*s),[0,.004*s,0])),add(p,add(mul(x,-.002*s),[0,.004*s,0]))].map(q=>add(q,mul(n,.0012*s))),Outfit.linear(item.color2||'#4e301a'),joint,n);}
                    }
                    plates.push(null);continue;
                }
                const grid=Array.from({length:12},(_,r)=>Array.from({length:Kp+1},(_,c)=>{const a=a0+(a1-a0)*c/Kp,lo=yBot(a,front),hi=yTop(a,front);return at(a,lo+(hi-lo)*r/11,.003*s);}));
                sheet(metal,grid,.0025*s,plateColor,joint,p=>mul(out(p),-1));
                const R=grid.length, cells=[...grid[0].map((_,c)=>[0,c]),...grid.slice(1).map((_,r)=>[r+1,Kp]),...grid.at(-1).slice(0,-1).map((_,c)=>[R-1,Kp-1-c]),...grid.slice(1,-1).map((_,r)=>[R-2-r,0])];
                const border=cells.map(([r,c])=>grid[r][c]);
                bead(edge,every(border),true,.0034*s,edgeColor,joint,out,5,.1);
                // Running stitches just inside the rolled edge, in a tooled band: inset along the plate itself.
                const inset=([r,c],d)=>{const p=grid[r][c],q=grid[r+(r===0?1:r===R-1?-1:0)][c+(c===0?1:c===Kp?-1:0)];
                    return add(p,mul(norm(sub(q,p)),Math.min(d,Math.hypot(...sub(q,p))*.8)));};
                const path=every(cells).concat([every(cells)[0]]);
                band(etch,path.map(rc=>inset(rc,.006*s)),path.map(rc=>inset(rc,.006*s+Math.max(.006*s,etchWidth*.7))),threadColor,joint,out,.0032*s);
                if(style==='studded')for(let r=2;r<11;r+=2)for(let c=(r/2)%2+1;c<Kp;c+=2){const p=grid[r][c];stud(edge,p,out(p),.0035*s,studColor,joint);}
                plates.push(grid);
            }
            // Shoulder straps over the trapezius, and buckled side straps across the open ribs.
            const strapW=.013*s, strapC=Outfit.linear(item.color2||'#4e301a');
            const strap=(path,j)=>{const grid=path.map((p,i)=>{const n=out(p),tng=norm(sub(path[Math.min(path.length-1,i+1)],path[Math.max(0,i-1)])),x=norm(cross(tng,n));return [add(p,mul(x,-strapW)),add(p,mul(x,strapW))];});
                sheet(straps,grid,.002*s,strapC,j,p=>mul(out(p),-1));};
            for(const sx of [-1,1]) {
                const x=sx*ring(top).w*.56, over=[];
                for(let i=0;i<=6;i++){const z0=ring(top).center+ring(top).f*.55, z1=ring(top).center-ring(top).b*.55, z=z0+(z1-z0)*i/6;
                    // Over the shoulder's top, never up the neck.
                    let y=top-.02*s;for(const p of torsoPoints)if(p[1]<neckY-.005*s&&Math.abs(p[0]-x)<.02*s&&Math.abs(p[2]-z)<.016*s)y=Math.max(y,p[1]);
                    over.push([x,y+.006*s,z]);}
                strap(over,joint);
                for(const h of [.3,.62]) {
                    const y=waistY+(top-waistY)*h, aF=sx*1.12, aB=sx*(Math.PI-1.02);
                    const path=Array.from({length:5},(_,i)=>at(aF+(aB-aF)*i/4,y,.006*s));strap(path,C.joint(h<.5?'Spine1':'Spine2'));
                    const b=at(sx*1.05,y,.0085*s),n=out(b),tng=norm(sub(path[1],path[0])),u=norm(cross(n,tng));
                    buckle(edge,b,tng,u,.02*s,.026*s,.0024*s,n,buckleColor,C.joint(h<.5?'Spine1':'Spine2'));
                }
            }
        }
        if(kind==='breastplate')cuirass();
        if(kind==='pauldrons')for(const [side,f]of [['Left',1],['Right',2]]) {
            shoulder(side+'Arm',f);
            limb(side+'Arm',f,.48,.84);
        }
        if(kind==='vambraces')for(const [side,f]of [['Left',1],['Right',2]]){limb(side+'ForeArm',f,.16,.96);if(surf.finish==='steel')couter(side,f);}
        if(kind==='greaves')for(const [side,f]of [['Left',3],['Right',4]]) {
            const thigh=limb(side+'UpLeg',f,.13,.89);
            const shin=limb(side+'Leg',f,.12,.97);
            poleyn(side,f,shin,thigh);
        }
        if(kind==='tassets')tassets();
        if(kind==='gauntlets'){extraParts.push(glove(2.95-clamp01(item.length??.25)*.6,Outfit.linear(item.color2||'#2e2620')));for(const [side,f]of [['Left',1],['Right',2]])gauntlet(side,f);}
        if(kind==='sabatons')for(const side of ['Left','Right'])sabaton(side);
        if(kind==='leather')leather();
        const label=kind==='leather'?'Leather armor':'Medieval '+kind;
        const edgeRough=surf.finish==='leather'?Math.max(.3,surf.rough-.18):Math.max(.12,surf.rough-.13);
        const parts=[
            metal.part(kind==='leather'?label+' plates':label,{roughness:surf.rough,metalness:surf.metal,finish:surf.finish,tile:style==='riveted'?'hammered':'brushed'}),
            edge.part(label+' edges',{roughness:edgeRough,metalness:surf.finish==='painted'?.6:surf.metal,finish:surf.finish==='painted'?'steel':surf.finish,edgeWear:true}),
            etch.part(label+(surf.finish==='leather'?' tooling':' etching'),{roughness:Math.min(.8,surf.rough+.14),metalness:surf.metal*.9,finish:surf.finish==='leather'?'tooled':'etched'}),
            straps.part(label+' straps',{roughness:.68,metalness:0,finish:'leather'}),
            ...extraParts
        ].filter(p=>p.index.length);
        return {parts,hidden};
    }
    /** Small field equipment and formed recon plates, fitted over the actual clothing surface. */
    function fieldGear(pack, built, item, kind, layers = []) {
        const C = context(pack, built, item), s = C.scale, hip = C.bone('Hips').head[1], neck = C.bone('Neck').head[1];
        const span = Math.max(0.08 * s, neck - hip), chest = C.joint('Spine2'), waist = C.joint('Hips');
        const surfaces = [{ positions: built.parts[0].positions, index: built.parts[0].index }, ...layers];
        const surface=Outfit.projectedSurface(surfaces,{cell:.04*s,accept:(part,ids,p)=>Math.max(...p.map(q=>q[1]))>=hip-.1*s&&Math.min(...p.map(q=>q[1]))<=neck+.04*s});
        const surfaceAt=(x,y,fallback,side=1)=>surface.depth(x,y,fallback,side);
        const frontPlates = [];
        const faceAt = (x,y,lift=0.006*s) => {
            let z = surfaceAt(x,y,C.section(y).front);
            for (const p of frontPlates) if (x >= p.lo[0] && x <= p.hi[0] && y >= p.lo[1] && y <= p.hi[1]) z = Math.max(z,p.height(x,y));
            return [x,y,z+lift];
        };
        // A nonplanar outline cannot be filled with one polygon fan: its
        // triangles cut through a full bust or belly. Fit the entire plate,
        // including its interior and closed back, to the finished fabric.
        function fittedPlate(outline, color, joint, gap = .014 * s, depth = .012 * s, side = 1) {
            const center = mul(outline.reduce(add, [0,0,0]), 1 / outline.length), normal = [0,0,side];
            const lo = [0,1].map(k=>Math.min(...outline.map(p=>p[k]))), hi = [0,1].map(k=>Math.max(...outline.map(p=>p[k])));
            const rx = Math.max((hi[0]-lo[0])/2,.005*s), ry = Math.max((hi[1]-lo[1])/2,.005*s);
            const sample = (x,y) => side*surfaceAt(x,y,side>0?C.section(y).front:C.section(y).back,side);
            // Form the shell over a low-frequency grid. A single quadratic
            // dome extrapolated the belly's slope over the entire chest and
            // lifted whole plates tens of centimetres away from short torsos.
            // Grid spacing limits local folds without importing their creases.
            const cells=8, grid=Array.from({length:cells+1},(_,j)=>Array.from({length:cells+1},(_,i)=>sample(lo[0]+i/cells*rx*2,lo[1]+j/cells*ry*2)));
            for(let pass=0;pass<3;pass++) {
                const next=grid.map(row=>row.slice());
                for(let j=0;j<=cells;j++)for(let i=0;i<=cells;i++) {
                    let sum=0,n=0;
                    for(let v=Math.max(0,j-1);v<=Math.min(cells,j+1);v++)for(let u=Math.max(0,i-1);u<=Math.min(cells,i+1);u++){sum+=grid[v][u];n++;}
                    next[j][i]=Math.max(grid[j][i],sum/n);
                }
                grid.forEach((row,j)=>row.splice(0,row.length,...next[j]));
            }
            const heights=new Map();
            const outer = (x,y) => {
                const key=x+':'+y;if(heights.has(key))return heights.get(key);
                const u=Math.max(0,Math.min(cells-.000001,(x-lo[0])/(rx*2)*cells)),v=Math.max(0,Math.min(cells-.000001,(y-lo[1])/(ry*2)*cells));
                const i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
                const z=(grid[j][i]*(1-a)+grid[j][i+1]*a)*(1-b)+(grid[j+1][i]*(1-a)+grid[j+1][i+1]*a)*b;
                const value=side*(Math.max(z,sample(x,y))+gap);heights.set(key,value);return value;
            };
            const nodes=new Map(),faces=[],borders=[],steps=5;
            const node=p=>{const key=Math.round(p[0]*1e9)+':'+Math.round(p[1]*1e9);if(!nodes.has(key))nodes.set(key,[p[0],p[1],outer(p[0],p[1])]);return nodes.get(key);};
            for(let edge=0;edge<outline.length;edge++){
                const a=outline[edge],b=outline[(edge+1)%outline.length];
                const at=(i,j)=>add(center,add(mul(sub(a,center),i/steps),mul(sub(b,center),j/steps)));
                for(let i=0;i<steps;i++)for(let j=0;j<steps-i;j++){
                    faces.push([at(i,j),at(i+1,j),at(i,j+1)].map(node));
                    if(i+j<steps-1)faces.push([at(i+1,j),at(i+1,j+1),at(i,j+1)].map(node));
                }
                for(let i=0;i<steps;i++)borders.push([node(lerp(a,b,i/steps)),node(lerp(a,b,(i+1)/steps))]);
            }
            // Clear the actual fabric between plate vertices as well. Shared
            // nodes preserve a continuous shell while local corrections lift
            // only the triangles crossing a bust/waist fold.
            for(const face of faces){
                let lift=0;
                for(const weights of [[1/3,1/3,1/3],[.5,.5,0],[.5,0,.5],[0,.5,.5]]){
                    const p=[0,1,2].map(k=>face.reduce((sum,q,i)=>sum+q[k]*weights[i],0));
                    lift=Math.max(lift,sample(p[0],p[1])+depth+.002*s-side*p[2]);
                }
                if(lift>0)for(const p of face)p[2]+=side*lift;
            }
            const vertices=[...nodes.values()],ids=new Map(vertices.map((p,i)=>[p,i]));
            const fitted=Outfit.projectedSurface([{positions:Float64Array.from(vertices.flat()),index:Uint32Array.from(faces.flatMap(f=>f.map(p=>ids.get(p))))}],{cell:.04*s});
            const height=(x,y)=>fitted.depth(x,y,outer(x,y),side);
            const point=(p,inset=0)=>[p[0],p[1],p[2]-side*inset];
            for(const face of faces)for(const back of [false,true]){
                const base=C.shell.p.length;
                C.shell.face(face.map(p=>point(p,back?depth:0)),back?mul(color,.62):color,joint,mul(normal,back?-1:1));
                const h=.006*s;
                for(let i=base;i<C.shell.p.length;i+=3){
                    const x=C.shell.p[i],y=C.shell.p[i+1],dx=(height(x+h,y)-height(x-h,y))/(2*h),dy=(height(x,y+h)-height(x,y-h))/(2*h);
                    const n=mul(norm([-dx,-dy,1]),side*(back?-1:1));C.shell.n.splice(i,3,...n);
                }
            }
            for(const [p,q]of borders){const outward=norm(sub(lerp(p,q,.5),center));C.shell.face([point(p),point(q),point(q,depth),point(p,depth)],mul(color,.78),joint,outward);}
            if(side>0)frontPlates.push({lo,hi,height});
        }
        if (kind === 'recon' || kind === 'vest') {
            const top = neck - span * (kind==='recon'?.22:.09), low = hip + span * 0.40;
            // Separate beveled pectoral plates with real side walls and a breathing gap.
            for (const side of [-1,1]) {
                const outline = [[0.04,0.91],[0.60,1],[0.94,0.80],[0.84,0.12],[0.34,0],[0.05,0.12]].map(([u,v])=>{
                    const y = low + (top-low)*v, q=C.section(y), x=side*u*q.width*(kind==='recon'?.83:1);
                    return faceAt(x,y,0.025*s);
                });
                fittedPlate(outline,C.color,chest,kind==='recon'?.020*s:.014*s);
                for (const k of [1,3]) bolt(C.hardware,faceAt(outline[k][0],outline[k][1],.001*s),Z,.0025*s,C.trim,chest);
                const y = top-(top-low)*.25, q=C.section(y), x=side*q.width*.42;
                for(let row=0;row<3;row++) rectangle(C.hardware,faceAt(x,y-row*.009*s,.003*s),X,Y,q.width*.25,.003*s,Z,C.trim,chest,.001*s,.0004*s);
                rectangle(C.hardware,faceAt(x,y+.010*s,.004*s),X,Y,q.width*.25,.004*s,Z,C.accent,chest,.0015*s,.0005*s);
            }
            // A back shell and independent abdominal lames use their own spine joints.
            const middle=(top+low)/2, q=C.section(middle), z=q.back-.020*s;
            fittedPlate(OCTAGON.map(([x,y])=>[x*q.width*(kind==='recon'?.74:.85),middle+y*(top-low)*.46,z]),C.color,chest,.014*s,.012*s,-1);
            for(let row=0;kind!=='recon'&&row<3;row++) {
                const y=hip+span*(.07+row*.11), q=C.section(y), h=span*.10;
                const outline=OCTAGON.map(([x,v])=>faceAt(x*q.width*.76,y+v*h/2,.019*s));
                fittedPlate(outline,mul(C.color,.87),C.joint(row===2?'Spine1':'Spine'),.011*s,.009*s);
            }
            if (kind === 'recon') for(const side of ['Left','Right']) {
                // A shoulder cup wraps the upper arm. Sample the actual
                // sleeve near each station rather than placing a flat badge
                // at the largest radius found elsewhere on the limb.
                const family=side==='Left'?1:2,E=C.envelope(side+'Arm',family,.12,.48),joint=C.joint(side+'Arm');
                const body=built.parts[0],sections=new Map();
                const at=(t,angle,gap)=>{
                    if(!sections.has(t))sections.set(t,Outfit.crossSection([body,...layers],E.point(t),[E.side,E.along,E.front],
                        (part,v)=>part===body?C.an.member[pack.body.source[v]*5+family]>.45:part.field?.[v]?.fam===family,s));
                    return sections.get(t)(angle,gap);
                };
                // Mirrored arm frames reverse the outer radial direction.
                // Cross the outer shoulder, leaving the armpit half open.
                const angles=Array.from({length:13},(_,k)=>(side==='Left'?1:-1)*(-Math.PI+.15+k/12*(Math.PI-.30)));
                const rings=Array.from({length:5},(_,r)=>angles.map(a=>at(.12+r/4*.30,a,.010*s)));
                C.shell.loft(rings,C.color,joint,p=>E.point(dot(sub(p,E.B.head),E.along)/E.length),undefined,true);
                for(const r of [0,4])for(let k=0;k+1<angles.length;k++){
                    const t=.12+r/4*.30,a=angles[k],b=angles[k+1];
                    C.hardware.face([at(t,a,.010*s),at(t,b,.010*s),at(t,b,.002*s),at(t,a,.002*s)],C.trim,joint,mul(E.along,r===0?-1:1));
                }
            }
        }
        if (kind === 'uniform') {
            const y = hip + span*.77, q=C.section(y), x=q.width*.44;
            const base=faceAt(x,y,.005*s);
            rectangle(C.hardware,base,X,Y,.036*s,.017*s,Z,C.trim,chest,.003*s,.001*s);
            rectangle(C.indicators,add(base,[0,.001*s,.001*s]),X,Y,.025*s,.006*s,Z,C.accent,chest,.0015*s,.0004*s);
            for(let i=0;i<3;i++) rectangle(C.hardware,faceAt(-q.width*.40+i*.007*s,y+.015*s,.004*s),X,Y,.004*s,.012*s,Z,C.accent,chest,.0015*s,.0004*s);
        } else {
            // A compact chest controller, and two closed utility pouches at the hips.
            const y=hip+span*(kind==='recon'?.65:.78), q=C.section(y), x=-q.width*.38, at=faceAt(x,y,(kind==='recon'||kind==='vest')?.004*s:.009*s);
            rectangle(C.hardware,at,X,Y,.043*s,.058*s,Z,C.trim,chest,.006*s,.002*s);
            const glow=Outfit.linear(item.lightColor||'#71cfff');
            rectangle(C.indicators,add(at,[0,.012*s,.001*s]),X,Y,.029*s,.017*s,Z,glow,chest,.002*s,.0006*s);
            for(let row=0;row<2;row++)for(let col=0;col<3;col++)rectangle(C.hardware,add(at,[(col-1)*.009*s,-.010*s-row*.009*s,.002*s]),X,Y,.005*s,.004*s,Z,C.accent,chest,.002*s,.0004*s);
            for(const side of [-1,1]) {
                const y=hip+span*.12, q=C.section(y), x=side*q.width*.66, width=Math.min(.075*s,q.width*.45), height=Math.min(.095*s,span*.19);
                // Soft pouches: rounded bodies, folded flaps and snaps, hung from the belt line.
                const at=faceAt(x,y,.002*s);
                pouch(C.shell,C.hardware,at,width,height,.03*s,mul(C.color,.87),waist,s,C.accent);
                if(kind==='recon'){
                    // Retaining tapes and a pull tab over the pouch face.
                    const face=add(at,[0,0,.031*s]);
                    for(const sign of [-1,1])rectangle(C.hardware,add(face,[sign*width*.27,-height*.18,.001*s]),X,Y,width*.10,height*.5,Z,C.trim,waist,.0015*s,.0005*s);
                    rectangle(C.hardware,add(face,[0,-height*.42,.002*s]),X,Y,width*.20,height*.12,Z,mul(C.accent,.6),waist,.002*s,.0007*s);
                }
            }
        }
        const parts=[];
        if(C.shell.i.length)parts.push(C.shell.part(kind==='recon'?'Recon formed plating':'Field utility pouches',{roughness:.55,metalness:.15}));
        if(C.hardware.i.length)parts.push(C.hardware.part('Field fasteners and controls',{roughness:.5,metalness:.65}));
        if(C.indicators.i.length)parts.push(C.indicators.part('Field status indicators',{roughness:.35,metalness:.1,emissive:item.lightColor||'#71cfff',emissiveIntensity:item.lightStyle==='none'?0:item.lightIntensity??.25}));
        const construction=kind==='recon'?(root.RRCharacterReconConstruction||require('./CharacterReconConstruction.js')).build(C,layers,surfaceAt):null;
        if(construction)parts.push(...construction.parts);
        return {parts,hidden:new Set(),textures:construction?.textures||[]};
    }

    const api={build,helmet,medieval,fieldGear};
    root.RRCharacterPowerArmor=api;
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
