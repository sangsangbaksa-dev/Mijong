/* 3D 맵 렌더러 (three.js). 맵·지형·캠프·자원은 3D, 사람과 몬스터는 Canva 2D 스프라이트(빌보드).
   게임 로직 좌표(px)를 40px = 1m 로 바꿔 그린다. 화면 위 숫자와 화살표, 미니맵은 2D 오버레이 캔버스에 그린다. */
import * as THREE from './vendor/three.module.min.js';
import { PHASES, MONSTERS, GROUND, TORCH, lerpPhase, applyPhase } from './design/theme3d.js';

const M = 1 / 40;

export async function createRenderer({ canvas, overlay, MAP, CAMP, low }) {
  const W = MAP * M, CX = CAMP.x * M, CZ = CAMP.y * M;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(low ? 1.5 : 2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
  const octx = overlay.getContext('2d');

  /* ---------- 텍스처 ---------- */
  const loader = new THREE.TextureLoader();
  const loadTex = url => new Promise(res => loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));
  async function svgTex(name, size = 256) {
    const img = new Image(); img.src = `design/icons/${name}.svg`;
    try { await img.decode(); } catch (e) { return null; }
    const c = document.createElement('canvas'); c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function radialTex(stops, size = 128) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }
  const monTex = {};
  const [grass, ...rest] = await Promise.all([
    loadTex(GROUND.img),
    ...Object.entries(MONSTERS).map(([k, v]) => loadTex(v.img).then(t => (monTex[k] = t))),
  ]);
  const iconNames = ['player', 'ui-coin', 'res-scrap', 'res-crystal', 'gun-pistol', 'gun-smg', 'gun-shotgun', 'gun-rifle', 'gun-sniper', 'gun-minigun', 'gun-laser'];
  const icons = {};
  await Promise.all(iconNames.map(n => svgTex(n).then(t => (icons[n] = t))));
  const shadowTex = radialTex([[0, 'rgba(0,0,0,.55)'], [0.6, 'rgba(0,0,0,.25)'], [1, 'rgba(0,0,0,0)']]);
  const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]);

  /* ---------- 빛 ---------- */
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a3a, 0.6); scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.5); scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff1d0, 2.2);
  sun.castShadow = !low;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const torch = new THREE.SpotLight(TORCH.color, 0, TORCH.distance, TORCH.angle, TORCH.penumbra, 1.2);
  scene.add(torch, torch.target);
  const aura = new THREE.PointLight(0xffe2a8, 0, 9, 1.5); scene.add(aura);
  const fire = new THREE.PointLight(0xff8a3a, 3, 20, 1.4); fire.position.set(CX, 1.2, CZ); scene.add(fire);
  const muzzle = new THREE.PointLight(0xffd060, 0, 10, 1.5); scene.add(muzzle);
  const bossLight = new THREE.PointLight(0xff3a3a, 0, 16, 1.5); scene.add(bossLight);
  const lampLights = [];
  for (let i = 0; i < 5; i++) { const l = new THREE.PointLight(0xfff0c0, 0, 22, 1.3); scene.add(l); lampLights.push(l); }
  const lights = { sun, ambient, hemi, torch };

  /* ---------- 지형 ---------- */
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
  if (grass) { grass.wrapS = grass.wrapT = THREE.RepeatWrapping; grass.repeat.set((W + 120) / GROUND.metersPerTile, (W + 120) / GROUND.metersPerTile); grass.anisotropy = 8; }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 120, W + 120), mat(0xffffff, { map: grass, color: grass ? 0xffffff : 0x3a5a2c }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, W / 2); ground.receiveShadow = true; scene.add(ground);
  // 캠프 흙바닥
  const dirtTex = radialTex([[0, 'rgba(120,92,58,1)'], [0.55, 'rgba(110,84,52,.9)'], [1, 'rgba(110,84,52,0)']], 256);
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ map: dirtTex, transparent: true, roughness: 1, depthWrite: false }));
  dirt.rotation.x = -Math.PI / 2; dirt.position.set(CX, 0.02, CZ); dirt.receiveShadow = true; scene.add(dirt);
  // 맵 경계 밖은 어두운 숲, 맵 안에도 드문드문 나무와 바위
  const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const treeSpots = [];
  for (let i = 0; i < 520; i++) {
    const side = Math.floor(rnd() * 4), t = rnd() * (W + 40) - 20, depth = rnd() * 18 + 1;
    const p = side === 0 ? [t, -depth] : side === 1 ? [t, W + depth] : side === 2 ? [-depth, t] : [W + depth, t];
    treeSpots.push([p[0], p[1], 0.8 + rnd() * 0.9]);
  }
  for (let i = 0; i < 140; i++) {
    const x = rnd() * W, z = rnd() * W;
    if (Math.hypot(x - CX, z - CZ) < 14) continue;
    treeSpots.push([x, z, 0.6 + rnd() * 0.7]);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6); trunkGeo.translate(0, 0.8, 0);
  const crownGeo = new THREE.ConeGeometry(1.4, 3.6, 7); crownGeo.translate(0, 3.1, 0);
  const crown2Geo = new THREE.ConeGeometry(1.0, 2.6, 7); crown2Geo.translate(0, 4.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x5a3a1e), treeSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, mat(0x2f5a2e), treeSpots.length);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, mat(0x3f6b3a), treeSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  treeSpots.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6); m4.compose(v3.set(x, 0, z), q, sc.set(s, s * (0.9 + rnd() * 0.3), s));
    trunks.setMatrixAt(i, m4); crowns.setMatrixAt(i, m4); crowns2.setMatrixAt(i, m4);
    const tint = new THREE.Color().setHSL(0.27 + rnd() * 0.06, 0.38, 0.22 + rnd() * 0.08);
    crowns.setColorAt(i, tint); crowns2.setColorAt(i, tint.clone().offsetHSL(0, 0, 0.06));
  });
  for (const im of [trunks, crowns, crowns2]) { im.castShadow = !low; im.receiveShadow = true; scene.add(im); }
  const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, mat(0x6b6f66, { flatShading: true }), 120);
  for (let i = 0; i < 120; i++) {
    let x = rnd() * W, z = rnd() * W; if (Math.hypot(x - CX, z - CZ) < 10) x += 14;
    q.setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())); const s = 0.4 + rnd() * 1.3;
    m4.compose(v3.set(x, s * 0.25, z), q, sc.set(s, s * 0.7, s)); rocks.setMatrixAt(i, m4);
  }
  rocks.castShadow = !low; rocks.receiveShadow = true; scene.add(rocks);
  // 풀 덤불
  const tuftGeo = new THREE.ConeGeometry(0.22, 0.6, 4); tuftGeo.translate(0, 0.3, 0);
  const tufts = new THREE.InstancedMesh(tuftGeo, mat(0x557a3a, { flatShading: true }), 900);
  for (let i = 0; i < 900; i++) { const x = rnd() * W, z = rnd() * W; q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6); const s = 0.6 + rnd() * 0.9; m4.compose(v3.set(x, 0, z), q, sc.set(s, s, s)); tufts.setMatrixAt(i, m4); }
  scene.add(tufts);
  // 경계 울타리
  const postGeo = new THREE.BoxGeometry(0.25, 1.2, 0.25); postGeo.translate(0, 0.6, 0);
  const nPosts = Math.floor(W * 4 / 3);
  const posts = new THREE.InstancedMesh(postGeo, mat(0x6b5a44), nPosts);
  for (let i = 0; i < nPosts; i++) { const t = (i % (nPosts / 4)) * 3, side = Math.floor(i / (nPosts / 4)); const p = side === 0 ? [t, 0.6] : side === 1 ? [t, W - 0.6] : side === 2 ? [0.6, t] : [W - 0.6, t]; m4.compose(v3.set(p[0], 0, p[1]), q.identity(), sc.set(1, 1, 1)); posts.setMatrixAt(i, m4); }
  posts.castShadow = !low; scene.add(posts);

  /* ---------- 캠프 ---------- */
  const camp = new THREE.Group(); camp.position.set(CX, 0, CZ); scene.add(camp);
  const add = (geo, m, x, y, z, ry = 0, parent = camp) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = !low; o.receiveShadow = true; parent.add(o); return o; };
  for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; add(new THREE.DodecahedronGeometry(0.28, 0), mat(0x5c5c58, { flatShading: true }), Math.cos(a) * 0.85, 0.15, Math.sin(a) * 0.85); }
  const logGeo = new THREE.CylinderGeometry(0.12, 0.14, 1.4, 6);
  for (let i = 0; i < 3; i++) { const l = add(logGeo, mat(0x5a3a1e), 0, 0.2, 0, i * 1.05); l.rotation.z = Math.PI / 2 - 0.25; }
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flameMat2 = flameMat.clone(); flameMat2.color.set(0xffd060);
  const flame1 = add(new THREE.ConeGeometry(0.42, 1.4, 8), flameMat, 0, 0.8, 0);
  const flame2 = add(new THREE.ConeGeometry(0.24, 0.9, 8), flameMat2, 0.05, 0.6, 0.05);
  flame1.castShadow = flame2.castShadow = false;
  const fireGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff9a3a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  fireGlow.scale.set(4.5, 4.5, 1); fireGlow.position.set(0, 1, 0); camp.add(fireGlow);
  const tentGeo = new THREE.ConeGeometry(1.7, 2.1, 4); tentGeo.translate(0, 1.05, 0);
  [[-3.3, -2.0, 0x6b5a44, 0.6], [3, -2.6, 0x5b6375, -0.4], [-2.4, 3, 0x7a4a26, 0.2]].forEach(([x, z, c, r]) => add(tentGeo, mat(c, { flatShading: true }), x, 0, z, r + Math.PI / 4));
  add(new THREE.BoxGeometry(1.8, 0.9, 0.8), mat(0x6b4a2a), 2.6, 0.45, 2.0, 0.3);
  add(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(0x7a5d40), -4.6, 0.35, 0.8, 0.5);
  add(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat(0x6b5a44), -4.5, 1.0, 0.9, 0.2);
  // 깃발
  add(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 6), mat(0x4a3c2c), 4.6, 1.8, -0.6);
  const flag = add(new THREE.PlaneGeometry(1.2, 0.7, 8, 1), new THREE.MeshStandardMaterial({ color: 0xf2b632, side: THREE.DoubleSide, roughness: 0.8 }), 5.2, 3.2, -0.6);
  const flagPos = flag.geometry.attributes.position, flagBase = flagPos.array.slice();
  // 시설(레벨에 따라 보임)
  const facility = new THREE.Group(); camp.add(facility);
  function buildFacilities(S) {
    facility.clear();
    const b = S.build || {};
    for (let i = 0; i < Math.min(b.scrapper || 0, 6); i++) {
      const a = -2.4 + i * 0.32, x = Math.cos(a) * 7.2, z = Math.sin(a) * 7.2;
      add(new THREE.BoxGeometry(1.1, 1.0, 1.1), mat(0x5b6375, { metalness: 0.5, roughness: 0.5 }), x, 0.5, z, a, facility);
      add(new THREE.CylinderGeometry(0.35, 0.5, 0.7, 8), mat(0x8a93a8, { metalness: 0.6, roughness: 0.4 }), x, 1.35, z, 0, facility);
    }
    for (let i = 0; i < Math.min(b.shop || 0, 6); i++) {
      const a = 0.5 + i * 0.34, x = Math.cos(a) * 7.4, z = Math.sin(a) * 7.4;
      add(new THREE.BoxGeometry(1.4, 0.9, 0.9), mat(0x7a5d40), x, 0.45, z, -a, facility);
      add(new THREE.BoxGeometry(1.7, 0.08, 1.2), mat(i % 2 ? 0xe5484d : 0xf2b632), x, 1.7, z, -a, facility);
      add(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 4), mat(0x4a3c2c), x + 0.7, 0.85, z, 0, facility);
    }
    const nb = b.barricade || 0;
    for (let k = 0; k < nb * 4; k++) {
      const a = k / (nb * 4) * Math.PI * 2, r = 10.5;
      add(new THREE.BoxGeometry(2.2, 0.8, 0.35), mat(0x6b5a44), Math.cos(a) * r, 0.4, Math.sin(a) * r, -a + Math.PI / 2, facility);
    }
    for (let i = 0; i < Math.min(b.lamp || 0, 5); i++) {
      const a = i / 5 * Math.PI * 2 + 0.8, x = Math.cos(a) * 9, z = Math.sin(a) * 9;
      add(new THREE.CylinderGeometry(0.08, 0.1, 4, 6), mat(0x3a3f4a, { metalness: 0.6 }), x, 2, z, 0, facility);
      const bulb = add(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }), x, 4.1, z, 0, facility);
      bulb.castShadow = false;
      lampLights[i].position.set(CX + x, 4, CZ + z);
    }
    lampN = Math.min(b.lamp || 0, 5);
  }
  let lampN = 0;

  /* ---------- 자원 노드 ---------- */
  const nodeMats = { metal: mat(0x7d8597, { metalness: 0.6, roughness: 0.45, flatShading: true }), rust: mat(0x9a5a2a, { metalness: 0.3, roughness: 0.7, flatShading: true }), dark: mat(0x2a2f3b, { roughness: 0.6 }), car: mat(0x8a3b2a, { metalness: 0.4, roughness: 0.55 }), glass: mat(0x4a6a80, { metalness: 0.2, roughness: 0.2 }), crate: mat(0x5d6b3a), band: mat(0xc9a24a), crystal: new THREE.MeshStandardMaterial({ color: 0x5fe0e6, emissive: 0x2aa8b0, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 }) };
  function makeNode(n) {
    const g = new THREE.Group();
    const a = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = !low; o.receiveShadow = true; g.add(o); return o; };
    if (n.type === 'scrap') {
      a(new THREE.DodecahedronGeometry(0.55, 0), nodeMats.metal, 0, 0.3, 0, 0.3, 0.2, 0);
      a(new THREE.BoxGeometry(0.9, 0.18, 0.5), nodeMats.rust, 0.3, 0.6, 0.2, 0.2, 0.6, 0.4);
      a(new THREE.CylinderGeometry(0.25, 0.25, 0.7, 8), nodeMats.dark, -0.5, 0.25, 0.3, Math.PI / 2, 0.4, 0);
      a(new THREE.BoxGeometry(0.4, 0.4, 0.4), nodeMats.rust, 0.5, 0.2, -0.4, 0, 0.7, 0);
    } else if (n.type === 'car') {
      a(new THREE.BoxGeometry(2.6, 0.7, 1.3), nodeMats.car, 0, 0.6, 0, 0, 0, 0.04);
      a(new THREE.BoxGeometry(1.3, 0.6, 1.2), nodeMats.car, -0.2, 1.2, 0);
      a(new THREE.BoxGeometry(1.32, 0.42, 1.22), nodeMats.glass, -0.2, 1.22, 0);
      for (const [x, z] of [[-0.85, 0.65], [0.85, 0.65], [-0.85, -0.65], [0.9, -0.62]]) a(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10), nodeMats.dark, x, 0.3, z, Math.PI / 2, 0, 0);
      a(new THREE.BoxGeometry(0.5, 0.06, 0.9), nodeMats.rust, 1.1, 1.0, 0.1, 0.3, 0.2, 0.6);
    } else if (n.type === 'ammo') {
      a(new THREE.BoxGeometry(1.0, 0.7, 0.7), nodeMats.crate, 0, 0.35, 0);
      a(new THREE.BoxGeometry(1.04, 0.12, 0.74), nodeMats.band, 0, 0.45, 0);
      a(new THREE.BoxGeometry(0.7, 0.5, 0.5), nodeMats.crate, 0.2, 0.95, 0.05, 0, 0.5, 0);
    } else {
      for (const [x, h, tilt] of [[-0.3, 1.3, -0.3], [0, 2, 0], [0.32, 1.1, 0.35], [0.1, 0.9, -0.6]]) { const o = a(new THREE.OctahedronGeometry(0.35, 0), nodeMats.crystal, x, h * 0.45, 0.05, 0, 0, tilt); o.scale.set(1, h * 1.4, 1); }
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x5fe0e6, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.set(3.5, 3.5, 1); s.position.y = 0.9; g.add(s);
    }
    g.rotation.y = n.rot; g.position.set(n.x * M, 0, n.y * M);
    scene.add(g);
    return g;
  }

  /* ---------- 스프라이트 ---------- */
  function spriteMat(tex, o = {}) { return new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.08, fog: true, ...o }); }
  const playerSprite = new THREE.Sprite(spriteMat(icons.player)); playerSprite.center.set(0.5, 0.05); playerSprite.scale.set(1.9, 1.9, 1); scene.add(playerSprite);
  const gunSprite = new THREE.Sprite(spriteMat(icons['gun-pistol'], { depthTest: false })); gunSprite.scale.set(1.4, 1.4, 1); gunSprite.renderOrder = 5; scene.add(gunSprite);
  const playerShadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  playerShadow.rotation.x = -Math.PI / 2; playerShadow.scale.set(1.6, 0.9, 1); scene.add(playerShadow);
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }), 600);
  shadows.count = 0; shadows.frustumCulled = false; scene.add(shadows);
  const flashMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffd060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const flashSprite = new THREE.Sprite(flashMat); flashSprite.scale.set(1.6, 1.6, 1); scene.add(flashSprite);

  const monViews = new Map();
  function monView(e) {
    let v = monViews.get(e.id);
    if (v) return v;
    const look = e.look, tex = monTex[look.sprite] || monTex.zombie;
    const s = new THREE.Sprite(spriteMat(tex)); s.center.set(0.5, 0.04);
    const size = look.size * (MONSTERS[look.sprite] ? MONSTERS[look.sprite].scale / 1.6 : 1);
    s.userData = { size, tint: new THREE.Color(look.tint ?? 0xffffff), fly: look.fly ? 1.4 : 0 };
    s.scale.set(size, size, 1); scene.add(s);
    v = { s, seen: 0 }; monViews.set(e.id, v);
    return v;
  }
  const nodeViews = new Map();
  const dropPool = [], dropTex = { gold: icons['ui-coin'], scrap: icons['res-scrap'], crystal: icons['res-crystal'] };
  const turretViews = new Map();
  function turretView(t) {
    let v = turretViews.get(t.id); if (v) return v;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.8, 8), mat(0x4a4f5c, { metalness: 0.5 })); base.position.y = 0.4; base.castShadow = !low; g.add(base);
    const head = new THREE.Group(); head.position.y = 1.0; g.add(head);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.6), mat(0x5b6375, { metalness: 0.6, roughness: 0.4 })); body.castShadow = !low; head.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 6), mat(0x2a2f3b)); barrel.rotation.z = Math.PI / 2; barrel.position.x = 0.6; head.add(barrel);
    g.position.set(t.x * M, 0, t.y * M); scene.add(g);
    v = { g, head, seen: 0 }; turretViews.set(t.id, v); return v;
  }

  /* ---------- 탄, 입자 ---------- */
  const MAXB = 900;
  const bGeo = new THREE.BufferGeometry();
  const bPos = new Float32Array(MAXB * 6), bCol = new Float32Array(MAXB * 6);
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3)); bGeo.setAttribute('color', new THREE.BufferAttribute(bCol, 3));
  const bLines = new THREE.LineSegments(bGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  bLines.frustumCulled = false; scene.add(bLines);
  const MAXP = 2500;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }));
  points.frustumCulled = false; scene.add(points);
  const ebMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 500);
  ebMesh.count = 0; ebMesh.frustumCulled = false; scene.add(ebMesh);
  const ebGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), 500);
  ebGlow.count = 0; ebGlow.frustumCulled = false; scene.add(ebGlow);
  const ringPool = [];
  function ring(i) {
    if (!ringPool[i]) { const r = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, side: THREE.DoubleSide, depthWrite: false })); r.rotation.x = -Math.PI / 2; scene.add(r); ringPool[i] = r; }
    return ringPool[i];
  }
  const discPool = [];
  function disc(i) {
    if (!discPool[i]) { const r = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.2, depthWrite: false })); r.rotation.x = -Math.PI / 2; scene.add(r); discPool[i] = r; }
    return discPool[i];
  }

  /* ---------- 상태 ---------- */
  let mode = 'title', W2 = 0, H2 = 0, t = 0;
  const camPos = new THREE.Vector3(CX + 10, 18, CZ + 18), camLook = new THREE.Vector3(CX, 0, CZ);
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2(), hitP = new THREE.Vector3();
  function resize() {
    W2 = innerWidth; H2 = innerHeight;
    renderer.setSize(W2, H2, false);
    const dpr = Math.min(2, devicePixelRatio || 1);
    overlay.width = W2 * dpr; overlay.height = H2 * dpr; octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    camera.aspect = W2 / H2; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  function clearRun() {
    for (const v of monViews.values()) { scene.remove(v.s); v.s.material.dispose(); }
    monViews.clear();
    for (const v of nodeViews.values()) scene.remove(v.g);
    nodeViews.clear();
    for (const v of turretViews.values()) scene.remove(v.g);
    turretViews.clear();
    for (const d of dropPool) d.visible = false;
  }
  function setMode(m, S) {
    mode = m;
    if (m !== 'run') clearRun();
    buildFacilities(S);
  }
  const proj = new THREE.Vector3();
  function project(x, y, h = 0) {
    proj.set(x * M, h, y * M).project(camera);
    return { x: (proj.x + 1) / 2 * W2, y: (1 - proj.y) / 2 * H2, on: proj.z < 1 };
  }
  function screenToGround(sx, sy) {
    ndc.set(sx / W2 * 2 - 1, -(sy / H2) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, hitP)) return null;
    return { x: hitP.x / M, y: hitP.z / M };
  }

  /* ---------- 시간대 ---------- */
  function phaseFor(R, mode) {
    if (mode === 'title') return lerpPhase('dusk', 'night', 0.35);
    if (mode === 'hub') return lerpPhase('dawn', 'day', 0.55);
    if (!R) return PHASES.day;
    if (R.phase === 'boss') return PHASES.boss;
    if (R.phase === 'day') { const k = R.t / R.dayLen; return k > 0.8 ? lerpPhase('day', 'dusk', (k - 0.8) / 0.2) : PHASES.day; }
    if (R.phase === 'dusk') return lerpPhase('dusk', 'night', Math.min(1, R.t / 6));
    const k = R.t / R.nightLen; return k > 0.93 ? lerpPhase('night', 'dawn', (k - 0.93) / 0.07) : PHASES.night;
  }

  /* ---------- 그리기 ---------- */
  const tmpC = new THREE.Color();
  function render(dt, ctx) {
    t += dt;
    const { R, S } = ctx;
    const live = ctx.mode === 'run' && R;
    if (R) { R.dayLen = R.dayLen || 90; }
    const P = phaseFor(R, ctx.mode);
    applyPhase(THREE, scene, lights, P);
    const nightK = 1 - Math.min(1, P.sunI / 2.2); // 0 낮 ~ 1 밤

    // 카메라
    if (live) {
      const p = R.p, yaw = ctx.yaw ?? -Math.PI / 2, lead = ctx.locked ? 4.5 : 1.6;
      const tx = p.x * M + Math.cos(p.ang) * lead, tz = p.y * M + Math.sin(p.ang) * lead;
      const want = new THREE.Vector3(tx, 0, tz);
      camLook.lerp(want, Math.min(1, dt * (ctx.locked ? 14 : 6)));
      const dist = W2 < 720 ? 1.25 : 1, back = (ctx.locked ? 11 : 12.5) * dist;
      // 카메라는 바라보는 방향 뒤쪽 위에 선다 (잠금 전에는 북쪽 고정)
      camPos.set(camLook.x - Math.cos(yaw) * back, (ctx.locked ? 15 : 19) * dist, camLook.z - Math.sin(yaw) * back);
      if (R.shake > 0.5) camPos.add(new THREE.Vector3((Math.random() - 0.5) * R.shake * 0.05, 0, (Math.random() - 0.5) * R.shake * 0.05));
    } else {
      const a = t * 0.05;
      camLook.set(CX, 0.5, CZ);
      camPos.set(CX + Math.cos(a) * 17, 8.5, CZ + Math.sin(a) * 17);
    }
    camera.position.copy(camPos); camera.lookAt(camLook);

    // 해와 그림자는 카메라 근처를 따라간다
    sun.position.set(camLook.x - 18, 30, camLook.z - 10); sun.target.position.copy(camLook);
    // 모닥불 일렁임
    const fl = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 29) * 0.05;
    flame1.scale.set(fl, 1 + Math.sin(t * 9) * 0.15, fl); flame2.scale.set(1, 1 + Math.sin(t * 11 + 1) * 0.2, 1);
    fire.intensity = (1.5 + nightK * 5) * fl;
    fireGlow.material.opacity = 0.25 + nightK * 0.5;
    for (let i = 0; i < flagPos.count; i++) { const x = flagBase[i * 3]; flagPos.setZ(i, Math.sin(t * 4 + x * 4) * 0.08 * (x + 0.6)); }
    flagPos.needsUpdate = true;
    lampLights.forEach((l, i) => { l.intensity = i < lampN ? nightK * 8 : 0; });

    playerSprite.visible = gunSprite.visible = playerShadow.visible = !!live;
    let sh = 0;
    const setShadow = (x, z, w) => { if (sh >= 600) return; m4.compose(v3.set(x, 0.03, z), q.identity(), sc.set(w, 1, w * 0.55)); shadows.setMatrixAt(sh++, m4); };

    if (live) {
      const p = R.p, px = p.x * M, pz = p.y * M;
      // 플레이어
      playerSprite.position.set(px, 0, pz);
      const faceL = Math.cos(p.ang) < 0;
      playerSprite.scale.x = faceL ? -1.9 : 1.9;
      const blink = p.inv > 0 && Math.floor(p.inv * 30) % 2;
      playerSprite.material.opacity = blink ? 0.4 : 1;
      playerSprite.position.y = p.dash > 0 ? 0.15 : Math.abs(Math.sin(t * 10)) * Math.min(1, Math.hypot(p.vx, p.vy) / 200) * 0.08;
      playerShadow.position.set(px, 0.03, pz);
      // 총: 화면에서 본 조준 각도로 돌린다
      const gIcon = icons[ctx.gunIcon] || icons['gun-pistol'];
      if (gunSprite.material.map !== gIcon) { gunSprite.material.map = gIcon; gunSprite.material.needsUpdate = true; }
      const a0 = project(p.x, p.y, 0.8), a1 = project(p.x + Math.cos(p.ang) * 40, p.y + Math.sin(p.ang) * 40, 0.8);
      const sa = Math.atan2(-(a1.y - a0.y), a1.x - a0.x);
      gunSprite.position.set(px + Math.cos(p.ang) * 0.55, 0.8, pz + Math.sin(p.ang) * 0.55);
      gunSprite.material.rotation = faceL ? sa + Math.PI : sa;
      gunSprite.scale.set(faceL ? -1.4 : 1.4, 1.4, 1);
      const recoil = R.flash > 0 ? 0.92 : 1; gunSprite.scale.multiplyScalar(recoil);
      flashSprite.visible = R.flash > 0;
      flashSprite.position.set(px + Math.cos(p.ang) * 1.3, 0.85, pz + Math.sin(p.ang) * 1.3);
      muzzle.intensity = R.flash > 0 ? 6 : 0; muzzle.position.copy(flashSprite.position);
      // 손전등
      torch.position.set(px, 2.4, pz); torch.target.position.set(px + Math.cos(p.ang) * 8, 0, pz + Math.sin(p.ang) * 8);
      torch.intensity = P.torchI * 12 * (1 + 0.15 * (ctx.lamps || 0));
      torch.distance = TORCH.distance * (1 + 0.15 * (ctx.lamps || 0));
      aura.position.set(px, 2, pz); aura.intensity = P.torchI * 1.6;

      // 노드
      for (const n of R.nodes) { let v = nodeViews.get(n.id); if (!v) { v = { g: makeNode(n) }; nodeViews.set(n.id, v); } v.seen = t; if (n.type === 'crystal') v.g.rotation.y += dt * 0.6; const k = p.gathering === n ? 1 + Math.sin(t * 30) * 0.03 : 1; v.g.scale.set(k, k, k); }
      for (const [id, v] of nodeViews) if (v.seen !== t) { scene.remove(v.g); nodeViews.delete(id); }
      // 포탑
      for (const tw of R.turrets) { const v = turretView(tw); v.seen = t; v.head.rotation.y = -tw.ang; }
      // 몬스터
      const torchDir = { x: Math.cos(p.ang), y: Math.sin(p.ang) };
      let bossV = null;
      for (const e of R.enemies) {
        const v = monView(e); v.seen = t;
        const s = v.s, ud = s.userData;
        const fly = ud.fly ? ud.fly + Math.sin(e.ph * 0.6) * 0.25 : 0;
        const hop = ud.fly ? 0 : Math.abs(Math.sin(e.ph * 0.9)) * 0.12;
        s.position.set(e.x * M, fly + hop, e.y * M);
        const size = ud.size * (e.elite ? 1 : 1) * (e.boss ? 1 + Math.sin(t * 2) * 0.02 : 1);
        s.scale.set(e.face < 0 ? -size : size, size, 1);
        // 밤에는 빛이 닿는 곳만 보인다
        const dx = e.x - p.x, dy = e.y - p.y, d = Math.hypot(dx, dy) || 1;
        let L = 1 - nightK * 0.82;
        L += Math.max(0, 1 - d / 260) * 0.8 * nightK;
        const cone = (dx * torchDir.x + dy * torchDir.y) / d;
        if (cone > 0.82) L += Math.max(0, 1 - d / (TORCH.distance / M)) * nightK * 1.1;
        const dc = Math.hypot(e.x - CAMP.x, e.y - CAMP.y); L += Math.max(0, 1 - dc / 420) * nightK * 0.8;
        if (e.boss) L = Math.max(L, 0.75);
        L = Math.min(1, L);
        if (e.hit > 0) tmpC.setRGB(1, 1, 1); else tmpC.copy(ud.tint).multiplyScalar(L);
        s.material.color.copy(tmpC);
        s.material.opacity = e.fade ? Math.max(0, 1 - e.fade / 1.4) : 1;
        setShadow(e.x * M, e.y * M, size * (ud.fly ? 0.4 : 0.6));
        if (e.boss) bossV = e;
      }
      for (const [id, v] of monViews) if (v.seen !== t) { scene.remove(v.s); v.s.material.dispose(); monViews.delete(id); }
      bossLight.intensity = bossV ? 6 : 0; if (bossV) bossLight.position.set(bossV.x * M, 3, bossV.y * M);
      // 줍는 것
      R.drops.forEach((d, i) => {
        let s = dropPool[i];
        if (!s) { s = new THREE.Sprite(spriteMat(dropTex.gold)); s.scale.set(0.55, 0.55, 1); scene.add(s); dropPool[i] = s; }
        if (s.material.map !== dropTex[d.res]) { s.material.map = dropTex[d.res]; s.material.needsUpdate = true; }
        s.visible = true; s.position.set(d.x * M, 0.35 + Math.sin(d.t * 7 + i) * 0.1, d.y * M);
        if (i < 200) setShadow(d.x * M, d.y * M, 0.4);
      });
      for (let i = R.drops.length; i < dropPool.length; i++) dropPool[i].visible = false;
      // 총알
      let bi = 0;
      for (const b of R.bullets) {
        if (bi >= MAXB) break;
        const len = b.flame ? 0.03 : b.beam ? 0.03 : 0.018, o = bi * 6;
        bPos[o] = b.x * M; bPos[o + 1] = 0.85; bPos[o + 2] = b.y * M;
        bPos[o + 3] = (b.x - b.vx * len) * M; bPos[o + 4] = 0.85; bPos[o + 5] = (b.y - b.vy * len) * M;
        const c = b.tower ? [0.6, 0.8, 1] : b.flame ? [1, 0.45 + Math.random() * 0.3, 0.1] : b.beam ? [0.85, 0.75, 1] : [1, 0.82, 0.35];
        bCol.set(c, o); bCol.set(b.flame ? [0.6, 0.15, 0] : c.map(x => x * 0.4), o + 3);
        bi++;
      }
      bGeo.setDrawRange(0, bi * 2); bGeo.attributes.position.needsUpdate = true; bGeo.attributes.color.needsUpdate = true;
      // 적 탄
      let ei = 0;
      for (const b of R.ebullets) {
        if (ei >= 500) break;
        const r = (b.r || 8) * M * 1.4;
        m4.compose(v3.set(b.x * M, 0.8, b.y * M), q.identity(), sc.set(r / 0.22, r / 0.22, r / 0.22)); ebMesh.setMatrixAt(ei, m4);
        ebMesh.setColorAt(ei, tmpC.setHex(b.col || 0xff9a3c));
        m4.compose(v3.set(b.x * M, 0.8, b.y * M), camera.quaternion, sc.set(r * 6, r * 6, 1)); ebGlow.setMatrixAt(ei, m4);
        ebGlow.setColorAt(ei, tmpC.setHex(b.col || 0xff9a3c));
        ei++;
      }
      ebMesh.count = ebGlow.count = ei; ebMesh.instanceMatrix.needsUpdate = ebGlow.instanceMatrix.needsUpdate = true;
      if (ebMesh.instanceColor) ebMesh.instanceColor.needsUpdate = true; if (ebGlow.instanceColor) ebGlow.instanceColor.needsUpdate = true;
      // 경고 원
      let ri = 0, di = 0;
      for (const w of R.warns) {
        const r = ring(ri++), dd = disc(di++), k = w.t > 0 ? 1 - w.t / w.dur : 1;
        r.visible = dd.visible = true; r.position.set(w.x * M, 0.05, w.y * M); r.scale.setScalar(w.r * M); r.material.opacity = w.t > 0 ? 0.9 : Math.max(0, 1 + w.t * 2.5);
        dd.position.set(w.x * M, 0.04, w.y * M); dd.scale.setScalar(w.r * M * k); dd.material.opacity = w.t > 0 ? 0.25 : 0;
      }
      // 이펙트
      let pi = 0;
      const put = (x, y, z, c) => { if (pi >= MAXP) return; pPos[pi * 3] = x; pPos[pi * 3 + 1] = y; pPos[pi * 3 + 2] = z; tmpC.setHex(c); pCol[pi * 3] = tmpC.r; pCol[pi * 3 + 1] = tmpC.g; pCol[pi * 3 + 2] = tmpC.b; pi++; };
      for (const f of R.fx) {
        const k = f.t / f.dur, fx = f.x * M, fz = f.y * M;
        if (f.kind === 'burst' || f.kind === 'blood' || f.kind === 'spark') {
          const n = f.kind === 'burst' ? 16 : 4, sp = f.kind === 'burst' ? 2.6 + f.r * M : 1.4;
          for (let i = 0; i < n; i++) { const a = (i / n + f.seed) * 6.283, s = sp * (0.5 + ((i * 7919 + f.seed * 1000) % 100) / 200); put(fx + Math.cos(a) * s * k, 0.5 + Math.sin(k * 3.14) * (0.6 + (i % 3) * 0.3), fz + Math.sin(a) * s * k, f.col); }
        } else if (f.kind === 'shell') {
          put(fx + Math.cos(f.ang) * 1.2 * k, 0.7 + Math.sin(k * 3.14) * 0.5, fz + Math.sin(f.ang) * 1.2 * k, 0xd79a3e);
        } else if (f.kind === 'boom') {
          const r = ring(ri++); r.visible = true; r.position.set(fx, 0.06, fz); r.scale.setScalar(f.r * M * (0.3 + k)); r.material.opacity = 1 - k;
          for (let i = 0; i < 24; i++) { const a = i / 24 * 6.283; put(fx + Math.cos(a) * f.r * M * k, 0.4 + k * 1.5 * ((i % 4) / 4), fz + Math.sin(a) * f.r * M * k, i % 2 ? 0xffb347 : 0xff5a1a); }
        }
      }
      for (let i = ri; i < ringPool.length; i++) ringPool[i].visible = false;
      for (let i = di; i < discPool.length; i++) discPool[i].visible = false;
      pGeo.setDrawRange(0, pi); pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
      for (const [id, v] of turretViews) if (v.seen !== t) { scene.remove(v.g); turretViews.delete(id); }
    } else {
      torch.intensity = 0; aura.intensity = 0; muzzle.intensity = 0; flashSprite.visible = false; bossLight.intensity = 0;
      bGeo.setDrawRange(0, 0); pGeo.setDrawRange(0, 0); ebMesh.count = ebGlow.count = 0;
      for (const r of ringPool) r.visible = false; for (const r of discPool) r.visible = false;
    }
    shadows.count = sh; shadows.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    drawOverlay(ctx, nightK);
  }

  /* ---------- 2D 오버레이 ---------- */
  function drawOverlay(ctx, nightK) {
    const { R } = ctx;
    octx.clearRect(0, 0, W2, H2);
    if (!(ctx.mode === 'run' && R)) return;
    const p = R.p;
    // 채집 진행 원
    if (p.gathering) {
      const s = project(p.gathering.x, p.gathering.y, 1.6);
      octx.lineWidth = 6; octx.strokeStyle = 'rgba(0,0,0,.5)'; octx.beginPath(); octx.arc(s.x, s.y, 22, 0, 7); octx.stroke();
      octx.strokeStyle = '#3fa7ff'; octx.beginPath(); octx.arc(s.x, s.y, 22, -Math.PI / 2, -Math.PI / 2 + p.gathering.prog * Math.PI * 2); octx.stroke();
      octx.font = '700 12px "Noto Sans KR", sans-serif'; octx.textAlign = 'center'; octx.fillStyle = '#fff'; octx.fillText(p.gathering.res.name, s.x, s.y - 32);
    } else if (R.phase === 'day') {
      // 가까운 자원 이름
      for (const n of R.nodes) { if ((n.x - p.x) ** 2 + (n.y - p.y) ** 2 > 220 * 220) continue; const s = project(n.x, n.y, 1.8); octx.font = '700 12px "Noto Sans KR", sans-serif'; octx.textAlign = 'center'; octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.7)'; octx.strokeText(n.res.name, s.x, s.y); octx.fillStyle = '#eef0f5'; octx.fillText(n.res.name, s.x, s.y); }
    }
    // 체력 바
    for (const e of R.enemies) {
      if (e.boss || e.hp >= e.max) continue;
      const s = project(e.x, e.y, (e.look.size || 1.6) * 0.95 + (e.look.fly ? 1.4 : 0));
      if (s.x < -50 || s.x > W2 + 50 || s.y < -50 || s.y > H2 + 50) continue;
      const w = e.elite ? 80 : 34;
      octx.fillStyle = 'rgba(0,0,0,.6)'; octx.fillRect(s.x - w / 2, s.y - 8, w, 5);
      octx.fillStyle = e.elite ? '#a46bff' : '#e5484d'; octx.fillRect(s.x - w / 2, s.y - 8, w * Math.max(0, e.hp / e.max), 5);
    }
    // 피해 숫자
    octx.textAlign = 'center';
    for (const qq of R.pops) {
      const s = project(qq.x, qq.y, 1.6);
      octx.globalAlpha = Math.min(1, qq.life * 2.5);
      octx.font = `700 ${Math.round(16 * qq.size)}px "JetBrains Mono", monospace`;
      octx.lineWidth = 3; octx.strokeStyle = '#000'; octx.strokeText(qq.txt, s.x, s.y); octx.fillStyle = qq.col; octx.fillText(qq.txt, s.x, s.y);
    }
    octx.globalAlpha = 1;
    if (!ctx.locked && ctx.aim && !R.over) { octx.font = '700 13px "Noto Sans KR", sans-serif'; octx.textAlign = 'center'; octx.fillStyle = 'rgba(255,255,255,.85)'; octx.fillText('화면을 클릭하면 마우스가 가운데에 고정되고, 마우스로 방향을 돌립니다', W2 / 2, H2 - 28); }
    // 조준점
    if (ctx.aim) {
      const m = ctx.aim; octx.strokeStyle = 'rgba(255,255,255,.9)'; octx.lineWidth = 2;
      octx.beginPath(); octx.arc(m.x, m.y, 11, 0, 7);
      for (const [a, b, c, d] of [[-18, 0, -6, 0], [6, 0, 18, 0], [0, -18, 0, -6], [0, 6, 0, 18]]) { octx.moveTo(m.x + a, m.y + b); octx.lineTo(m.x + c, m.y + d); }
      octx.stroke();
    }
    // 화면 밖 몬스터 화살표
    const seen = new Set();
    for (const e of R.enemies) {
      const s = project(e.x, e.y, 0.5);
      if (s.x > 0 && s.x < W2 && s.y > 0 && s.y < H2) continue;
      const a = Math.atan2(s.y - H2 / 2, s.x - W2 / 2), key = Math.round(a * 8);
      if (seen.has(key) && !e.boss && !e.elite) continue; seen.add(key);
      const k = Math.min((W2 / 2 - 28) / Math.abs(Math.cos(a) || 1e-6), (H2 / 2 - 28) / Math.abs(Math.sin(a) || 1e-6));
      octx.save(); octx.translate(W2 / 2 + Math.cos(a) * k, H2 / 2 + Math.sin(a) * k); octx.rotate(a);
      octx.fillStyle = e.boss || e.elite ? '#a46bff' : 'rgba(255,90,74,.9)'; const z = e.boss || e.elite ? 16 : 10;
      octx.beginPath(); octx.moveTo(z, 0); octx.lineTo(-z * 0.7, -z * 0.7); octx.lineTo(-z * 0.3, 0); octx.lineTo(-z * 0.7, z * 0.7); octx.closePath(); octx.fill();
      octx.restore();
    }
    // 피격
    if (R.hurt > 0) { const g = octx.createRadialGradient(W2 / 2, H2 / 2, Math.min(W2, H2) * 0.3, W2 / 2, H2 / 2, Math.max(W2, H2) * 0.7); g.addColorStop(0, 'rgba(229,72,77,0)'); g.addColorStop(1, `rgba(229,72,77,${R.hurt})`); octx.fillStyle = g; octx.fillRect(0, 0, W2, H2); }
    // 미니맵
    const size = W2 < 720 ? 100 : 150, x0 = W2 < 720 ? W2 - size - 12 : 14, y0 = H2 - size - (W2 < 720 ? 14 : 64), s = size / MAP;
    octx.fillStyle = nightK > 0.5 ? 'rgba(8,10,24,.8)' : 'rgba(20,30,18,.78)'; octx.strokeStyle = '#3a4053'; octx.lineWidth = 2;
    octx.beginPath(); if (octx.roundRect) octx.roundRect(x0, y0, size, size, 8); else octx.rect(x0, y0, size, size); octx.fill(); octx.stroke();
    octx.fillStyle = '#ffb347'; octx.beginPath(); octx.arc(x0 + CAMP.x * s, y0 + CAMP.y * s, 4, 0, 7); octx.fill();
    for (const n of R.nodes) { octx.fillStyle = n.type === 'crystal' ? '#5fe0e6' : n.type === 'ammo' ? '#f2b632' : '#46c46e'; octx.fillRect(x0 + n.x * s - 1, y0 + n.y * s - 1, n.type === 'crystal' ? 4 : 2, n.type === 'crystal' ? 4 : 2); }
    for (const e of R.enemies) { octx.fillStyle = e.boss || e.elite ? '#a46bff' : '#e5484d'; const z = e.boss || e.elite ? 6 : 2; octx.fillRect(x0 + e.x * s - z / 2, y0 + e.y * s - z / 2, z, z); }
    octx.fillStyle = '#fff'; octx.beginPath(); octx.arc(x0 + p.x * s, y0 + p.y * s, 3.5, 0, 7); octx.fill();
  }

  return { render, setMode, screenToGround, project };
}
