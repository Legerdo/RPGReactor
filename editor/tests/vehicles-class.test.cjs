'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { boardWorld, bike, event } = require('./helpers/vehicles-board-world.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
function world() {
    return boardWorld({width:60,height:30,vehicles:[bike(31,10,10),bike(32,30,10)],prepare(data,w) {
        Object.assign(w.$dataReactorVehicles[1],{classId:1,initialLevel:2,equips:[1,1]});
        w.$dataStates[2]={id:2,name:'Damage',traits:[],restriction:0,minTurns:1,maxTurns:1,priority:50,autoRemovalTiming:0};
        w.$dataClasses[1].rrVehicleSlots=[1,2];
        w.$dataSystem.equipTypes=['','Gun','Armor'];
        w.$dataClasses[1].traits=[{code:51,dataId:1,value:1},{code:52,dataId:1,value:1}];
        w.$dataWeapons[1]={id:1,name:'Gun',wtypeId:1,etypeId:1,params:[0,0,30,0,0,0,0,0],traits:[],note:''};
        w.$dataArmors[1]={id:1,name:'Armor',atypeId:1,etypeId:2,params:[0,0,0,20,0,0,0,0],traits:[],note:''};
    }});
}
test('each vehicle reuses its class, equipment, traits and states without becoming a party actor',()=>{
    const w=world(), a=w.V.battler(31), b=w.V.battler(32), leader=w.$gameParty.leader();
    assert.notEqual(a,b);assert.notEqual(a,leader);
    assert.equal(a.currentClass(),w.$dataClasses[1]);assert.equal(a.level,2);
    assert.deepEqual(Array.from(a.equipSlots()),[1,2]);
    assert.equal(a.weapons()[0],w.$dataWeapons[1]);assert.equal(a.armors()[0],w.$dataArmors[1]);
    assert.equal(a.paramPlus(2),30);assert.equal(a.paramPlus(3),20);
    const original=[leader.hp,b.hp];a.gainHp(-100);a.addState(2);
    assert.deepEqual([leader.hp,b.hp],original);assert.equal(b.isStateAffected(2),false);
    const savedHP=a.hp;w.saveAndLoad();w.V.resume();
    const loaded=w.V.battler('1:31');assert.equal(loaded.hp,savedHP);assert.equal(loaded.isStateAffected(2),true);
    assert.equal(loaded.weapons()[0],w.$dataWeapons[1]);assert.equal(loaded.constructor.name,'Game_ReactorVehicle');
    const action=new w.Game_Action(loaded);action.setAttack();assert.equal(action.subject(),loaded);
});
test('a vehicle class layout allows duplicate weapon slots and an empty layout',()=>{
    const w=world(), V=w.Reactor3D.Vehicles;
    assert.deepEqual(Array.from(V.equipmentSlots({rrVehicleSlots:[1,1,2]},w.$dataSystem.equipTypes)),[1,1,2]);
    assert.deepEqual(Array.from(V.equipmentSlots({rrVehicleSlots:[]},w.$dataSystem.equipTypes)),[]);
    const actorSlots=Array.from(w.$gameParty.leader().equipSlots());
    w.$dataClasses[1].rrVehicleSlots=[];const b=w.V.battler(31);assert.deepEqual(Array.from(b.equipSlots()),[]);
    assert.deepEqual(Array.from(w.$gameParty.leader().equipSlots()),actorSlots);
});
test('vehicle condition and loadout keep the original identity when travelling',()=>{
    const w=world(), home=plain(w.$dataMap), away=plain(home);away.events=[null,event(1,3,3)];
    const b=w.V.battler(31);b.gainHp(-100);b.addState(2);const hp=b.hp;
    w.stand(11,10,4);assert.equal(w.board(31),true);
    w.$gamePlayer.reserveTransfer(2,20,10,6,0);w.$dataMap=away;w.$gamePlayer.performTransfer();w.V.resume();
    assert.equal(w.V.idOf(w.V.ridden()),'1:31');assert.equal(w.V.battler('1:31'),b);
    w.saveAndLoad();w.V.resume();assert.equal(w.V.battler('1:31').hp,hp);assert.equal(w.V.battler('1:31').isStateAffected(2),true);
});
test('a vehicle without a class has no new battler state',()=>{
    const w=boardWorld({vehicles:[bike(31,10,10)]});assert.equal(w.V.battler(31),null);
    assert.equal(w.$gameMap._rrVehicles?.battlers,undefined);
});
