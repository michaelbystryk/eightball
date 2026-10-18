import * as THREE from 'three';

export const CAM_IDLE = new THREE.Vector3(0, 3.4, 9.6);
const LOOK_IDLE = new THREE.Vector3(0, 1.3, 2);
const UP = new THREE.Vector3(0, 1, 0);

// Smoothly damped camera with three moods: idle sway, chase, and reveal close-up.
export class CameraDirector {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'idle';
    this.pos = CAM_IDLE.clone();
    this.look = LOOK_IDLE.clone();
    this.up = UP.clone();
    this.shake = 0;
    this.reveal = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3() };
    this._p = new THREE.Vector3();
    this._l = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._back = new THREE.Vector3();
  }

  setReveal(pos, look, up) {
    this.reveal.pos.copy(pos);
    this.reveal.look.copy(look);
    this.reveal.up.copy(up);
    this.mode = 'reveal';
  }

  update(dt, t, ballPos) {
    const p = this._p, l = this._l, u = this._u.copy(UP);
    let k = 2.2;
    let kLook = 4;

    if (this.mode === 'idle') {
      p.set(Math.sin(t * 0.25) * 0.5, CAM_IDLE.y + Math.sin(t * 0.4) * 0.1, CAM_IDLE.z);
      l.copy(LOOK_IDLE);
      k = 1.6;
    } else if (this.mode === 'follow') {
      const back = this._back.set(this.pos.x - ballPos.x, 0, this.pos.z - ballPos.z);
      if (back.lengthSq() < 1e-4) back.set(0, 0, 1);
      back.normalize();
      p.copy(ballPos).addScaledVector(back, 4.4);
      p.y = ballPos.y + 2.4;
      l.copy(ballPos);
      k = 2.4;
      kLook = 6;
    } else {
      p.copy(this.reveal.pos);
      l.copy(this.reveal.look);
      u.copy(this.reveal.up);
      k = 1.5;
      kLook = 2.5;
    }

    this.pos.lerp(p, 1 - Math.exp(-k * dt));
    this.look.lerp(l, 1 - Math.exp(-kLook * dt));
    this.up.lerp(u, 1 - Math.exp(-k * dt)).normalize();

    const cam = this.camera;
    cam.position.copy(this.pos);
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    cam.up.copy(this.up);
    cam.lookAt(this.look);
  }
}
