import { describe, expect, test } from "bun:test";
import {
  TouchGestureRecognizer,
  type TouchContact,
} from "../app/touch-gesture.ts";

const touch = (id: number, x: number, y: number): TouchContact => ({
  id,
  x,
  y,
});

describe("TouchGestureRecognizer", () => {
  test("tracks one-finger direct manipulation in logical screen pixels", () => {
    const gesture = new TouchGestureRecognizer();

    expect(gesture.step([touch(7, 100, 80)])).toEqual({
      kind: "direct",
      panX: 0,
      panY: 0,
      zoomFactor: 1,
      anchorX: 100,
      anchorY: 80,
      contacts: 1,
    });
    expect(gesture.step([touch(7, 112, 75)])).toEqual({
      kind: "direct",
      panX: 12,
      panY: -5,
      zoomFactor: 1,
      anchorX: 112,
      anchorY: 75,
      contacts: 1,
    });
  });

  test("reports pinch scale and its moving centroid anchor", () => {
    const gesture = new TouchGestureRecognizer();
    gesture.step([touch(2, 100, 100), touch(9, 200, 100)]);

    const update = gesture.step([
      touch(9, 215, 110),
      touch(2, 95, 90),
    ]);
    expect(update.kind).toBe("direct");
    if (update.kind !== "direct") throw new Error("expected direct update");
    expect(update.contacts).toBe(2);
    expect(update.panX).toBe(5);
    expect(update.panY).toBe(0);
    expect(update.anchorX).toBe(155);
    expect(update.anchorY).toBe(100);
    expect(update.zoomFactor).toBeCloseTo(Math.hypot(120, 20) / 100);
  });

  test("uses stable ids instead of host array order", () => {
    const gesture = new TouchGestureRecognizer();
    gesture.step([touch(1, 20, 20), touch(2, 40, 20)]);

    expect(gesture.step([touch(2, 44, 20), touch(1, 24, 20)])).toEqual({
      kind: "direct",
      panX: 4,
      panY: 0,
      zoomFactor: 1,
      anchorX: 34,
      anchorY: 20,
      contacts: 2,
    });
  });

  test("rebases 1-to-2 and 2-to-1 transitions without jumping", () => {
    const gesture = new TouchGestureRecognizer();
    gesture.step([touch(1, 20, 20)]);
    gesture.step([touch(1, 30, 20)]);

    expect(gesture.step([touch(1, 30, 20), touch(2, 60, 20)])).toMatchObject({
      kind: "direct",
      panX: 0,
      panY: 0,
      zoomFactor: 1,
      contacts: 2,
    });
    gesture.step([touch(1, 28, 20), touch(2, 64, 20)]);
    expect(gesture.step([touch(2, 64, 20)])).toMatchObject({
      kind: "direct",
      panX: 0,
      panY: 0,
      zoomFactor: 1,
      contacts: 1,
    });
  });

  test("continues a filtered pan velocity after release and decays it", () => {
    const gesture = new TouchGestureRecognizer({
      velocityApproach: 0.5,
      inertiaDecay: 0.5,
      stopVelocity: 0.1,
    });
    gesture.step([touch(1, 0, 0)]);
    gesture.step([touch(1, 10, -4)]);
    gesture.step([touch(1, 20, -8)]);

    expect(gesture.step([])).toEqual({
      kind: "inertia",
      panX: 7.5,
      panY: -3,
    });
    expect(gesture.step([])).toEqual({
      kind: "inertia",
      panX: 3.75,
      panY: -1.5,
    });
  });

  test("does not fling when a pinch is released", () => {
    const gesture = new TouchGestureRecognizer({ velocityApproach: 1 });
    gesture.step([touch(1, 100, 100), touch(2, 200, 100)]);
    gesture.step([touch(1, 110, 105), touch(2, 230, 105)]);

    expect(gesture.step([])).toEqual({ kind: "idle" });
  });

  test("a new contact cancels inertia and starts from a fresh baseline", () => {
    const gesture = new TouchGestureRecognizer({ velocityApproach: 1 });
    gesture.step([touch(1, 0, 0)]);
    gesture.step([touch(1, 10, 0)]);
    expect(gesture.step([]).kind).toBe("inertia");

    expect(gesture.step([touch(8, 200, 100)])).toEqual({
      kind: "direct",
      panX: 0,
      panY: 0,
      zoomFactor: 1,
      anchorX: 200,
      anchorY: 100,
      contacts: 1,
    });
    expect(gesture.step([])).toEqual({ kind: "idle" });
  });

  test("rejects invalid dynamics options", () => {
    expect(() => new TouchGestureRecognizer({ velocityApproach: 0 })).toThrow();
    expect(() => new TouchGestureRecognizer({ inertiaDecay: 1 })).toThrow();
    expect(() => new TouchGestureRecognizer({ stopVelocity: -1 })).toThrow();
  });
});
