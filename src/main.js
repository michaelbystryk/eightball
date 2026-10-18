import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { buildSet, createTrail, RIM_INNER, tableHeight, tableSlope } from './set.js';
import { createBall, BALL_R, WINDOW_Y } from './ball.js';
import { BallPhysics } from './physics.js';
import { CameraDirector, CAM_IDLE } from './cameraDirector.js';
import { answerIndexForCode, decodeMessage, encodeMessage, layoutMessage, MAX_MESSAGE } from './answers.js';

// Chakra Petch outlines, pre-baked to small JSON (see fonts/): the die's carved lettering
// and the slanted 8 on the shell. index.html starts the downloads before this module runs.
const [dieFont, eightFont] = (await Promise.all(window.fontJSON)).map((json) => new Font(json));

// ---------- renderer ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
const isTouch = window.matchMedia('(pointer: coarse)').matches;
// phones have tiny, dense screens: 1.5x is plenty sharp and much lighter on the GPU
const pixelRatio = Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#12051f', 0.018);

// Reflections: a dark violet room with warm candle points and nebula glows,
// so the glossy ball shows crisp highlights instead of a grey studio wash.
function buildEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.MeshBasicMaterial({ color: '#12081f', side: THREE.BackSide }),
  ));
  const blob = (color, intensity, x, y, z, r) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }),
    );
    m.position.set(x, y, z);
    env.add(m);
  };
  blob('#ffd9a8', 5, 6, 12, -5, 1.4);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    blob('#ff9c4a', 10, Math.cos(a) * 9, 2.5, Math.sin(a) * 9, 0.25);
  }
  blob('#7a4cff', 1.6, -12, 3, -9, 4);
  blob('#3fd0ff', 1.2, 11, 4, -10, 3);
  blob('#5a1f80', 0.5, 0, -12, 0, 8);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}
const envTex = buildEnvironment();
scene.environment = envTex;
scene.environmentIntensity = 0.25;

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.copy(CAM_IDLE);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.75, 0.6, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- world ----------

const set = buildSet(scene, { lite: isTouch });
const trail = createTrail(scene, pixelRatio);
const ball = createBall(dieFont, eightFont);
scene.add(ball.group);
ball.setEnvMap(envTex);
const physics = new BallPhysics(BALL_R, RIM_INNER - BALL_R, { height: tableHeight, slope: tableSlope });
const director = new CameraDirector(camera);

const UP = new THREE.Vector3(0, 1, 0);
const IDLE_POS = new THREE.Vector3(0, 2.0, 5.0);
const idleQuat = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, -1, 0),
  CAM_IDLE.clone().sub(IDLE_POS).normalize(),
);
ball.group.position.copy(IDLE_POS);
ball.spinner.quaternion.copy(idleQuat);

// ---------- ui ----------

const hintEl = document.getElementById('hint');
const answerEl = document.getElementById('answer');
const againEl = document.getElementById('again');
const homeEl = document.getElementById('home');

// secret outcome: /<code> or /#<code> (see CODES in answers.js),
// a custom message: /m.<payload> or /#m.<payload>, and the link maker: /make or /#make
const makeEl = document.getElementById('make');
const makeText = document.getElementById('make-text');
const makeLink = document.getElementById('make-link');
const makeCopy = document.getElementById('make-copy');
let forcedIndex = null;
function readCode() {
  const code = location.hash.slice(1) || location.pathname.split('/').filter(Boolean).pop() || '';
  const message = decodeMessage(code);
  if (message) {
    forcedIndex = ball.setCustom(layoutMessage(message));
  } else {
    ball.setCustom(null);
    forcedIndex = answerIndexForCode(code);
  }
  ball.setForced(forcedIndex);
  const making = code.toLowerCase() === 'make';
  makeEl.classList.toggle('show', making);
  homeEl.classList.toggle('show', forcedIndex !== null || making);
}
readCode();
window.addEventListener('hashchange', readCode);
homeEl.addEventListener('click', (e) => {
  e.preventDefault();
  history.replaceState(null, '', '/');
  readCode();
  askAgain();
});

makeText.maxLength = MAX_MESSAGE;
function updateMakeLink() {
  const text = makeText.value.trim();
  const url = text ? `${location.origin}/#m.${encodeMessage(text)}` : '';
  makeLink.textContent = url || 'Type a message to get your secret link';
  makeLink.href = url || '#make';
  makeCopy.disabled = !url;
}
makeText.addEventListener('input', updateMakeLink);
makeCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(makeLink.href).catch(() => {});
  makeCopy.textContent = 'Copied ✓';
  setTimeout(() => (makeCopy.textContent = 'Copy link'), 1500);
});
updateMakeLink();
const HINT_MOUSE = 'Ask your question aloud… then grab the orb, shake it, and throw';
const HINT_TOUCH = 'Ask your question aloud… or drag the orb to shake and throw';
let hintText = '';
function setHint(text) {
  if (text === hintText) return;
  hintText = text;
  hintEl.textContent = text;
}

// ---------- state ----------

let state = 'idle';
let stateTime = 0;
let energy = 0;
let runeEnergy = 0;
let stillTime = 0;
let answer = null;
let answerShown = false;

function setState(s) {
  state = s;
  stateTime = 0;
}

const returnFrom = new THREE.Vector3();
const returnQuat = new THREE.Quaternion();

// ---------- input ----------

const canvas = renderer.domElement;
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const dragPlane = new THREE.Plane();
const grabOffset = new THREE.Vector3();
const holdTarget = new THREE.Vector3();
const grabSphere = new THREE.Sphere(new THREE.Vector3(), BALL_R * 2.2);
let samples = [];
let lastMove = null;
let lastDir = null;

function updatePointer(e) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
}

function pointerOnBall() {
  raycaster.setFromCamera(pointer, camera);
  grabSphere.center.copy(ball.group.position);
  return raycaster.ray.intersectsSphere(grabSphere);
}

canvas.addEventListener('pointerdown', (e) => {
  updatePointer(e);
  if (state !== 'idle' || !pointerOnBall()) return;
  const n = camera.getWorldDirection(new THREE.Vector3()).negate();
  dragPlane.setFromNormalAndCoplanarPoint(n, ball.group.position);
  const hit = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
  grabOffset.copy(ball.group.position).sub(hit ?? ball.group.position);
  holdTarget.copy(ball.group.position);
  canvas.setPointerCapture(e.pointerId);
  samples = [];
  lastDir = null;
  lastMove = { x: e.clientX, y: e.clientY, t: performance.now() };
  energy = 0;
  setState('hold');
});

canvas.addEventListener('pointermove', (e) => {
  updatePointer(e);
  if (state === 'idle') canvas.style.cursor = pointerOnBall() ? 'grab' : 'default';
  if (state !== 'hold') return;
  canvas.style.cursor = 'grabbing';

  // shake = rapid direction reversals
  const now = performance.now();
  const dtm = Math.max(1, now - lastMove.t) / 1000;
  const vx = (e.clientX - lastMove.x) / dtm;
  const vy = (e.clientY - lastMove.y) / dtm;
  const sp = Math.hypot(vx, vy);
  if (sp > 450) {
    const dir = { x: vx / sp, y: vy / sp };
    if (lastDir && dir.x * lastDir.x + dir.y * lastDir.y < -0.3) {
      energy = Math.min(1, energy + 0.16);
    }
    lastDir = dir;
  }
  lastMove = { x: e.clientX, y: e.clientY, t: now };
});

function release() {
  if (state !== 'hold') return;
  canvas.style.cursor = 'default';
  throwBall();
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// back to a fresh question: the ball returns to hover (or, in the hand, the die sinks again)
function askAgain() {
  if (state === 'hand') { restartHand(); return; }
  if (state !== 'reveal' && state !== 'roll') return;
  againEl.classList.remove('show');
  answerEl.classList.remove('show');
  ball.watch(false);
  returnFrom.copy(ball.group.position);
  returnQuat.copy(ball.spinner.quaternion);
  director.mode = 'idle';
  setState('return');
}
againEl.addEventListener('click', askAgain);

// ---------- handheld mode (phones): hold the phone like the 8 ball ----------
// The table and props vanish, the window turns to face you, and the phone's own motion
// shakes the liquid. After enough shakes, hold still and the die floats up to the glass.

const SHAKES_NEEDED = 5; // full back-and-forth shakes
const HAND_POS = new THREE.Vector3(0, 2.4, 0);
const HAND_DOWN = new THREE.Vector3(0, 0, -1); // liquid gravity: into the ball, away from you
const HAND_AXIS = new THREE.Vector3(0, 0, 1); // the view axis through the window
// window (ball-local +Y) toward the viewer at +Z, the 8 (ball-local -Y) away
const HAND_Q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
const camRight = new THREE.Vector3();
const camUpV = new THREE.Vector3();
const handCam = new THREE.Vector3();
const handTilt = new THREE.Quaternion();
const handTiltE = new THREE.Euler();
const handRollQ = new THREE.Quaternion();
const handUp = new THREE.Vector3();
let handRoll = 0; // turn about the view axis so the answer reads upright (invisible on a round ball)
const motion = {
  on: false, asked: false, gravity: null, lastDir: null, lastJolt: 0,
  reversals: 0, offset: new THREE.Vector2(),
};
let handPhase = 'shake'; // shake → settle (die floats up) → answer

function onMotion(e) {
  if (state !== 'hand') return;
  // acceleration without gravity, in the device's frame (x right, y up, z out of the screen)
  let a = e.acceleration;
  if (!a || a.x == null) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) return;
    motion.gravity ??= { x: g.x, y: g.y, z: g.z };
    for (const k of ['x', 'y', 'z']) motion.gravity[k] += (g[k] - motion.gravity[k]) * 0.1;
    a = { x: g.x - motion.gravity.x, y: g.y - motion.gravity.y, z: g.z - motion.gravity.z };
  }
  // into screen axes when the phone is turned sideways
  const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
  const x = a.x * Math.cos(angle) + a.y * Math.sin(angle);
  const y = -a.x * Math.sin(angle) + a.y * Math.cos(angle);
  const z = a.z;
  const mag = Math.hypot(x, y, z);
  if (mag < 9) return;

  // a shake is a sharp jolt that reverses direction; two reversals make one back-and-forth
  const dir = { x: x / mag, y: y / mag, z: z / mag };
  const last = motion.lastDir;
  if (last && dir.x * last.x + dir.y * last.y + dir.z * last.z < -0.3) {
    motion.reversals++;
    energy = Math.min(1, energy + 0.12);
    // shaking again after the answer (or while it surfaces) asks again, like the real toy
    if (handPhase !== 'shake') restartHand(handPhase === 'answer' ? 1 : motion.reversals);
  }
  motion.lastDir = dir;
  motion.lastJolt = performance.now();
  // the ball lags the phone, so it swings against the jolt
  motion.offset.x = THREE.MathUtils.clamp(motion.offset.x - x * 0.006, -0.25, 0.25);
  motion.offset.y = THREE.MathUtils.clamp(motion.offset.y - y * 0.006, -0.25, 0.25);
}

function restartHand(reversals = 0) {
  againEl.classList.remove('show');
  answerEl.classList.remove('show');
  ball.watch(false);
  motion.reversals = reversals;
  answerShown = false;
  readyTime = 0;
  handPhase = 'shake';
}

function enterHand() {
  set.showProps(false);
  motionEl.classList.remove('show');
  ball.spinner.quaternion.copy(HAND_Q);
  ball.group.position.copy(HAND_POS);
  energy = 0;
  restartHand();
  director.mode = 'reveal';
  setState('hand');
}

const motionEl = document.getElementById('motion');
// iOS only lets a page read motion after a tap on something like a button, and only over https
const motionNeedsTap = typeof window.DeviceMotionEvent?.requestPermission === 'function';
const motionOffered = isTouch && !!window.DeviceMotionEvent;

async function enableMotion() {
  if (motion.asked || state !== 'idle') return;
  if (motionNeedsTap) {
    // must be the first thing the tap does, or Safari refuses to show the prompt
    let res;
    try {
      res = await DeviceMotionEvent.requestPermission();
    } catch {
      return; // not counted as a tap (or not https): leave the button up to try again
    }
    if (res !== 'granted') {
      motion.asked = true; // denied: stay on the table and drag instead
      return;
    }
  }
  if (!motion.on) window.addEventListener('devicemotion', onMotion);
  motion.on = true;
  enterHand();
}
motionEl.addEventListener('click', enableMotion);

// ---------- actions ----------

function throwBall() {
  const now = performance.now() / 1000;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => s.t >= now - 0.09) ?? samples[0];
  const v = new THREE.Vector3();
  if (last && first && last.t - first.t > 0.01) {
    v.copy(last.p).sub(first.p).divideScalar(last.t - first.t);
  }
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const vr = v.dot(right);
  const vu = Math.max(0, v.dot(camUp));

  const push = THREE.MathUtils.clamp(4 + vu * 0.9 + Math.abs(vr) * 0.2, 4, 14);
  physics.pos.copy(ball.group.position);
  physics.vel
    .copy(fwd).multiplyScalar(push)
    .addScaledVector(right, THREE.MathUtils.clamp(vr * 0.7, -8, 8));
  physics.vel.y = Math.min(6, 2.2 + vu * 0.2);
  physics.angVel.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    .multiplyScalar(10 + energy * 14);
  physics.grounded = false;

  answerShown = false;
  readyTime = 0;
  stillTime = 0;
  director.mode = 'follow';
  setState('roll');
}

const revealAway = new THREE.Vector3();

// The weighted ball has rocked to rest window-up: fly overhead and watch the die surface.
function startReveal() {
  const p = ball.group.position;
  revealAway.set(p.x - director.pos.x, 0, p.z - director.pos.z);
  if (revealAway.lengthSq() < 1e-4) revealAway.set(0, 0, -1);
  revealAway.normalize();
  ball.watch(true, revealAway);
  director.mode = 'reveal';
  setState('reveal');
}

// ---------- loop ----------

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
const prevPos = new THREE.Vector3();
const dq = new THREE.Quaternion();
const wobble = new THREE.Quaternion();
const wobbleE = new THREE.Euler();
const camN = new THREE.Vector3();
const revealUp = new THREE.Vector3();
const revealPos = new THREE.Vector3();
let readyTime = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const t = clock.elapsedTime;
  stateTime += dt;

  let churn = 0;
  let runeTarget = 0;

  if (state === 'idle') {
    const ramp = Math.min(1, stateTime);
    ball.group.position.copy(IDLE_POS);
    ball.group.position.y += Math.sin(t * 1.6) * 0.08 * ramp;
    wobbleE.set(Math.sin(t * 0.9) * 0.08 * ramp, Math.sin(t * 0.6) * 0.12 * ramp, 0);
    ball.spinner.quaternion.copy(idleQuat).multiply(wobble.setFromEuler(wobbleE));
    energy = Math.max(0, energy - dt * 0.3);
    setHint(isTouch ? HINT_TOUCH : HINT_MOUSE);
    motionEl.classList.toggle('show', motionOffered && !motion.asked && stateTime > 0.5);
  } else if (state === 'hold') {
    motionEl.classList.remove('show');
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(dragPlane, tmp);
    if (hit) {
      holdTarget.copy(hit).add(grabOffset);
      holdTarget.y = Math.max(holdTarget.y, physics.restY(holdTarget.x, holdTarget.z) + 0.3);
      const d = Math.hypot(holdTarget.x, holdTarget.z);
      const lim = RIM_INNER - BALL_R - 0.1;
      if (d > lim) { holdTarget.x *= lim / d; holdTarget.z *= lim / d; }
    }
    prevPos.copy(ball.group.position);
    ball.group.position.lerp(holdTarget, 1 - Math.exp(-22 * dt));
    // the ball turns a little with the hand's motion
    const v = tmp.copy(ball.group.position).sub(prevPos);
    camera.getWorldDirection(camN).negate();
    const axis = new THREE.Vector3().crossVectors(camN, v);
    const len = axis.length();
    if (len > 1e-6) {
      dq.setFromAxisAngle(axis.divideScalar(len), (v.length() / BALL_R) * 0.6);
      ball.spinner.quaternion.premultiply(dq);
    }
    samples.push({ t: performance.now() / 1000, p: ball.group.position.clone() });
    while (samples.length && samples[0].t < performance.now() / 1000 - 0.25) samples.shift();

    energy = Math.max(0, energy - dt * 0.3);
    churn = energy;
    runeTarget = energy;
    setHint(energy > 0.55 ? 'The spirits stir — throw it!' : 'Shake it…');
  } else if (state === 'roll') {
    physics.step(dt, ball.spinner.quaternion);
    ball.group.position.copy(physics.pos);
    const sp = physics.speed;
    churn = Math.min(1, sp / 6);
    if (sp > 0.8) trail.spawn(physics.pos, sp > 4 ? 3 : 1);
    // at rest = slow, window up, and back on the flat middle (not pausing on the dish slope)
    const onFlat = tableHeight(Math.hypot(physics.pos.x, physics.pos.z)) < 0.1;
    if (physics.grounded && sp < 0.25 && onFlat && physics.windowUp(ball.spinner.quaternion) > 0.9) stillTime += dt;
    else stillTime = 0;
    if (stillTime > 0.5 || stateTime > 20) startReveal();
    energy = Math.max(0, energy - dt * 0.4);
    runeTarget = energy * 0.5 + churn * 0.4;
    setHint('');
  } else if (state === 'reveal') {
    // the ball keeps rocking on its weight while the die floats up
    physics.step(dt, ball.spinner.quaternion);
    ball.group.position.copy(physics.pos);
    const windowCenter = tmp.copy(ball.group.position);
    windowCenter.y += WINDOW_Y;
    const camUp = ball.answerUp(revealUp) ? revealUp : revealAway;
    director.setReveal(revealPos.copy(windowCenter).setY(windowCenter.y + 1.0), windowCenter, camUp);
    const res = ball.result;
    if (res.ready) readyTime += dt;
    if (readyTime > 0.5 && !answerShown) {
      answerShown = true;
      answer = res.answer;
      answerEl.textContent = answer.text.replace(/\n/g, ' ');
      answerEl.classList.add('show');
      againEl.classList.add('show');
    }
  } else if (state === 'hand') {
    // the window faces the camera; the whole ball fits the screen's narrower side
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const fit = Math.min(Math.tan(halfFov), Math.tan(halfFov) * camera.aspect);
    director.setReveal(handCam.copy(HAND_POS).setZ(HAND_POS.z + (BALL_R * 1.25) / fit), HAND_POS, UP);
    // the phone's jolts swing and tilt the ball a little
    motion.offset.multiplyScalar(Math.exp(-5 * dt));
    ball.group.position.copy(HAND_POS)
      .addScaledVector(camRight.setFromMatrixColumn(camera.matrixWorld, 0), motion.offset.x)
      .addScaledVector(camUpV.setFromMatrixColumn(camera.matrixWorld, 1), motion.offset.y);
    if (ball.answerUp(handUp)) {
      const off = Math.atan2(-handUp.x, handUp.y); // the answer's top, measured from screen-up
      handRoll -= off * (1 - Math.exp(-3 * dt));
    }
    handTiltE.set(-motion.offset.y * 0.8, 0, -motion.offset.x * 0.8);
    handRollQ.setFromAxisAngle(HAND_AXIS, handRoll);
    ball.spinner.quaternion.copy(handTilt.setFromEuler(handTiltE)).multiply(handRollQ).multiply(HAND_Q);
    energy = Math.max(0, energy - dt * 0.25);
    churn = energy;

    const shakes = Math.floor(motion.reversals / 2);
    const still = performance.now() - motion.lastJolt > 400;
    if (handPhase === 'shake') {
      if (shakes >= SHAKES_NEEDED && still) {
        ball.watch(true, UP); // the answer reads upright on screen
        handPhase = 'settle';
        energy = 0;
      }
      setHint(shakes === 0 ? 'Ask your question aloud… then shake your phone'
        : shakes < SHAKES_NEEDED ? 'Keep shaking…' : 'Now hold still…');
    } else if (handPhase === 'settle') {
      setHint('');
      if (ball.result.ready) readyTime += dt;
      if (readyTime > 0.5) {
        handPhase = 'answer';
        answerShown = true;
        answer = ball.result.answer;
        answerEl.textContent = answer.text.replace(/\n/g, ' ');
        answerEl.classList.add('show');
        againEl.classList.add('show');
      }
    } else {
      setHint(''); // the Ask again button sits here; shaking also asks again
    }
  } else if (state === 'return') {
    const k = Math.min(1, stateTime / 1.3);
    const e = easeInOutCubic(k);
    ball.group.position.lerpVectors(returnFrom, IDLE_POS, e);
    ball.group.position.y += Math.sin(Math.PI * k) * 1.2;
    ball.spinner.quaternion.slerpQuaternions(returnQuat, idleQuat, e);
    if (k >= 1) setState('idle');
  }

  runeEnergy += (runeTarget - runeEnergy) * (1 - Math.exp(-3 * dt));
  director.shake = state === 'hold' ? energy * 0.05 : 0;
  const closeUp = state === 'reveal' || state === 'hand';
  bloom.strength += ((closeUp ? 0.3 : 0.75) - bloom.strength) * (1 - Math.exp(-2 * dt));

  ball.update(dt, t, {
    churn, camera, down: state === 'hand' ? HAND_DOWN : undefined,
    calm: state === 'hand' && handPhase !== 'shake', pxScale: renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))),
  });
  trail.update(dt);
  set.update(t, dt, runeEnergy);
  director.update(dt, t, ball.group.position);
  composer.render();
  requestAnimationFrame(frame);
}

// compile every shader up front so the first throw doesn't hitch
await renderer.compileAsync(scene, camera).catch(() => {});
requestAnimationFrame(frame);
requestAnimationFrame(() => document.getElementById('loading').classList.add('done'));
