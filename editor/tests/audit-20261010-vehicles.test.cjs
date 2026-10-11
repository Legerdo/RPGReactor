'use strict';
// The 2026-10-10 audit of the vehicle runtime (runtime/reactor_vehicles.js, reactor_vehicles_drive.js): each test is a
// failure a player meets, played in the world of helpers/vehicles-board-world.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boardWorld, bike, motorcycle, event, page } = require('./helpers/vehicles-board-world.cjs');
const { floor } = require('./helpers/vehicles-drive-world.cjs');

const copy = value => JSON.parse(JSON.stringify(value));
const sprite = { characterName: 'Vehicle', characterIndex: 0 };
const town = { name: 'Town', volume: 90, pitch: 100, pan: 0 };
/** A Transfer Player to another map, as the map scene carries it out. */
function transfer(w, mapId, data, x = 20, y = 10, direction = 6) {
    w.$gamePlayer.reserveTransfer(mapId, x, y, direction, 0);
    w.$dataMap = copy(data);
    w.$gamePlayer.performTransfer();
    w.V.resume();
}
const hold = (w, key, ticks) => { w.keys[key] = true; w.run(ticks); w.keys[key] = false; };
/** A type placed by the database on map 1 at (10, 10), facing east. */
const placed = (extra = {}) => [null, motorcycle(Object.assign({ startMapId: 1, startX: 10, startY: 10, startDirection: 6, sheet: sprite }, extra))];
/** A 2D map with one vehicle event at (10, 10), heading east. */
const flat = (extra = {}, options = {}) => boardWorld(Object.assign({ flat: true, model: false, width: 40, height: 30,
    vehicles: [bike(31, 10, 10, { yaw: 90 })], types: [null, motorcycle(Object.assign({ sheet: sprite }, extra))] }, options));
/** The music asked for, by name. */
function music(w) {
    const played = [];
    w.AudioManager.playBgm = bgm => { played.push(bgm ? bgm.name : ''); };
    return played;
}

test('a map that plays its music on arrival plays it for a party aboard a vehicle with no music of its own', () => {
    const w = boardWorld({ width: 60, vehicles: [bike(31, 10, 10)] }), away = copy(w.$dataMap);
    away.events = [null];
    away.autoplayBgm = true;
    away.bgm = town;
    const played = music(w);
    w.stand(11, 10, 4);
    assert.equal(w.board(31), true);
    transfer(w, 2, away);
    w.$gameMap.autoplay();
    assert.equal(w.V.isRiding(), true, 'the party arrived aboard');
    assert.deepEqual(played, ['Town'], 'the destination\'s music plays');
});

test('the same for a boat that plays no music; a vehicle with music of its own keeps it until the party is on foot', () => {
    const w = boardWorld({});
    const played = music(w), boat = w.$gameMap.boat();
    boat.setLocation(1, 5, 5);
    w.$gamePlayer._vehicleType = 'boat';
    boat.getOn();
    w.$dataMap.autoplayBgm = true;
    w.$dataMap.bgm = town;
    w.$gameMap.autoplay();
    assert.deepEqual(played, ['Town']);

    const own = boardWorld({ width: 60, vehicles: [bike(31, 10, 10)], types: [null, motorcycle({ bgm: { name: 'Ride', volume: 90, pitch: 100, pan: 0 } })] });
    const away = copy(own.$dataMap);
    away.events = [null];
    away.autoplayBgm = true;
    away.bgm = town;
    const heard = music(own);
    own.stand(11, 10, 4);
    assert.equal(own.board(31), true);
    transfer(own, 2, away);
    own.$gameMap.autoplay();
    assert.deepEqual(heard, ['Ride'], 'its own music plays on');
    assert.equal(own.V.getOff({ instant: true }), true);
    assert.deepEqual(heard, ['Ride', 'Town'], 'and the map\'s comes back with the party on foot');
});

test('a database vehicle taken out of the world is put back by its identity, at once and after the map was left', () => {
    const w = boardWorld({ types: placed() });
    assert.equal(w.V.remove('0:1'), true);
    assert.equal(w.V.find('0:1'), null);
    assert.equal(w.V.setLocation('0:1', 15, 12, 90), true, 'put back on the map it was taken from');
    assert.deepEqual([w.V.find('0:1')._realX, w.V.find('0:1')._realY], [15, 12]);

    const later = boardWorld({ types: placed() }), home = copy(later.$dataMap), away = copy(home);
    away.events = [null];
    assert.equal(later.V.remove('0:1'), true);
    transfer(later, 2, away);
    transfer(later, 1, home);
    assert.equal(later.V.find('0:1'), null, 'it stays out of the world');
    assert.equal(later.V.list().filter(e => later.V.isVehicle(e)).length, 0);
    assert.equal(later.V.setLocation('0:1', 15, 12, 90), true, 'until a command puts it back');
    assert.deepEqual([later.V.find('0:1')._realX, later.V.find('0:1')._realY], [15, 12]);
    assert.equal(later.V.where('0:1').map, 1);
});

test('a vehicle taken out of the world on a map it was ridden to is put back there, and only under its own identity', () => {
    const w = boardWorld({ width: 60, vehicles: [bike(31, 10, 10, { key: 'bike' })] }), away = copy(w.$dataMap);
    away.events = [null];
    w.stand(11, 10, 4);
    assert.equal(w.board(31), true);
    transfer(w, 2, away);
    assert.equal(w.V.getOff({ instant: true }), true);
    const visiting = w.V.find('1:31');
    assert.equal(w.V.remove('1:31'), true);
    assert.equal(w.V.setLocation(w.$gameMap.mapId() + ':' + visiting.eventId(), 30, 12, 90), false, 'the event id it has on this map is no identity of its own');
    assert.equal(w.V.setLocation('1:31', 30, 12, 90), true);
    assert.deepEqual([w.V.find('1:31')._realX, w.V.find('1:31')._realY, w.V.where('1:31').map], [30, 12, 2]);
});

test('what the ride reports of a database vehicle names it as boarding does', () => {
    const w = boardWorld({ types: placed() });
    const seen = [];
    w.ReactorEvents.on('vehicleGetOn', payload => seen.push('on ' + payload.vehicle));
    w.ReactorEvents.on('vehicleLand', payload => seen.push('land ' + payload.vehicle));
    w.stand(11, 10, 4);
    assert.equal(w.V.getOn(w.V.find('0:1'), { instant: true }), true);
    w.run(2);
    // A hop off the ground.
    const d = w.$gamePlayer._rrDrive;
    d.air = 1; d.vz = 0.05; d.peak = d.alt;
    w.run(60);
    assert.deepEqual(seen, ['on 0:1', 'land 0:1']);
});

test('one press of Cancel gets the party off a vehicle that takes longer to stop than the press is kept', () => {
    // An airship at top speed brakes for two seconds, then comes down.
    const w = boardWorld({ width: 200, height: 30, vehicles: [bike(31, 10, 10, { yaw: 90 })], types: [null, motorcycle({ kind: 'airship', medium: 'air', flight: { height: 3 } })] });
    w.stand(9, 10, 6);
    assert.equal(w.V.getOn(31, { instant: true }), true);
    hold(w, 'right', 300);
    assert.ok(w.$gamePlayer._rrDrive.v > 13, 'at top speed: ' + w.$gamePlayer._rrDrive.v);
    w.press('cancel');
    w.run(400, () => !w.V.isRiding());
    assert.equal(w.V.isRiding(), false);
    assert.equal(w.$gamePlayer._vehicleType, 'walk');
});

test('a vehicle that flies high comes all the way down for the party to get off', () => {
    const w = boardWorld({ width: 60, height: 30, vehicles: [bike(31, 10, 10, { yaw: 90 })], types: [null, motorcycle({ kind: 'airship', medium: 'air', flight: { height: 12 } })] });
    w.stand(9, 10, 6);
    assert.equal(w.V.getOn(31, { instant: true }), true);
    w.run(5);
    assert.equal(w.$gamePlayer._rrDrive.alt, 12);
    w.press('cancel');
    w.run(400, () => !w.V.isRiding());
    assert.equal(w.V.isRiding(), false, 'down from 12 tiles on one press');
});

test('a press to get off is still let go where the vehicle cannot come down', () => {
    const w = boardWorld({ width: 60, height: 30, vehicles: [bike(31, 10, 10, { yaw: 90 })], types: [null, motorcycle({ kind: 'airship', medium: 'air', flight: { height: 3 } })] });
    w.stand(9, 10, 6);
    assert.equal(w.V.getOn(31, { instant: true }), true);
    w.run(5);
    w.$gameMap.isAirshipLandOk = () => false;
    w.press('cancel');
    w.run(1);
    assert.equal(w.$gamePlayer._rrDrive.leave, 'ok');
    w.run(w.V.KEEP + 2);
    assert.equal(w.$gamePlayer._rrDrive.leave, '', 'let go after its 90 ticks');
    assert.equal(w.V.isRiding(), true);
    assert.equal(w.V.isBusy(), false, 'and a command that waits for it goes on');
});

test('on a 2D map, a Player Touch event the vehicle is driven into starts, once for the contact', () => {
    const touch = event(40, 14, 10, { pages: [page({ priorityType: 1, trigger: 1,
        list: [{ code: 122, indent: 0, parameters: [1, 1, 1, 0, 1] }, { code: 0, indent: 0, parameters: [] }] })] });
    const w = flat({}, { events: [touch] });
    w.stand(9, 10, 6);
    assert.equal(w.V.getOn(31, { instant: true }), true);
    hold(w, 'right', 180);
    assert.ok(w.$gamePlayer._realX < 13.51, 'it stops at the event: ' + w.$gamePlayer._realX);
    assert.equal(w.$gameVariables.value(1), 1, 'and the event ran once while the key was held against it');
    // Put back down the road and driven into it again, it runs again.
    const p = w.$gamePlayer;
    p._realX = p._x = 11;
    w.V.Drive.seat(p);
    hold(w, 'right', 180);
    assert.ok(p._realX > 13 && p._realX < 13.51, 'at the event again: ' + p._realX);
    assert.equal(w.$gameVariables.value(1), 2);
});

test('on a 2D map, a parked boat stops a vehicle on the ground as an event does', () => {
    const w = flat();
    w.$gameMap.boat().setLocation(1, 14, 10);
    w.stand(9, 10, 6);
    assert.equal(w.V.getOn(31, { instant: true }), true);
    hold(w, 'right', 180);
    assert.ok(w.$gamePlayer._realX < 13.51, 'it stops at the boat: ' + w.$gamePlayer._realX);
    assert.equal(w.V.isRiding(), true);
});

test('on a 2D map, a ride stops at the edge of the map and slides along it', () => {
    const w = flat();
    const p = w.stand(9, 10, 6), e = w.vehicle(31);
    assert.equal(w.V.getOn(31, { instant: true }), true);
    hold(w, 'left', 200);
    assert.deepEqual([p._realX, p._x, e._realX], [0, 0, 0], 'its middle is on the first column, not half a tile off the map');
    assert.equal(p._rrDrive.v, 0, 'met square, it stops');
    // Turned along the edge it drives on, and stops in the corner.
    hold(w, 'up', 900);
    assert.ok(p._realX < 0.5, 'still at the edge: ' + p._realX);
    assert.equal(p._realY, 0, 'north along it to the corner');
    const far = flat();
    far.stand(9, 10, 6);
    assert.equal(far.V.getOn(31, { instant: true }), true);
    hold(far, 'right', 400);
    assert.equal(far.$gamePlayer._realX, 39, 'the last column on the other side');
});

/** A map 100 wide: a ledge 3 high, and from x = 82 a lake two deep. */
const lakeMap = () => copy(boardWorld(floor({ width: 100, height: 20, ground: x => (x < 80 ? 3 : x < 82 ? 0 : -2),
    water: [{ x0: 82, y0: 0, x1: 99, y1: 19, level: 0 }] })).$dataMap);
/** Rides the vehicle the party is aboard off the ledge at speed; answers the darkest the screen got and the ticks it was being put back. */
function intoTheLake(w, ticks, each) {
    const p = w.$gamePlayer;
    p._rrDrive.v = 20;
    w.keys.right = true;
    let dark = 255, backs = 0;
    for (let t = 0; t < ticks; t++) {
        w.run(1);
        w.$gameScreen.update();
        dark = Math.min(dark, w.$gameScreen.brightness());
        const d = p._rrDrive;
        if (d && d.back > 0) { backs++; w.keys.right = false; }
        if (each && each(d, backs) === false) break;
    }
    w.keys.right = false;
    return { dark, backs };
}

test('ridden to another map, a vehicle that comes down in deep water is put back where it arrived, not on a place of the map it left', () => {
    // Boarded at (150, 10) on a map 200 wide; the destination is 100 wide.
    const w = boardWorld({ width: 200, height: 20, vehicles: [bike(31, 150, 10, { yaw: 90 })] });
    const p = w.stand(151, 10, 4);
    assert.equal(w.board(31), true);
    transfer(w, 2, lakeMap(), 76, 10, 6);
    assert.equal(w.V.isRiding(), true);
    const { dark, backs } = intoTheLake(w, 200);
    assert.ok(backs > 0 && dark === 0, 'it splashed and the screen dipped');
    assert.equal(w.$gameScreen.brightness(), 255);
    assert.equal(w.$gameMap.isValid(p._x, p._y), true, 'on the map: ' + p._x + ', ' + p._y);
    assert.deepEqual([p._realX, p._realY, p._rrDrive.alt], [76, 10, 3], 'on the ledge it arrived on');
    w.press('cancel');
    w.run(60);
    assert.equal(p._vehicleType, 'walk', 'and the party can get off');
});

test('a transfer within the map is where the vehicle is put back, too', () => {
    const data = lakeMap();
    const w = boardWorld(Object.assign(floor({ width: 100, height: 20, ground: x => (x < 80 ? 3 : x < 82 ? 0 : -2),
        water: [{ x0: 82, y0: 0, x1: 99, y1: 19, level: 0 }] }), { vehicles: [bike(31, 10, 10, { yaw: 90 })] }));
    assert.equal(data.width, w.$dataMap.width);
    const p = w.stand(11, 10, 4);
    assert.equal(w.board(31), true);
    p.reserveTransfer(1, 76, 10, 6, 0);
    p.performTransfer();
    w.V.resume();
    assert.equal(w.V.isRiding(), true);
    intoTheLake(w, 200);
    assert.deepEqual([p._realX, p._realY], [76, 10]);
});

test('a ride that ends while the screen is dipped for a put-back gives the screen back', () => {
    const w = boardWorld(Object.assign(floor({ width: 100, height: 20, ground: x => (x < 80 ? 3 : x < 82 ? 0 : -2),
        water: [{ x0: 82, y0: 0, x1: 99, y1: 19, level: 0 }] }), { vehicles: [bike(31, 70, 10, { yaw: 90 })] }));
    const p = w.stand(69, 10, 6);
    assert.equal(w.V.getOn(31, { instant: true }), true);
    // In the dip, an event takes the vehicle away.
    intoTheLake(w, 200, (d, backs) => backs < 3);
    assert.ok(p._rrDrive.back > 0 && p._rrDrive.fade > 0, 'the dip is under way');
    w.$gameMap.event(31).erase();
    for (let t = 0; t < 60; t++) { w.run(1); w.$gameScreen.update(); }
    assert.equal(p._vehicleType, 'walk');
    assert.equal(w.$gameScreen.brightness(), 255, 'the screen is not left dark');
});
