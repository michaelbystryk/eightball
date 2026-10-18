import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _w = new THREE.Vector3();
const _tq = new THREE.Vector3();
const _n = new THREE.Vector3();

// A bottom-weighted ball on a dish-shaped table (height(d), slope(d) of the distance
// from the centre) fenced by a circular rim.
// The weight sits opposite the window (local -Y), so on the table gravity's torque
// keeps rocking the ball until the window faces straight up, like a weeble.
export class BallPhysics {
  constructor(radius, rimLimit, ground = { height: () => 0, slope: () => 0 }) {
    this.r = radius;
    this.ground = ground;
    this.rimLimit = rimLimit; // max horizontal distance of the ball centre
    this.gravity = -16;
    this.comOffset = 0.05; // centre of mass, below the geometric centre
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.grounded = false;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z) + Math.abs(this.vel.y);
  }

  // how close the window is to pointing straight up (1 = up)
  windowUp(quat) {
    return _w.set(0, 1, 0).applyQuaternion(quat).y;
  }

  step(dt, quat) {
    const n = 4;
    const h = dt / n;
    for (let i = 0; i < n; i++) this._sub(h, quat);
  }

  // height of the ball centre when resting on the table at (x, z)
  restY(x, z) {
    const d = Math.hypot(x, z);
    const k = this.ground.slope(d);
    return this.ground.height(d) + this.r * Math.sqrt(1 + k * k);
  }

  _rollFromVel() {
    this.angVel.x = this.vel.z / this.r;
    this.angVel.z = -this.vel.x / this.r;
  }

  _sub(h, quat) {
    const { pos, vel, r, angVel } = this;

    if (!this.grounded) {
      vel.y += this.gravity * h;
    } else {
      // gravity on the off-centre weight: angular acceleration about the contact point
      // (I_contact = 7/5 m r^2) that turns the window toward the sky
      _w.set(0, 1, 0).applyQuaternion(quat);
      _tq.crossVectors(_w, UP).multiplyScalar((-this.gravity * this.comOffset) / (1.4 * r * r));
      angVel.x += _tq.x * h;
      angVel.z += _tq.z * h;

      // rolling without slipping: the centre moves with the spin
      vel.x = -angVel.z * r;
      vel.z = angVel.x * r;

      // the dish: gravity along the slope, rolling (5/7 g sin a), toward the centre
      const dc = Math.hypot(pos.x, pos.z);
      const k = this.ground.slope(dc);
      // slow and the weight is rolling it up the slope: it wedges and turns in place
      // (slipping on the velvet) until upright, instead of fighting the dish to a standstill
      const wedged = k > 0 && (vel.x * pos.x + vel.z * pos.z) > 0 && Math.hypot(vel.x, vel.z) < 0.8;
      if (k > 0 && !wedged) {
        const a = ((5 / 7) * -this.gravity * k) / (1 + k * k);
        vel.x -= (pos.x / dc) * a * h;
        vel.z -= (pos.z / dc) * a * h;
      }

      // rolling resistance: viscous when slow so the rocking can settle upright, and
      // heavier once the window is nearly up so the last wobbles die out quickly
      const speed = Math.hypot(vel.x, vel.z);
      const upright = Math.min(1, Math.max(0, (_w.y - 0.85) / 0.15));
      const visc = 0.7 + 1.6 * upright;
      if (speed > 0) {
        const dec = (speed < 0.6 ? visc * speed : 0.6 * visc + 0.2 * (speed - 0.6)) * h;
        const s = Math.max(0, speed - dec) / speed;
        vel.x *= s;
        vel.z *= s;
      }
      // the rune circle gently calls the ball home (only while it still has momentum,
      // so it never fights the weight once the ball is rocking to rest)
      const pull = 0.12 * Math.min(1, Math.max(0, speed - 0.8));
      vel.x -= pos.x * pull * h;
      vel.z -= pos.z * pull * h;
      this._rollFromVel();
      angVel.y *= Math.exp(-2 * h);
      const out = wedged ? (vel.x * pos.x + vel.z * pos.z) / dc : 0;
      if (out > 0) {
        vel.x -= (pos.x / dc) * out;
        vel.z -= (pos.z / dc) * out;
      }
    }

    pos.addScaledVector(vel, h);

    // table bounce (off the local surface normal of the dish)
    const floor = this.restY(pos.x, pos.z);
    if (this.grounded) {
      pos.y = floor;
    } else if (pos.y < floor) {
      pos.y = floor;
      const dc = Math.hypot(pos.x, pos.z) || 1;
      const k = this.ground.slope(dc);
      const nl = Math.sqrt(1 + k * k);
      _n.set((-k * pos.x) / dc / nl, 1 / nl, (-k * pos.z) / dc / nl);
      const vn = vel.dot(_n);
      if (vn < -1.2) {
        vel.addScaledVector(_n, -1.42 * vn);
        vel.x *= 0.92;
        vel.z *= 0.92;
        // the impact grabs some of the spin
        angVel.x += (vel.z / r - angVel.x) * 0.5;
        angVel.z += (-vel.x / r - angVel.z) * 0.5;
      } else {
        vel.y = 0;
        // blend spin and travel into a consistent roll
        vel.x = (vel.x + -angVel.z * r) * 0.5;
        vel.z = (vel.z + angVel.x * r) * 0.5;
        this._rollFromVel();
        this.grounded = true;
      }
    }

    // rim
    const d = Math.hypot(pos.x, pos.z);
    if (d > this.rimLimit) {
      const nx = pos.x / d;
      const nz = pos.z / d;
      pos.x = nx * this.rimLimit;
      pos.z = nz * this.rimLimit;
      const vn = vel.x * nx + vel.z * nz;
      if (vn > 0 && this.grounded && vn < 0.8) {
        // leaning on the rim: it can still turn upright by slipping against the brass
        vel.x -= nx * vn;
        vel.z -= nz * vn;
      } else if (vn > 0) {
        vel.x -= nx * vn * 1.55;
        vel.z -= nz * vn * 1.55;
        angVel.y += (Math.random() - 0.5) * vn * 2;
        if (this.grounded) this._rollFromVel();
      }
    }

    const w = angVel.length();
    if (w > 1e-5) {
      _axis.copy(angVel).divideScalar(w);
      _dq.setFromAxisAngle(_axis, w * h);
      quat.premultiply(_dq);
    }
  }
}
