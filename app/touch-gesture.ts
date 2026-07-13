// Pure touch gesture recognition for the Figma canvas.
//
// The native/framework adapter owns touch sampling and viewport mapping. It
// passes a snapshot of front-panel contacts in PocketJS logical coordinates
// here once per simulation tick. Keeping this module independent of HostOps
// lets the same input tape run in unit tests, Vita capture tests and the app.

import type { TouchContact } from "@pocketjs/framework/input";

export type { TouchContact } from "@pocketjs/framework/input";

export type TouchGestureUpdate =
  | { readonly kind: "idle" }
  | {
      readonly kind: "direct";
      /** Screen-space delta; positive values move content right/down. */
      readonly panX: number;
      readonly panY: number;
      /** Relative scale for this tick. One means no zoom. */
      readonly zoomFactor: number;
      /** Pinch/pan anchor in logical viewport coordinates. */
      readonly anchorX: number;
      readonly anchorY: number;
      readonly contacts: 1 | 2;
    }
  | {
      readonly kind: "inertia";
      /** Screen-space delta; positive values move content right/down. */
      readonly panX: number;
      readonly panY: number;
    };

export interface TouchGestureOptions {
  /** Low-pass factor for the release velocity, in (0, 1]. */
  readonly velocityApproach?: number;
  /** Velocity retained on each tick after release, in [0, 1). */
  readonly inertiaDecay?: number;
  /** Stop once both screen-space velocity components are below this value. */
  readonly stopVelocity?: number;
}

interface Sample {
  readonly key: string;
  readonly contacts: 1 | 2;
  readonly cx: number;
  readonly cy: number;
  readonly distance: number;
}

const DEFAULT_VELOCITY_APPROACH = 0.35;
const DEFAULT_INERTIA_DECAY = 0.88;
const DEFAULT_STOP_VELOCITY = 0.05;

function inRange(name: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}

function sampleContacts(contacts: readonly TouchContact[]): Sample | null {
  if (contacts.length === 0) return null;

  // Hosts are not required to preserve array order. Stable ids make the
  // selected pair and its baseline deterministic across frames.
  const selected = [...contacts].sort((a, b) => a.id - b.id).slice(0, 2);
  const first = selected[0];
  if (!first) return null;
  if (selected.length === 1) {
    return {
      key: `${first.id}`,
      contacts: 1,
      cx: first.x,
      cy: first.y,
      distance: 0,
    };
  }

  const second = selected[1]!;
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  return {
    key: `${first.id}:${second.id}`,
    contacts: 2,
    cx: (first.x + second.x) / 2,
    cy: (first.y + second.y) / 2,
    distance: Math.hypot(dx, dy),
  };
}

export class TouchGestureRecognizer {
  private readonly velocityApproach: number;
  private readonly inertiaDecay: number;
  private readonly stopVelocity: number;

  private previous: Sample | null = null;
  private velocityX = 0;
  private velocityY = 0;

  constructor(options: TouchGestureOptions = {}) {
    this.velocityApproach =
      options.velocityApproach ?? DEFAULT_VELOCITY_APPROACH;
    this.inertiaDecay = options.inertiaDecay ?? DEFAULT_INERTIA_DECAY;
    this.stopVelocity = options.stopVelocity ?? DEFAULT_STOP_VELOCITY;

    inRange("velocityApproach", this.velocityApproach, Number.EPSILON, 1);
    inRange("inertiaDecay", this.inertiaDecay, 0, 1 - Number.EPSILON);
    inRange("stopVelocity", this.stopVelocity, 0, Number.MAX_VALUE);
  }

  reset(): void {
    this.previous = null;
    this.velocityX = 0;
    this.velocityY = 0;
  }

  step(contacts: readonly TouchContact[]): TouchGestureUpdate {
    const current = sampleContacts(contacts);
    if (!current) {
      const released = this.previous;
      this.previous = null;
      // Pinch is intentionally direct-only. A two-finger release must not
      // turn its moving centroid into a surprising fling.
      if (released?.contacts === 2) {
        this.velocityX = 0;
        this.velocityY = 0;
        return { kind: "idle" };
      }
      if (
        Math.abs(this.velocityX) < this.stopVelocity &&
        Math.abs(this.velocityY) < this.stopVelocity
      ) {
        this.velocityX = 0;
        this.velocityY = 0;
        return { kind: "idle" };
      }

      const update: TouchGestureUpdate = {
        kind: "inertia",
        panX: this.velocityX,
        panY: this.velocityY,
      };
      this.velocityX *= this.inertiaDecay;
      this.velocityY *= this.inertiaDecay;
      return update;
    }

    const previous = this.previous;
    this.previous = current;

    // A new finger, a lifted finger or contact-id replacement establishes a
    // fresh baseline. This prevents the canvas jumping during 1 <-> 2 finger
    // transitions and also cancels a running inertial glide immediately.
    if (
      !previous ||
      previous.contacts !== current.contacts ||
      previous.key !== current.key
    ) {
      this.velocityX = 0;
      this.velocityY = 0;
      return {
        kind: "direct",
        panX: 0,
        panY: 0,
        zoomFactor: 1,
        anchorX: current.cx,
        anchorY: current.cy,
        contacts: current.contacts,
      };
    }

    const panX = current.cx - previous.cx;
    const panY = current.cy - previous.cy;
    if (current.contacts === 1) {
      this.velocityX += (panX - this.velocityX) * this.velocityApproach;
      this.velocityY += (panY - this.velocityY) * this.velocityApproach;
    } else {
      this.velocityX = 0;
      this.velocityY = 0;
    }

    const zoomFactor =
      current.contacts === 2 && previous.distance > 0
        ? current.distance / previous.distance
        : 1;

    return {
      kind: "direct",
      panX,
      panY,
      zoomFactor: Number.isFinite(zoomFactor) ? zoomFactor : 1,
      anchorX: current.cx,
      anchorY: current.cy,
      contacts: current.contacts,
    };
  }
}
