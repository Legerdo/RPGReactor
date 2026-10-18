/** Character accessories as standalone equipment, using the same procedural geometry. */
(function(root) {
    'use strict';
    const need = (name, file) => root[name] || require(file);
    const Body = need('RRHumanBody', '../Character3D/HumanBody.js');
    const Props = need('RRCharacterProps', '../Character3D/CharacterProps.js');
    const Model = need('RRPropModel', './PropModel.js');
    const Catalog = need('RRPropCatalog', './PropCatalog.js');
    const clamp = (n, a, b, fallback) => Number.isFinite(+n) ? Math.max(a, Math.min(b, +n)) : fallback;
    const MATERIALS = { original:null, metal:[.3,.85], leather:[.6,0], plastic:[.4,0], fabric:[.88,0] };
    let reference = null, loading = null;

    // Load once on first use; a rejected load can be retried without restarting Forge.
    function prepare() {
        if (reference) return Promise.resolve();
        if (!loading) loading = Body.loadPack().then(pack => { reference = { pack, built:Body.build(pack, {}) }; }).finally(() => { loading = null; });
        return loading;
    }
    function normalize(input = {}) {
        const accessory = Props.normalizeProp(input.accessory) || Props.normalizeProp({id:'sword'});
        const def = Props.BY_ID.get(accessory.id);
        if (def.shapes && !def.shapes.some(([id]) => id === accessory.shape)) accessory.shape = def.defaults.shape || def.shapes[0][0];
        return { kind:'accessory', accessory, scale:clamp(input.scale,.1,5,1),
            pivot:['bottom','center','attachment'].includes(input.pivot) ? input.pivot : 'bottom',
            rotation:['x','y','z'].map((_, i) => clamp(input.rotation?.[i],-180,180,0)),
            material:Object.hasOwn(MATERIALS,input.material) ? input.material : 'original' };
    }
    function build(input) {
        if (!reference) throw new Error('Accessory reference is not ready. Call prepare() first.');
        const recipe = normalize(input), {pack,built} = reference;
        const generated = Props.build(pack,built,[recipe.accessory],[]);
        const low=[Infinity,Infinity,Infinity], high=[-Infinity,-Infinity,-Infinity];
        const angles=recipe.rotation.map(v=>v*Math.PI/180);
        const rotate = p => {
            let [x,y,z]=p;
            const [a,b,c]=angles;
            [y,z]=[y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];
            [x,z]=[x*Math.cos(b)+z*Math.sin(b),-x*Math.sin(b)+z*Math.cos(b)];
            return [x*Math.cos(c)-y*Math.sin(c),x*Math.sin(c)+y*Math.cos(c),z];
        };
        // The carrying joint is a useful origin for attaching hats, packs, jewelry, etc.
        const scores=new Float64Array(built.bones.length);
        for (const p of generated.parts) for (let k=0;k<p.joints.length;k++) scores[p.joints[k]]+=p.weights[k];
        const joint=scores.indexOf(Math.max(...scores)), bone=built.bones[joint];
        let attachment=bone.head;
        if (Props.BY_ID.get(recipe.accessory.id).slot === 'held') attachment=bone.head.map((v,k)=>v+(bone.tail[k]-v)*.8);
        const anchor=rotate(attachment);
        const parts=generated.parts.map(p=>{
            const positions=new Float32Array(p.positions.length),normals=new Float32Array(p.normals.length);
            for (let k=0;k<positions.length;k+=3) {
                const point=rotate(Array.from(p.positions.subarray(k,k+3)));
                const normal=rotate(Array.from(p.normals.subarray(k,k+3)));
                for(let d=0;d<3;d++) { positions[k+d]=point[d];normals[k+d]=normal[d];low[d]=Math.min(low[d],point[d]);high[d]=Math.max(high[d],point[d]); }
            }
            const joints=new Uint8Array(positions.length/3*4),weights=new Float32Array(joints.length);
            for(let k=0;k<weights.length;k+=4)weights[k]=1;
            const part=Object.assign({},p,{positions,normals,joints,weights});
            delete part.cloth;
            if (MATERIALS[recipe.material]) [part.roughness,part.metalness]=MATERIALS[recipe.material];
            return part;
        });
        const pivot=recipe.pivot==='attachment' ? anchor : low.map((v,k)=>k===1&&recipe.pivot==='bottom'?v:(v+high[k])/2);
        for(const p of parts) for(let k=0;k<p.positions.length;k++)p.positions[k]=(p.positions[k]-pivot[k%3])*recipe.scale;
        const extent=Math.max(...high.map((v,k)=>(v-low[k])*recipe.scale),.05);
        return {kind:'accessory',recipe,parts,bones:[{name:'Prop',head:[0,0,0],parent:-1}],clips:[],textures:{},
            height:extent, triangles:parts.reduce((n,p)=>n+p.index.length/3,0)};
    }
    const api={normalize,prepare,build,ready:()=>!!reference};
    root.RRAccessoryProp=api;
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
    Model.register({id:'accessory',label:'Equipment',...api});
    const groups=[...new Set(Props.PROPS.map(p=>p.group))];
    for(const [i,group] of groups.entries()) Catalog.category({id:'equipment-'+group,label:'Equipment › '+group,order:60+i});
    for(const def of Props.PROPS) Catalog.add({id:'accessory-'+def.id,category:'equipment-'+def.group,label:def.label,
        icon:def.id==='sword'?'sword':def.id==='dagger'?'dagger':'equipment',kind:'accessory',keywords:'accessory equipment wearable '+def.slot,
        start:()=>normalize({accessory:{id:def.id}}),matches:r=>r.accessory?.id===def.id});
    Catalog.ui('accessory',{
        placeholder:'Equipment',tabs:[['equipment','Equipment']],reset:r=>normalize({accessory:{id:r.accessory.id}}),
        panel() {
            const def=Props.BY_ID.get(this.recipe.accessory.id),d=def.defaults;
            let html=this._section(def.label);
            if(def.shapes)html+=this._select('accessory.shape','Shape',def.shapes);
            if(d.side)html+=this._select('accessory.side','Side',[['left','Left'],['right','Right']]);
            for(const key of ['size','height','length','width','up']) if(d[key]!=null) html+=this._slider({path:'accessory.'+key,label:{size:'Size',height:'Height',length:'Length',width:'Width',up:'Raised'}[key],range:[key==='up'||key==='length'?0:.05,3],step:.01});
            html+=this._section('Look')+this._color('accessory.color','Color');
            if(d.color2)html+=this._color('accessory.color2','Accent');
            html+=this._select('material','Material',[['original','Original'],['metal','Metal'],['leather','Leather'],['plastic','Plastic'],['fabric','Fabric']]);
            html+=this._section('Placement')+this._slider({path:'scale',label:'Scale',range:[.1,5],step:.05})
                +this._select('pivot','Origin',[['bottom','Bottom'],['center','Center'],['attachment','Attachment point']]);
            for(const [i,label] of ['Rotate X','Rotate Y','Rotate Z'].entries())html+=this._slider({path:'rotation.'+i,label,range:[-180,180],step:1,format:'deg'});
            return html;
        }
    });
})(typeof window!=='undefined'?window:globalThis);
