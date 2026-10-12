// Run with: npm test  (node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CreateChain,
    CreateWorld,
    ResetWorldStep,
    SetWorldScale,
    SpriteToCircle,
    WorldStep,
    b2Body_GetPosition,
    b2DefaultWorldDef,
    b2DestroyWorld,
    b2Shape_GetAABB,
    b2Shape_GetCapsule,
    b2Vec2,
    b2WorldId
} from '../src/main.js';
import { b2GetWorldFromId } from '../src/include/world_h.js';
import { b2_speculativeDistance } from '../src/include/core_h.js';

// shape AABBs are padded by the speculative distance on every side
const pad = 2 * b2_speculativeDistance;

// The library asserts on internal state with console.assert; keep test output readable
const silent = { ...console };
console.assert = (cond, ...msg) => { if (!cond) { silent.error('assert', ...msg); } };

function newWorld (gravity = new b2Vec2(0, -10))
{
    const worldDef = b2DefaultWorldDef();
    worldDef.gravity = gravity;

    return CreateWorld({ worldDef }).worldId;
}

function steps (worldId)
{
    return b2GetWorldFromId(worldId).stepIndex;
}

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// ---------- SpriteToCircle ----------

test('SpriteToCircle: 60px square sprite at scale 30 gets radius 1', () =>
{
    SetWorldScale(30);
    const worldId = newWorld();
    const body = SpriteToCircle(worldId, { x: 300, y: 300, width: 60, height: 60, rotation: 0 }, {});

    close(body.object.radius, 1);

    // collision bounds match: AABB is 2m x 2m around the body
    const aabb = b2Shape_GetAABB(body.shapeId);
    const p = b2Body_GetPosition(body.bodyId);
    close(aabb.upperBoundX - aabb.lowerBoundX - pad, 2, 1e-6);
    close(aabb.upperBoundY - aabb.lowerBoundY - pad, 2, 1e-6);
    close((aabb.upperBoundX + aabb.lowerBoundX) / 2, p.x, 1e-3);
    b2DestroyWorld(worldId);
});

test('SpriteToCircle: explicit radius override is respected', () =>
{
    SetWorldScale(30);
    const worldId = newWorld();
    const body = SpriteToCircle(worldId, { x: 0, y: 0, width: 60, height: 60, rotation: 0 }, { radius: 0.25 });

    close(body.object.radius, 0.25);
    const aabb = b2Shape_GetAABB(body.shapeId);
    close(aabb.upperBoundX - aabb.lowerBoundX - pad, 0.5, 1e-6);
    b2DestroyWorld(worldId);
});

test('SpriteToCircle: scaled / non-square sprite uses half the larger scaled side', () =>
{
    SetWorldScale(30);
    const worldId = newWorld();

    // 60 x 30 sprite scaled 2 x 3 => 120 x 90 px => radius 60px = 2m
    const a = SpriteToCircle(worldId, { x: 0, y: 0, width: 60, height: 30, rotation: 0, scaleX: 2, scaleY: 3 });
    close(a.object.radius, 2);
    close(b2Shape_GetAABB(a.shapeId).upperBoundY - b2Shape_GetAABB(a.shapeId).lowerBoundY - pad, 4, 1e-6);

    // Phaser-style scale vector, negative (flipped) scale still gives a positive radius
    const b = SpriteToCircle(worldId, { x: 0, y: 0, width: 30, height: 90, rotation: 0, scale: { x: -1, y: 1 } });
    close(b.object.radius, 1.5);
    b2DestroyWorld(worldId);
});

// ---------- WorldStep: per-world accumulator ----------

test('WorldStep: two worlds with equal elapsed time step equally regardless of call order', () =>
{
    const A = newWorld();
    const B = newWorld();

    for (let i = 0; i < 6; i++)
    {
        WorldStep({ worldId: A, deltaTime: 1 / 120 });
        WorldStep({ worldId: B, deltaTime: 1 / 120 });
    }

    assert.equal(steps(A), 3);
    assert.equal(steps(B), 3);
    b2DestroyWorld(A);
    b2DestroyWorld(B);
});

test('WorldStep: per-world fixedTimeStep values are independent', () =>
{
    const A = newWorld();
    const B = newWorld();

    for (let i = 0; i < 60; i++)
    {
        WorldStep({ worldId: A, deltaTime: 1 / 60, fixedTimeStep: 1 / 60 });
        WorldStep({ worldId: B, deltaTime: 1 / 60, fixedTimeStep: 1 / 30 });
    }

    assert.equal(steps(A), 60);
    assert.equal(steps(B), 30);
    b2DestroyWorld(A);
    b2DestroyWorld(B);
});

test('WorldStep: a re-created world does not inherit leftover time', () =>
{
    const A = newWorld();
    WorldStep({ worldId: A, deltaTime: 0.9 / 60 }); // leaves 0.9 of a step owed
    assert.equal(steps(A), 0);
    b2DestroyWorld(A);

    const A2 = newWorld();
    WorldStep({ worldId: A2, deltaTime: 0.5 / 60 });
    assert.equal(steps(A2), 0);

    // explicit reset also clears pending time
    WorldStep({ worldId: A2, deltaTime: 0.4 / 60 });
    ResetWorldStep(A2);
    WorldStep({ worldId: A2, deltaTime: 0.5 / 60 });
    assert.equal(steps(A2), 0);
    b2DestroyWorld(A2);
});

test('WorldStep: a world slot reused with a new revision starts with no leftover time', () =>
{
    const A = newWorld();
    WorldStep({ worldId: A, deltaTime: 0.9 / 60 });
    assert.equal(steps(A), 0);

    // simulate destroy + re-create into the same slot (same index1, bumped revision)
    const world = b2GetWorldFromId(A);
    world.revision += 1;
    const reused = new b2WorldId(A.index1, world.revision);
    WorldStep({ worldId: reused, deltaTime: 0.5 / 60 });
    assert.equal(steps(reused), 0);
    WorldStep({ worldId: reused, deltaTime: 0.5 / 60 });
    assert.equal(steps(reused), 1);
    b2DestroyWorld(reused);
});

// ---------- WorldStep: slow-frame catch-up ----------

function stepsForOneSecond (hz)
{
    const w = newWorld();

    for (let i = 0; i < hz; i++)
    {
        WorldStep({ worldId: w, deltaTime: 1 / hz, fixedTimeStep: 1 / 60 });
    }
    const n = steps(w);
    b2DestroyWorld(w);

    return n;
}

test('WorldStep: thirty 1/30 s calls advance ~one simulated second', () =>
{
    assert.equal(stepsForOneSecond(30), 60);
});

test('WorldStep: 30/60/120 Hz callers agree over the same elapsed time', () =>
{
    assert.equal(stepsForOneSecond(60), 60);
    assert.equal(stepsForOneSecond(120), 60);
    assert.equal(stepsForOneSecond(30), 60);
});

test('WorldStep: a very long frame is bounded by maxCatchUpSteps', () =>
{
    const w = newWorld();
    WorldStep({ worldId: w, deltaTime: 5 });
    assert.equal(steps(w), 4); // default budget
    // the excess is discarded, not carried over
    WorldStep({ worldId: w, deltaTime: 0 });
    assert.equal(steps(w), 4);

    WorldStep({ worldId: w, deltaTime: 5, maxCatchUpSteps: 2 });
    assert.equal(steps(w), 6);
    b2DestroyWorld(w);
});

test('WorldStep: falling body reaches the same position at 60 and 120 Hz (seconds deltas)', () =>
{
    function fall (hz)
    {
        SetWorldScale(30);
        const w = newWorld();
        const body = SpriteToCircle(w, { x: 0, y: 0, width: 60, height: 60, rotation: 0 });

        for (let i = 0; i < hz * 2; i++)
        {
            // Phaser Scene.update delta is in ms; the template converts with / 1000
            const deltaMs = 1000 / hz;
            WorldStep({ worldId: w, deltaTime: deltaMs / 1000 });
        }
        const y = b2Body_GetPosition(body.bodyId).y;
        b2DestroyWorld(w);

        return y;
    }

    const y60 = fall(60);
    const y120 = fall(120);
    assert.ok(y60 < -15, `body should have fallen ~20m, got ${y60}`);
    close(y60, y120, 1e-9);
});

// ---------- CreateChain ----------

test('CreateChain: omitted radius uses 0.5 for finite capsule endpoints', () =>
{
    const w = newWorld();
    const links = CreateChain({ worldId: w, firstLinkPosition: new b2Vec2(0, 0), lastLinkPosition: new b2Vec2(10, 0), chainLinks: 5, linkLength: 2, fixEnds: false });
    assert.equal(links.length, 5);

    for (const link of links)
    {
        const c = b2Shape_GetCapsule(link.shapeId);
        assert.ok([ c.center1.x, c.center1.y, c.center2.x, c.center2.y ].every(Number.isFinite));
        close(c.center1.x, -0.5);
        close(c.center2.x, 0.5);
        close(c.radius, 0.5);
    }
    b2DestroyWorld(w);
});

test('CreateChain: explicit radius produces matching endpoint offsets', () =>
{
    const w = newWorld();
    const links = CreateChain({ worldId: w, firstLinkPosition: new b2Vec2(0, 0), lastLinkPosition: new b2Vec2(10, 0), chainLinks: 3, linkLength: 2, radius: 0.25, fixEnds: false });
    const c = b2Shape_GetCapsule(links[0].shapeId);
    close(c.center1.x, -0.75);
    close(c.center2.x, 0.75);
    close(c.radius, 0.25);
    b2DestroyWorld(w);
});

test('CreateChain: impossible dimensions are rejected with clear errors', () =>
{
    const w = newWorld();
    const base = { worldId: w, firstLinkPosition: new b2Vec2(0, 0), lastLinkPosition: new b2Vec2(10, 0), linkLength: 2, fixEnds: false };

    assert.throws(() => CreateChain({ ...base, chainLinks: 0 }), /chainLinks/);
    assert.throws(() => CreateChain({ ...base, chainLinks: -3 }), /chainLinks/);
    assert.throws(() => CreateChain({ ...base, chainLinks: 2.5 }), /chainLinks/);
    assert.throws(() => CreateChain({ ...base, chainLinks: 3, linkLength: 0.5 }), /diameter/);
    assert.throws(() => CreateChain({ ...base, chainLinks: 3, radius: 0 }), /radius/);
    assert.throws(() => CreateChain({ ...base, chainLinks: 3, radius: -1 }), /radius/);
    b2DestroyWorld(w);
});
