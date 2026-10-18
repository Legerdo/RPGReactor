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

    function housing(C,name,family,lo,hi,extra=0) {
        const E=C.envelope(name,family,lo,hi), s=C.scale;
        const gap=(.015+.014*C.bulk+extra)*s;
        const radius=[E.rx+gap,E.rz+gap], joint=C.joint(name);
        const ts=[lo,lo+.035,(lo+hi)/2,hi-.035,hi];
        const taper=/ForeArm$/.test(name)?.68:/UpLeg$/.test(name)?.78:/Leg$/.test(name)?.63:.82;
        const widths=[1,1,(1+taper)/2,taper,taper];
        const rings=ts.map((t,r)=>OCTAGON.map(([x,z])=>add(E.point(t),add(mul(E.side,x*(radius[0]*widths[r]-(r===0||r===4?.004*s:0))),mul(E.front,z*(radius[1]*widths[r]-(r===0||r===4?.004*s:0)))))));
        C.shell.face(rings[0],mul(C.color,.7),joint,mul(E.along,-1));
        for(let r=0;r<4;r++) for(let k=0;k<8;k++) {
            const n=(k+1)%8;
            const outward=norm(add(mul(E.side,(OCTAGON[k][0]+OCTAGON[n][0])/2),mul(E.front,(OCTAGON[k][1]+OCTAGON[n][1])/2)));
            C.shell.face([rings[r][k],rings[r][n],rings[r+1][n],rings[r+1][k]],mul(C.color,r===0||r===3?.86:1),joint,outward);
        }
        C.shell.face(rings[4],mul(C.color,.7),joint,E.along);
        // A separate inset front panel gives the housing a deliberate face and a narrow reveal.
        const frontCenter=add(E.point((lo+hi)/2),mul(E.front,radius[1]*(1+taper)/2+.004*s));
        const w=radius[0]*1.12,h=E.length*(hi-lo)*.62;
        const normal=norm(add(E.front,mul(E.along,radius[1]*(1-taper)/(E.length*(hi-lo)))));
        plate(C.shell,OCTAGON.map(([x,y])=>add(frontCenter,add(mul(E.side,x*w/2*(1-(1-taper)*y/2)),add(mul(E.along,y*h/2),mul(E.front,-y*h/2*radius[1]*(1-taper)/(E.length*(hi-lo))))))),normal,.008*s,.004*s,mul(C.color,1.04),joint);
        const line=add(frontCenter,mul(E.along,h*.25));
        rectangle(C.hardware,line,E.side,E.along,w*.62,.009*s,E.front,C.trim,joint,.003*s,.001*s);
        return E;
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
            guard(C,elbow,forearm.front,forearm.side,forearm.along,forearm.rx*1.35,.075*s,C.joint(side+'ForeArm'));
            const knee=add(shin.B.head,mul(shin.front,Math.max(thigh.rz,shin.rz)+.026*s));
            guard(C,knee,shin.front,shin.side,shin.along,shin.rx*1.7,.105*s,C.joint(side+'Leg'));
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

    function helmet(pack,built,item) {
        const C=context(pack,built,item),s=C.scale,P=C.P;
        const ids=C.ids.filter(v=>C.an.member[v*5]>.6&&C.an.s[v*5]>4.45);
        const eyes=built.parts.find(p=>p.name==='Eyes').positions;
        let eyeY=0;for(let i=1;i<eyes.length;i+=3)eyeY+=eyes[i];eyeY/=eyes.length/3;
        const crown=Math.max(...ids.map(v=>P[v*3+1])),low=eyeY-(crown-eyeY)*.7;
        let rx=0,front=-Infinity,back=Infinity;
        for(const v of ids) { if(P[v*3+1]<low)continue;rx=Math.max(rx,Math.abs(P[v*3]));front=Math.max(front,P[v*3+2]);back=Math.min(back,P[v*3+2]); }
        // Ear width does not determine the helmet's width: the brow cross-section does.
        const brow=ids.filter(v=>Math.abs(P[v*3+1]-eyeY-.025*s)<.018*s);
        if(brow.length)rx=Math.max(...brow.map(v=>Math.abs(P[v*3])));
        rx+=.015*s;front+=.016*s;back-=.016*s;
        const cz=(front+back)/2,rz=(front-back)/2,head=C.joint('Head');
        const levels=[[low, .82],[eyeY+.02*s,1],[crown-.035*s,1],[crown+.018*s,.63]],rings=[];
        for(const [y,k]of levels)rings.push(OCTAGON.map(([x,z])=>[x*rx*k,y,cz+z*rz*k]));
        for(let r=0;r+1<rings.length;r++)for(let k=0;k<8;k++) {
            const n=(k+1)%8,out=norm([OCTAGON[k][0]+OCTAGON[n][0],0,OCTAGON[k][1]+OCTAGON[n][1]]);
            plate(C.shell,[rings[r][k],rings[r][n],rings[r+1][n],rings[r+1][k]],out,.009*s,.003*s,C.color,head);
        }
        C.shell.face(rings[3],C.color,head,Y);
        const visorZ=front+.006*s;
        const visor=[[-.7,-1],[.7,-1],[.9,.6],[.65,1],[-.65,1],[-.9,.6]].map(([x,y])=>[x*rx,eyeY+y*.018*s,visorZ]);
        plate(C.hardware,visor,Z,.008*s,.003*s,Outfit.linear('#121d26'),head);
        rectangle(C.indicators,[-rx*.44,eyeY+.009*s,visorZ+.002*s],X,Y,rx*.55,.003*s,Z,C.accent,head,.001*s,.0005*s);
        for(let i=-1;i<=1;i++)rectangle(C.hardware,[i*.018*s,low+.024*s,front-.002*s],X,Y,.008*s,.018*s,Z,C.trim,head,.003*s,.001*s);
        const hidden=new Set(C.ids.filter(v=>C.an.member[v*5]>.5&&C.an.s[v*5]>4.3));
        return {parts:[C.shell.part('Power helmet plating',{roughness:.38,metalness:.65}),C.hardware.part('Power helmet visor',{roughness:.22,metalness:.45}),C.indicators.part('Power helmet indicators',{roughness:.3,metalness:.25})],hidden};
    }
    const api={build,helmet};
    root.RRCharacterPowerArmor=api;
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
