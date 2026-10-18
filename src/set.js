import * as THREE from 'three';

export const TABLE_R = 6.6;
export const RIM_R = 6.15;
const RIM_TUBE = 0.15;
export const RIM_INNER = RIM_R - RIM_TUBE;

const GOLD = '#e2bd6a';

// The table is a shallow dish: flat in the middle, sloping up toward the rim, so a
// thrown ball always rolls back toward the centre. The slope starts steep enough
// (0.15) that the bottom-weighted ball can't climb or sit on it.
const FLAT_R = 2.4;
export function tableHeight(d) {
  const u = Math.max(0, Math.min(d, RIM_R) - FLAT_R);
  return 0.15 * u + 0.03 * u * u;
}
// d(height)/d(distance from centre)
export function tableSlope(d) {
  if (d <= FLAT_R || d >= RIM_R) return 0;
  return 0.15 + 0.06 * (d - FLAT_R);
}
export const EDGE_H = tableHeight(RIM_R);

// lift a flat disc geometry (in its XY plane, rotated -90° about X later) onto the dish
function dish(geo, lift = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, tableHeight(Math.hypot(p.getX(i), p.getY(i))) + lift);
  geo.computeVertexNormals();
  return geo;
}

function spriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------- sky ----------

const NOISE_GLSL = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        float n = fbm(d * 2.4 + vec3(0.0, uTime * 0.01, 0.0));
        float n2 = fbm(d * 4.5 + n * 1.6);
        vec3 col = vec3(0.012, 0.004, 0.03);
        col += vec3(0.36, 0.07, 0.48) * pow(n2, 3.0) * 1.7;
        col += vec3(0.04, 0.30, 0.42) * pow(fbm(d * 3.1 + 7.0), 4.0) * 1.6;
        col += vec3(0.5, 0.15, 0.35) * pow(fbm(d * 1.7 - 3.0), 6.0) * 1.5;
        // stars
        vec3 sp = d * 230.0;
        vec3 id = floor(sp);
        vec3 fr = fract(sp) - 0.5;
        float h = hash(id);
        float star = step(0.986, h) * smoothstep(0.35, 0.0, length(fr));
        star *= 0.55 + 0.45 * sin(uTime * 2.0 + h * 120.0);
        col += vec3(0.9, 0.9, 1.0) * star * 1.6;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 64, 32), mat);
  sky.renderOrder = -1;
  return { sky, mat };
}

// ---------- rune circle ----------

function buildRunes() {
  const R = 3.6;
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uEnergy: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uEnergy;
      varying vec2 vUv;
      #define PI 3.14159265
      float h1(float n) { return fract(sin(n) * 43758.5453); }
      float seg(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }
      vec2 pt(float i) { return vec2(0.2 + 0.3 * mod(i, 3.0), 0.18 + 0.32 * floor(i / 3.0)); }
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * ${R.toFixed(2)};
        float r = length(p);
        float ang = atan(p.y, p.x);
        float glow = 0.0;

        glow += smoothstep(0.035, 0.0, abs(r - 3.42));
        glow += smoothstep(0.022, 0.0, abs(r - 2.72));
        glow += smoothstep(0.018, 0.0, abs(r - 2.58)) * 0.7;
        glow += smoothstep(0.018, 0.0, abs(r - 1.05)) * 0.6;

        // glyph band
        float a2 = ang + uTime * 0.05;
        float cells = 28.0;
        float u = (a2 + PI) / (2.0 * PI) * cells;
        float ci = mod(floor(u), cells);
        vec2 g = vec2(fract(u), (r - 2.8) / 0.54);
        if (g.y > 0.0 && g.y < 1.0) {
          float d = 1.0;
          for (int k = 0; k < 4; k++) {
            float fk = float(k);
            float ia = floor(h1(ci * 7.13 + fk * 1.37) * 9.0);
            float ib = floor(h1(ci * 3.71 + fk * 2.93 + 5.0) * 9.0);
            d = min(d, seg(g, pt(ia), pt(ib)));
          }
          glow += smoothstep(0.07, 0.0, d) * 0.9;
        }

        // pentagram, counter-rotating
        float d = 1.0;
        float rot = -uTime * 0.08;
        for (int i = 0; i < 5; i++) {
          float fi = float(i);
          float t0 = rot + fi * 2.0 * PI / 5.0 + PI * 0.5;
          float t1 = rot + (fi + 2.0) * 2.0 * PI / 5.0 + PI * 0.5;
          d = min(d, seg(p, 2.55 * vec2(cos(t0), sin(t0)), 2.55 * vec2(cos(t1), sin(t1))));
        }
        glow += smoothstep(0.03, 0.0, d) * 0.75;

        float pulse = 0.75 + 0.25 * sin(uTime * 1.5) + uEnergy * 1.8;
        vec3 col = mix(vec3(1.0, 0.68, 0.28), vec3(0.62, 0.42, 1.0), clamp(uEnergy, 0.0, 1.0));
        vec3 outc = col * glow * pulse * 1.6;
        outc += vec3(0.25, 0.08, 0.45) * smoothstep(3.6, 0.0, r) * (0.06 + uEnergy * 0.12);
        gl_FragColor = vec4(outc, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(dish(new THREE.RingGeometry(0, R, 96, 40), 0.012), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  return { mesh, mat };
}

// ---------- tarot cards ----------

function drawSymbol(g, kind) {
  g.fillStyle = GOLD;
  g.strokeStyle = GOLD;
  g.lineWidth = 4;
  if (kind === 'sun') {
    g.beginPath(); g.arc(0, 0, 38, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const l = i % 2 ? 62 : 78;
      g.beginPath(); g.moveTo(Math.cos(a) * 48, Math.sin(a) * 48); g.lineTo(Math.cos(a) * l, Math.sin(a) * l); g.stroke();
    }
  } else if (kind === 'moon') {
    g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#120a2a';
    g.beginPath(); g.arc(24, -14, 52, 0, Math.PI * 2); g.fill();
  } else if (kind === 'star') {
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 22 : i % 4 ? 52 : 78;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  } else if (kind === 'eye') {
    g.beginPath();
    g.moveTo(-75, 0); g.quadraticCurveTo(0, -70, 75, 0); g.quadraticCurveTo(0, 70, -75, 0);
    g.stroke();
    g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#120a2a';
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fill();
  } else {
    g.beginPath(); g.arc(0, 0, 66, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, 18, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath(); g.moveTo(Math.cos(a) * 18, Math.sin(a) * 18); g.lineTo(Math.cos(a) * 66, Math.sin(a) * 66); g.stroke();
    }
  }
}

function cardTexture(kind, title) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 420;
  const g = c.getContext('2d');
  g.fillStyle = '#120a2a';
  g.fillRect(0, 0, 256, 420);
  g.strokeStyle = GOLD;
  g.lineWidth = 6; g.strokeRect(10, 10, 236, 400);
  g.lineWidth = 2; g.strokeRect(22, 22, 212, 376);
  g.save(); g.translate(128, 185); drawSymbol(g, kind); g.restore();
  const label = () => {
    g.fillStyle = '#120a2a';
    g.fillRect(30, 345, 196, 34);
    g.fillStyle = GOLD;
    g.font = '700 22px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.fillText(title, 128, 368);
  };
  label();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // the scene doesn't wait for web fonts: relabel once Cinzel arrives
  document.fonts.load('700 22px Cinzel').then(() => { label(); t.needsUpdate = true; }).catch(() => {});
  return t;
}

function cardBackTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 420;
  const g = c.getContext('2d');
  g.fillStyle = '#2a0c3e';
  g.fillRect(0, 0, 256, 420);
  g.strokeStyle = 'rgba(226,189,106,0.45)';
  g.lineWidth = 1.5;
  for (let i = -420; i < 420; i += 24) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 420, 420); g.stroke();
    g.beginPath(); g.moveTo(i + 420, 0); g.lineTo(i, 420); g.stroke();
  }
  g.strokeStyle = GOLD; g.lineWidth = 6; g.strokeRect(10, 10, 236, 400);
  g.save(); g.translate(128, 210); g.scale(0.7, 0.7); drawSymbol(g, 'star'); g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- sparkle trail ----------

export function createTrail(scene, pixelRatio) {
  const N = 320;
  const positions = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const vel = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: 0.2 * pixelRatio } },
    vertexShader: /* glsl */ `
      attribute float aLife;
      uniform float uSize;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * aLife * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 c = mix(vec3(0.55, 0.35, 1.0), vec3(1.0, 0.85, 0.5), vLife);
        gl_FragColor = vec4(c * a * vLife * 2.5, 1.0);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let head = 0;

  return {
    spawn(p, count) {
      for (let k = 0; k < count; k++) {
        const i = head;
        head = (head + 1) % N;
        positions[i * 3] = p.x + (Math.random() - 0.5) * 0.5;
        positions[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.5;
        positions[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.5;
        vel[i * 3] = (Math.random() - 0.5) * 0.3;
        vel[i * 3 + 1] = 0.3 + Math.random() * 0.5;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        life[i] = 1;
      }
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] = Math.max(0, life[i] - dt * 0.9);
        positions[i * 3] += vel[i * 3] * dt;
        positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
        positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
    },
  };
}

// ---------- the set ----------

// `lite` (phones): skip the floating scenery (island, rocks, candles, tarot cards, motes)
// to load and draw faster; one warm light stands in for the candles.
export function buildSet(scene, { lite = false } = {}) {
  const updaters = [];
  const sprite = spriteTexture();

  const { sky, mat: skyMat } = buildSky();
  scene.add(sky);
  updaters.push((t) => { skyMat.uniforms.uTime.value = t; });

  // lights
  scene.add(new THREE.HemisphereLight('#5a6cff', '#2a0a3a', 0.6));
  const moon = new THREE.DirectionalLight('#8fb4ff', 0.7);
  moon.position.set(-8, 12, -6);
  scene.add(moon);
  const spot = new THREE.SpotLight('#ffd9a8', 140, 30, 0.62, 0.6, 2);
  spot.position.set(0, 10, 2);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0004;
  spot.shadow.camera.near = 4;
  spot.shadow.camera.far = 20;
  scene.add(spot, spot.target);

  // everything but the sky and lights, so it can all be hidden at once (handheld mode)
  const props = new THREE.Group();
  scene.add(props);

  // table
  const velvet = new THREE.Mesh(
    dish(new THREE.RingGeometry(0, TABLE_R, 128, 64)),
    new THREE.MeshPhysicalMaterial({
      color: '#2b0d3f', roughness: 1, sheen: 0.6, sheenColor: '#b07cff', sheenRoughness: 0.8,
    }),
  );
  velvet.rotation.x = -Math.PI / 2;
  velvet.receiveShadow = true;
  props.add(velvet);

  const wood = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_R, TABLE_R - 0.1, 0.4 + EDGE_H, 128, 1, true),
    new THREE.MeshStandardMaterial({ color: '#3a1f14', roughness: 0.55, metalness: 0.1 }),
  );
  wood.position.y = (EDGE_H - 0.4) / 2;
  props.add(wood);

  const brass = new THREE.MeshStandardMaterial({ color: '#c8a24a', metalness: 1, roughness: 0.28 });
  const trim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.05, 8, 160), brass);
  trim.rotation.x = Math.PI / 2;
  trim.position.y = EDGE_H;
  props.add(trim);
  const trim2 = trim.clone();
  trim2.position.y = -0.4;
  props.add(trim2);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, RIM_TUBE, 18, 160), brass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = EDGE_H + RIM_TUBE;
  rim.castShadow = true;
  rim.receiveShadow = true;
  props.add(rim);

  const runes = buildRunes();
  props.add(runes.mesh);
  updaters.push((t, dt, e) => {
    runes.mat.uniforms.uTime.value = t;
    runes.mat.uniforms.uEnergy.value = e;
  });

  const stone = new THREE.MeshStandardMaterial({ color: '#2a2236', roughness: 1, flatShading: true });
  if (!lite) {
    // floating island beneath the table
    const islandGeo = new THREE.ConeGeometry(TABLE_R - 0.2, 5, 18, 5);
    {
      const p = islandGeo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        if (v.y < -2.49) continue; // keep the flat top ring (base before flipping)
        const s = Math.sin(v.x * 3.1 + v.y * 1.7) * Math.cos(v.z * 2.3 - v.y) * 0.5 + 0.5;
        const k = 0.82 + s * 0.3;
        p.setXYZ(i, v.x * k, v.y + (s - 0.5) * 0.4, v.z * k);
      }
      islandGeo.computeVertexNormals();
    }
    const island = new THREE.Mesh(islandGeo, stone);
    island.rotation.x = Math.PI;
    island.position.y = -2.9;
    props.add(island);
  }

  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: '#9a5cff', emissive: '#5a1fbf', emissiveIntensity: 0.7, roughness: 0.15, clearcoat: 1, flatShading: true,
  });
  const crystalGeo = new THREE.OctahedronGeometry(0.12, 0);
  const cluster = (scale = 1) => {
    const grp = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(crystalGeo, crystalMat);
      const sy = 1.2 + Math.random() * 2.6;
      m.scale.set(scale, sy * scale, scale);
      m.position.set((Math.random() - 0.5) * 0.25 * scale, sy * 0.07 * scale, (Math.random() - 0.5) * 0.25 * scale);
      m.rotation.set((Math.random() - 0.5) * 0.9, Math.random() * 3, (Math.random() - 0.5) * 0.9);
      m.castShadow = true;
      grp.add(m);
    }
    return grp;
  };
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const c = cluster(0.9 + Math.random() * 0.4);
    c.position.set(Math.cos(a) * 6.45, EDGE_H, Math.sin(a) * 6.45);
    props.add(c);
  }
  for (let i = 0; !lite && i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = cluster(1.6);
    c.rotation.x = Math.PI;
    c.position.set(Math.cos(a) * 1.2, -5.2 + Math.random() * 0.8, Math.sin(a) * 1.2);
    props.add(c);
  }
  updaters.push((t, dt, e) => { crystalMat.emissiveIntensity = 0.6 + 0.25 * Math.sin(t * 1.3) + e * 1.2; });

  if (lite) {
    const warm = new THREE.PointLight('#ff9c4a', 14, 26, 1.4);
    warm.position.set(-6, 4, 6);
    scene.add(warm);
  } else {
    // drifting rocks
    for (let i = 0; i < 12; i++) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 + Math.random() * 0.7, 0), stone);
      const a = Math.random() * Math.PI * 2;
      const rr = 10 + Math.random() * 6;
      const y0 = -3 + Math.random() * 4;
      const spd = 0.02 + Math.random() * 0.03;
      updaters.push((t) => {
        const aa = a + t * spd;
        rock.position.set(Math.cos(aa) * rr, y0 + Math.sin(t * 0.4 + a) * 0.3, Math.sin(aa) * rr);
        rock.rotation.set(t * spd * 3, t * spd * 2, 0);
      });
      props.add(rock);
    }

    // floating candles
    const wax = new THREE.MeshStandardMaterial({ color: '#efe1c6', roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const h = 0.45 + Math.random() * 0.45;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, h, 16), wax);
      g.add(body);
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 12, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.7) }),
      );
      flame.scale.set(1, 2.2, 1);
      flame.position.y = h / 2 + 0.1;
      g.add(flame);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: sprite, color: '#ff9a40', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.scale.setScalar(0.8);
      halo.position.copy(flame.position);
      g.add(halo);
      const light = new THREE.PointLight('#ff9c4a', 3, 9, 2);
      light.position.copy(flame.position);
      g.add(light);

      const a = (i / 6) * Math.PI * 2 + 0.3;
      const rr = 10.5 + (i % 2) * 0.8;
      const y0 = 1.3 + (i % 3) * 0.6;
      const seed = Math.random() * 100;
      updaters.push((t) => {
        g.position.set(Math.cos(a + t * 0.03) * rr, y0 + Math.sin(t * 0.8 + seed) * 0.15, Math.sin(a + t * 0.03) * rr);
        const f = 0.82 + 0.1 * Math.sin(t * 13 + seed) + 0.08 * Math.sin(t * 29 + seed * 2);
        light.intensity = 3 * f;
        flame.scale.set(1, 2.2 * f, 1);
        halo.material.opacity = 0.5 * f;
      });
      props.add(g);
    }

    // tarot cards orbiting the table
    const cards = [['sun', 'THE SUN'], ['moon', 'THE MOON'], ['star', 'THE STAR'], ['eye', 'THE HERMIT'], ['wheel', 'FORTUNE']];
    const backTex = cardBackTexture();
    const cardGeo = new THREE.PlaneGeometry(1, 1.64);
    cards.forEach(([kind, title], i) => {
      const tex = cardTexture(kind, title);
      const g = new THREE.Group();
      const front = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({
        map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.6,
      }));
      const back = new THREE.Mesh(cardGeo, new THREE.MeshStandardMaterial({
        map: backTex, emissive: '#ffffff', emissiveMap: backTex, emissiveIntensity: 0.25, roughness: 0.6,
      }));
      back.rotation.y = Math.PI;
      g.add(front, back);
      const a = (i / cards.length) * Math.PI * 2 + 1.0;
      const rr = 9.6 + (i % 2) * 1.4;
      const y0 = 2.4 + (i % 3) * 0.9;
      const seed = Math.random() * 10;
      updaters.push((t) => {
        const aa = a + t * 0.025;
        g.position.set(Math.cos(aa) * rr, y0 + Math.sin(t * 0.5 + seed) * 0.25, Math.sin(aa) * rr);
        g.lookAt(0, g.position.y, 0);
        g.rotateZ(Math.sin(t * 0.4 + seed) * 0.15);
        g.rotateY(Math.sin(t * 0.3 + seed) * 0.3);
      });
      props.add(g);
    });

    // drifting motes
    {
      const N = 900;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 1 + Math.random() * 16;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = -6 + Math.random() * 16;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const motes = new THREE.Points(geo, new THREE.PointsMaterial({
        map: sprite, color: '#c9a8ff', size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      props.add(motes);
      updaters.push((t, dt) => {
        for (let i = 0; i < N; i++) {
          pos[i * 3 + 1] += dt * (0.08 + (i % 7) * 0.02);
          if (pos[i * 3 + 1] > 10) pos[i * 3 + 1] = -6;
        }
        geo.attributes.position.needsUpdate = true;
        motes.rotation.y += dt * 0.01;
      });
    }
  }

  return {
    // hide or show everything but the sky
    showProps(on) {
      props.visible = on;
    },
    update(t, dt, energy) {
      for (const f of updaters) f(t, dt, energy);
    },
  };
}
