import * as THREE from 'three';
import { ANSWERS } from './answers.js';

export const BALL_R = 0.5;
const WIN_A = 0.5; // half-angle of the window opening (radians, from +Y)
export const WINDOW_Y = BALL_R * Math.cos(WIN_A); // underside of the window glass
const WIN_RADIUS = BALL_R * Math.sin(WIN_A);
const INNER_R = BALL_R * 0.98;
const DIE_R = 0.26;
const RELIEF = 0.006; // height of the raised triangle + lettering
const FACE_Y = WINDOW_Y - RELIEF - 0.0004; // a face's base plane when its lettering touches the glass

// Light crossing the dyed liquid, per unit of path: red dies first, blue survives.
const SIGMA = new THREE.Vector3(650, 460, 200);
const SCATTER = new THREE.Color().setRGB(0.003, 0.01, 0.05);

const G = 16;
const DOWN = new THREE.Vector3(0, -1, 0);
const DIE_BUOYANCY = 0.06; // (rho_liquid - rho_die) / rho_die: the die barely floats
const BUBBLE_BUOYANCY = 0.8;
const ABC_K = 9; // wavenumber of the swirl field

function capGeometry(radius, angle, bottom) {
  const g = new THREE.SphereGeometry(radius, 48, 10, 0, Math.PI * 2, bottom ? Math.PI - angle : 0, angle);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const s = radius * Math.sin(angle);
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / (2 * s) + 0.5, pos.getZ(i) / (2 * s) + 0.5);
  }
  return g;
}

// The "8" decal: a solid, slanted Chakra Petch numeral on the white circle,
// drawn from the font's outline so it never waits on a web font.
function eightTexture(eightFont) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#050507';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#f4f2ec';
  g.beginPath();
  g.arc(256, 256, 236, 0, Math.PI * 2);
  g.fill();
  const shapes = eightFont.generateShapes('8', 300);
  const box = new THREE.Box2();
  const polys = shapes.map((sh) => {
    const pts = sh.extractPoints(8);
    for (const p of pts.shape) box.expandByPoint(p);
    return [pts.shape, ...pts.holes];
  });
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  g.fillStyle = '#0b0b0d';
  g.beginPath();
  for (const rings of polys) {
    for (const ring of rings) {
      ring.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](256 + p.x - cx, 256 - (p.y - cy)));
      g.closePath();
    }
  }
  g.fill('evenodd');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// One die face's raised triangular plate with the words cut into it, as real geometry.
// Built in the face's own 2D frame: origin at the face centre, +y toward the apex.
function facePlateGeometry(font, text, faceR) {
  const A = faceR * 0.86; // plate apex height (circumradius of the plate)
  const base = -A / 2;
  const halfW = (y) => (A - y) * Math.tan(Math.PI / 6);

  // measure each line at size 1, then find the largest size that fits the plate
  const lines = text.split('\n');
  const unit = lines.map((l) => {
    const box = new THREE.Box2();
    for (const sh of font.generateShapes(l, 1)) for (const p of sh.getPoints(2)) box.expandByPoint(p);
    return { text: l, w: box.max.x - box.min.x, x0: box.min.x };
  });
  const n = lines.length;
  const capH = 0.72;
  const step = 1.08;
  const centre = -faceR * 0.1;
  let size = 0.06;
  let layout;
  for (; size > 0.004; size -= 0.0005) {
    const blockH = ((n - 1) * step + capH) * size;
    const top = centre + blockH / 2;
    if (top > A * 0.78 || top - blockH < base + faceR * 0.12) continue;
    layout = unit.map((u, i) => ({ ...u, baseline: top - capH * size - i * step * size }));
    if (layout.every((l) => l.w * size <= 2 * halfW(l.baseline + capH * size) * 0.82)) break;
  }

  const plate = new THREE.Shape();
  plate.moveTo(0, A);
  plate.lineTo(-halfW(base), base);
  plate.lineTo(halfW(base), base);
  plate.closePath();
  const islands = [];
  for (const l of layout) {
    const dx = -(l.w * size) / 2 - l.x0 * size;
    for (const sh of font.generateShapes(l.text, size)) {
      const pts = sh.extractPoints(4);
      const move = (arr) => arr.map((p) => new THREE.Vector2(p.x + dx, p.y + l.baseline));
      plate.holes.push(new THREE.Path(move(pts.shape))); // the letter is cut out of the plate
      for (const h of pts.holes) islands.push(new THREE.Shape(move(h))); // counters stay standing
    }
  }
  const bevel = 0.0005;
  const g = new THREE.ExtrudeGeometry([plate, ...islands], {
    depth: RELIEF - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8,
    bevelSegments: 1, curveSegments: 4,
  });
  g.translate(0, 0, bevel);
  return g;
}

const CUSTOM_FACE = 0; // the face that carries a custom message

const ABSORB_GLSL = /* glsl */ `
  uniform vec3 uCamLocal;
  uniform float uGlassY;
  uniform vec3 uSigma;
  // Beer-Lambert: transmittance of the liquid between a point and the glass, toward the eye
  vec3 liquidT(vec3 p) {
    vec3 dir = normalize(uCamLocal - p);
    float thick = dir.y > 0.05 ? max(uGlassY - p.y, 0.0) / dir.y : 1.0;
    return exp(-uSigma * thick);
  }
`;

const _sm = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createBall(font, eightFont) {
  const group = new THREE.Group();
  const spinner = new THREE.Group();
  group.add(spinner);

  const shell = new THREE.MeshPhysicalMaterial({
    color: '#030305', roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
  });
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 64, 48, 0, Math.PI * 2, WIN_A, Math.PI - WIN_A),
    shell,
  );
  body.castShadow = true;
  spinner.add(body);

  const eightTex = eightTexture(eightFont);
  const eight = new THREE.Mesh(
    capGeometry(BALL_R * 1.002, 0.55, true),
    new THREE.MeshPhysicalMaterial({
      map: eightTex, emissive: '#ffffff', emissiveMap: eightTex, emissiveIntensity: 0.35,
      roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05,
    }),
  );
  spinner.add(eight);

  // the liquid itself, seen where nothing else is in the way: fully absorbing depth
  const inner = new THREE.Mesh(
    new THREE.SphereGeometry(INNER_R, 48, 32),
    new THREE.MeshBasicMaterial({ color: SCATTER, side: THREE.BackSide }),
  );
  spinner.add(inner);

  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(WIN_RADIUS, 64),
    new THREE.MeshPhysicalMaterial({
      color: '#0b1640', transparent: true, opacity: 0.1, roughness: 0.05, clearcoat: 1,
      envMapIntensity: 0.35, depthWrite: false,
    }),
  );
  glass.rotation.x = -Math.PI / 2;
  glass.position.y = WINDOW_Y;
  glass.renderOrder = 3;
  spinner.add(glass);

  const bezel = new THREE.Mesh(
    new THREE.TorusGeometry(WIN_RADIUS, 0.012, 10, 72),
    new THREE.MeshPhysicalMaterial({ color: '#0c0c10', roughness: 0.3, clearcoat: 1 }),
  );
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = WINDOW_Y;
  spinner.add(bezel);

  // light coming in through the window, grazing whatever is pressed against it
  const rake = new THREE.PointLight('#e2eaff', 1.4, 1.4, 2);
  rake.position.set(0.12, WINDOW_Y + 0.3, -0.42);
  spinner.add(rake);

  const liquidUniforms = {
    uSpinnerInv: { value: new THREE.Matrix4() },
    uCamLocal: { value: new THREE.Vector3(0, 5, 0) },
    uGlassY: { value: WINDOW_Y },
    uSigma: { value: SIGMA },
    uScatter: { value: SCATTER },
    uRelief: { value: RELIEF },
  };

  // ---------- the die ----------

  const dieGeo = new THREE.IcosahedronGeometry(DIE_R, 0);
  const dpos = dieGeo.attributes.position;
  const faces = [];
  for (let i = 0; i < 20; i++) {
    const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(dpos, i * 3 + k));
    const c = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
    faces.push({ v, c, n: c.clone().normalize() });
  }
  const corners = [];
  for (let i = 0; i < dpos.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(dpos, i);
    if (!corners.some((q) => q.distanceToSquared(p) < 1e-8)) corners.push(p);
  }

  const dieMat = new THREE.MeshPhysicalMaterial({
    color: '#cdd6f6', roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.2,
  });
  dieMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, liquidUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform mat4 uSpinnerInv;
        varying vec3 vLocal;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vLocal = (uSpinnerInv * modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${ABSORB_GLSL}
        uniform vec3 uScatter;
        varying vec3 vLocal;`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          vec3 T = liquidT(vLocal);
          gl_FragColor.rgb = gl_FragColor.rgb * T + uScatter * (1.0 - T);
        }`);
  };
  const dieHolder = new THREE.Group();
  dieHolder.add(new THREE.Mesh(dieGeo, dieMat));

  // a raised plate on every face, words cut into it; plates[i].spin(k) turns the words
  // to read toward the face's vertex k (the plate is equilateral, so it maps onto itself)
  const faceR = faces[0].v[0].distanceTo(faces[0].c);
  const plates = faces.map((f, i) => {
    const mesh = new THREE.Mesh(facePlateGeometry(font, ANSWERS[i].text, faceR), dieMat);
    const up = f.v[0].clone().sub(f.c).normalize();
    const right = up.clone().cross(f.n);
    const baseQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, f.n));
    mesh.position.copy(f.c);
    const spin = (k) => {
      mesh.quaternion.copy(baseQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (k * 2 * Math.PI) / 3));
    };
    spin(0);
    dieHolder.add(mesh);
    return { mesh, spin };
  });
  spinner.add(dieHolder);

  // ---------- suspended specks and air bubbles ----------

  const N_SPECK = 150;
  const N_BUBBLE = 5;
  const N = N_SPECK + N_BUBBLE;
  const pPos = new Float32Array(N * 3);
  const pVel = new Float32Array(N * 3);
  const pSize = new Float32Array(N);
  const pKind = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * INNER_R * 0.9);
    pPos.set([v.x, v.y, v.z], i * 3);
    const bubble = i >= N_SPECK;
    pKind[i] = bubble ? 1 : 0;
    pSize[i] = bubble ? 0.012 + Math.random() * 0.016 : 0.003 + Math.random() * 0.004;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1));
  pGeo.setAttribute('aKind', new THREE.BufferAttribute(pKind, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...liquidUniforms, uPx: { value: 1000 } },
    vertexShader: /* glsl */ `
      ${ABSORB_GLSL}
      attribute float aSize;
      attribute float aKind;
      uniform float uPx;
      varying float vKind;
      varying vec3 vT;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, aSize * uPx / -mv.z);
        gl_Position = projectionMatrix * mv;
        vT = liquidT(position);
        vKind = aKind;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vKind;
      varying vec3 vT;
      void main() {
        vec2 pc = gl_PointCoord;
        float d = length(pc - 0.5);
        if (d > 0.5) discard;
        vec3 c;
        if (vKind > 0.5) {
          float rim = smoothstep(0.5, 0.4, d) * smoothstep(0.2, 0.42, d);
          float spec = smoothstep(0.13, 0.0, length(pc - vec2(0.37, 0.33)));
          c = vec3(0.55, 0.72, 1.0) * rim * 0.8 + vec3(1.0) * spec * 0.9;
        } else {
          c = vec3(0.5, 0.65, 1.0) * smoothstep(0.5, 0.0, d) * 0.45;
        }
        gl_FragColor = vec4(c * vT, 1.0);
      }
    `,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  particles.renderOrder = 2;
  spinner.add(particles);

  // ---------- fluid + die state ----------

  const dieP = new THREE.Vector3(0, 0, 0);
  const dieV = new THREE.Vector3();
  const dieQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
  const dieW = new THREE.Vector3();
  const fluidW = new THREE.Vector3(); // world angular velocity of the liquid body
  const ballW = new THREE.Vector3();
  const relW = new THREE.Vector3(); // liquid spin relative to the ball, ball-local
  const gLocal = new THREE.Vector3(); // apparent gravity inside the ball, ball-local
  const ballAcc = new THREE.Vector3();
  const prevSpin = new THREE.Quaternion();
  const prevPos = new THREE.Vector3();
  const prevVel = new THREE.Vector3();
  const spinInv = new THREE.Quaternion();
  let primed = false;
  let energy = 0.05; // strength of the swirl
  let forcedIndex = null;
  let customText = null;
  let watching = false;
  const awayWorld = new THREE.Vector3(0, 0, -1);
  let locked = null;
  let lockTop = 0;
  let ready = false;
  let contact = false;
  let lift = 1; // buoyancy boost while the liquid is calming (see update's `calm`)

  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _c = new THREE.Vector3();
  const _u = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _qi = new THREE.Quaternion();

  // divergence-free swirl (Arnold-Beltrami-Childress flow) whose curl is ABC_K times itself
  function swirl(x, y, z, t, out) {
    const k = ABC_K;
    const p1 = t * 0.7, p2 = t * 0.53 + 2.0, p3 = t * 0.61 + 4.0;
    return out.set(
      Math.sin(k * z + p1) + Math.cos(k * y + p3),
      Math.sin(k * x + p2) + Math.cos(k * z + p1),
      Math.sin(k * y + p3) + Math.cos(k * x + p2),
    );
  }

  // liquid velocity at a ball-local point
  function flow(x, y, z, t, out) {
    swirl(x, y, z, t, out).multiplyScalar(energy);
    return out.add(_c.crossVectors(relW, _b.set(x, y, z)));
  }

  function angVelFromDelta(qNow, qPrev, dt, out) {
    _q.copy(qNow).multiply(_qi.copy(qPrev).invert());
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
    const ang = 2 * Math.acos(Math.min(1, _q.w));
    if (s < 1e-6 || dt <= 0) return out.set(0, 0, 0);
    return out.set(_q.x, _q.y, _q.z).multiplyScalar(ang / (s * dt));
  }

  function integrate(q, w, h) {
    const a = w.length();
    if (a < 1e-7) return;
    _q.setFromAxisAngle(_a.copy(w).divideScalar(a), a * h);
    q.premultiply(_q).normalize();
  }

  // turn the die so face normal n (die space) points along `to`, with spring gain k
  function torqueToward(n, to, k, h) {
    _a.copy(n).applyQuaternion(dieQ);
    _b.crossVectors(_a, to);
    const s = _b.length();
    if (s < 1e-6) return;
    const ang = Math.atan2(s, _a.dot(to));
    dieW.addScaledVector(_b.divideScalar(s), ang * k * h);
  }

  function mostUpFace() {
    let best = 0;
    let bestY = -2;
    for (let i = 0; i < 20; i++) {
      const y = _a.copy(faces[i].n).applyQuaternion(dieQ).y;
      if (y > bestY) { bestY = y; best = i; }
    }
    return best;
  }

  function stepDie(h, t) {
    // drift with the liquid, plus buoyancy against apparent gravity
    flow(dieP.x, dieP.y, dieP.z, t, _u);
    dieV.addScaledVector(_u.sub(dieV), 5 * h).addScaledVector(gLocal, -DIE_BUOYANCY * lift * h);
    dieP.addScaledVector(dieV, h);

    // spin with the liquid's rotation and local vorticity
    swirl(dieP.x, dieP.y, dieP.z, t, _u).multiplyScalar(0.5 * ABC_K * energy).add(relW);
    dieW.addScaledVector(_u.sub(dieW), 2.5 * h);

    // walls: the shell, then the tube that funnels the die to the window
    const maxR = INNER_R - DIE_R * 0.93;
    if (dieP.length() > maxR) {
      dieP.setLength(maxR);
      _a.copy(dieP).normalize();
      const vn = dieV.dot(_a);
      if (vn > 0) dieV.addScaledVector(_a, -vn);
    }
    const tube = THREE.MathUtils.lerp(0.25, 0.015, _sm(0.02, 0.2, dieP.y));
    const rxz = Math.hypot(dieP.x, dieP.z);
    if (rxz > tube) {
      dieP.x *= tube / rxz;
      dieP.z *= tube / rxz;
      const vr = (dieV.x * dieP.x + dieV.z * dieP.z) / Math.max(1e-6, tube);
      if (vr > 0) { dieV.x -= (dieP.x / tube) * vr; dieV.z -= (dieP.z / tube) * vr; }
    }

    // the glass: highest corner of the die can't pass the face plane
    let sup = -1;
    for (const c of corners) sup = Math.max(sup, _a.copy(c).applyQuaternion(dieQ).y);
    contact = dieP.y + sup >= FACE_Y - 0.0005;
    if (dieP.y + sup > FACE_Y) {
      dieP.y = FACE_Y - sup;
      if (dieV.y > 0) dieV.y = 0;
    }

    const up = _c.copy(gLocal).negate().normalize();
    if (contact) {
      // pressed on the glass, the die rocks until a face lies flat against it
      const face = locked ?? (forcedIndex ?? mostUpFace());
      torqueToward(faces[face].n, _b.set(0, 1, 0).clone(), 40, h);
      dieW.multiplyScalar(Math.exp(-5 * h));
      dieV.x *= Math.exp(-3 * h);
      dieV.z *= Math.exp(-3 * h);
    } else if (forcedIndex !== null) {
      // hidden in the dark liquid, the chosen face is nudged to point the way it floats
      torqueToward(faces[forcedIndex].n, up.clone(), 6, h);
    }
    integrate(dieQ, dieW, h);
  }

  function stepParticles(h, t) {
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      const bubble = pKind[i] > 0.5;
      flow(pPos[j], pPos[j + 1], pPos[j + 2], t, _u);
      const drag = bubble ? 6 : 8;
      pVel[j] += (_u.x - pVel[j]) * drag * h;
      pVel[j + 1] += (_u.y - pVel[j + 1]) * drag * h;
      pVel[j + 2] += (_u.z - pVel[j + 2]) * drag * h;
      if (bubble) {
        pVel[j] -= gLocal.x * BUBBLE_BUOYANCY * h;
        pVel[j + 1] -= gLocal.y * BUBBLE_BUOYANCY * h;
        pVel[j + 2] -= gLocal.z * BUBBLE_BUOYANCY * h;
      }
      _a.set(pPos[j] + pVel[j] * h, pPos[j + 1] + pVel[j + 1] * h, pPos[j + 2] + pVel[j + 2] * h);

      // keep out of the die
      _b.copy(_a).sub(dieP);
      const dd = _b.length();
      const rDie = DIE_R * 0.92;
      if (dd < rDie) _a.copy(dieP).addScaledVector(_b, rDie / Math.max(dd, 1e-5));
      // inside the shell, under the glass
      const lim = INNER_R - (bubble ? 0.012 : 0.004);
      if (_a.length() > lim) _a.setLength(lim);
      const top = WINDOW_Y - (bubble ? pSize[i] * 0.4 : 0.002);
      if (_a.y > top) { _a.y = top; if (pVel[j + 1] > 0) pVel[j + 1] = 0; }
      pPos[j] = _a.x; pPos[j + 1] = _a.y; pPos[j + 2] = _a.z;
    }
    pGeo.attributes.position.needsUpdate = true;
  }

  return {
    group,
    spinner,

    setEnvMap(tex) {
      for (const m of [shell, eight.material, bezel.material, glass.material]) m.envMap = tex;
    },

    // answer to land on (index into ANSWERS), or null for a fair roll
    setForced(index) {
      forcedIndex = index;
    },

    // Re-cut one face with a custom message (null restores it); returns that face's index.
    setCustom(text) {
      const plate = plates[CUSTOM_FACE];
      const next = text
        ? facePlateGeometry(font, [...text].filter((ch) => ch === '\n' || ch === ' ' || font.data.glyphs[ch]).join(''), faceR)
        : facePlateGeometry(font, ANSWERS[CUSTOM_FACE].text, faceR);
      plate.mesh.geometry.dispose();
      plate.mesh.geometry = next;
      customText = text || null;
      return CUSTOM_FACE;
    },

    // While watching, the face that settles against the glass becomes the answer.
    // `away` is the horizontal direction from the viewer to the ball (words read upright).
    watch(on, away) {
      watching = on;
      if (away) awayWorld.copy(away);
      if (!on) { locked = null; ready = false; }
    },

    get result() {
      if (locked === null) return { answer: null, ready };
      const answer = locked === CUSTOM_FACE && customText ? { text: customText, kind: 'custom' } : ANSWERS[locked];
      return { answer, ready };
    },

    // world direction of the answer's apex (for the camera's up), false until locked
    answerUp(out) {
      if (locked === null) return false;
      const f = faces[locked];
      out.copy(f.v[lockTop]).sub(f.c).applyQuaternion(dieQ).applyQuaternion(spinner.quaternion);
      return true;
    },

    // `down`: world direction of gravity for the liquid. Held in the hand with the window
    // facing the viewer, gravity points into the ball so the die floats to the glass.
    // `calm`: the liquid stills quickly and the die rises briskly (held still in the hand).
    update(dt, t, { churn = 0, camera = null, pxScale = 1000, down = DOWN, calm = false } = {}) {
      if (dt <= 0) return;

      // how the ball itself is moving
      angVelFromDelta(spinner.quaternion, prevSpin, dt, ballW);
      prevSpin.copy(spinner.quaternion);
      const vNow = _a.copy(group.position).sub(prevPos).divideScalar(dt);
      if (primed) ballAcc.lerp(_b.copy(vNow).sub(prevVel).divideScalar(dt), 0.35);
      if (ballAcc.length() > 80) ballAcc.setLength(80);
      prevVel.copy(vNow);
      prevPos.copy(group.position);
      primed = true;

      // the liquid body lags the ball's spin, then catches up through viscosity
      fluidW.lerp(ballW, 1 - Math.exp(-1.0 * dt));
      spinInv.copy(spinner.quaternion).invert();
      relW.copy(fluidW).sub(ballW).applyQuaternion(spinInv);
      gLocal.copy(down).multiplyScalar(G).sub(ballAcc).applyQuaternion(spinInv);

      // stirring: shaking, jolts and spin-up feed the swirl; viscosity bleeds it away
      lift = calm ? 5 : 1;
      energy = energy * Math.exp((calm ? -4 : -0.5) * dt)
        + dt * (churn * 1.5 + Math.min(ballAcc.length(), 60) * 0.006 + Math.min(relW.length(), 20) * 0.01);
      energy = THREE.MathUtils.clamp(energy, 0.015, 0.6);

      const n = 3;
      const h = dt / n;
      for (let i = 0; i < n; i++) stepDie(h, t);
      stepParticles(dt, t);
      dieHolder.position.copy(dieP);
      dieHolder.quaternion.copy(dieQ);

      // reading the answer
      if (watching && locked === null && contact) {
        const face = forcedIndex ?? mostUpFace();
        if (_a.copy(faces[face].n).applyQuaternion(dieQ).y > 0.9) {
          locked = face;
          const want = _b.copy(awayWorld).applyQuaternion(spinInv);
          let best = -2;
          for (let k = 0; k < 3; k++) {
            const d = _c.copy(faces[face].v[k]).sub(faces[face].c).normalize().applyQuaternion(dieQ).dot(want);
            if (d > best) { best = d; lockTop = k; }
          }
          plates[face].spin(lockTop);
        }
      }
      ready = locked !== null && contact
        && _a.copy(faces[locked].n).applyQuaternion(dieQ).y > 0.996
        && dieV.length() < 0.02 && dieW.length() < 0.25;

      // shader inputs
      spinner.updateWorldMatrix(true, false);
      liquidUniforms.uSpinnerInv.value.copy(spinner.matrixWorld).invert();
      if (camera) liquidUniforms.uCamLocal.value.copy(camera.position).applyMatrix4(liquidUniforms.uSpinnerInv.value);
      pMat.uniforms.uPx.value = pxScale;
    },
  };
}
