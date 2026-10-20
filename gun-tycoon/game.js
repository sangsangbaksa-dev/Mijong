/* 탄피상회: 밤의 사냥꾼 — 게임 로직과 2D 화면(HUD, 캠프, 모달).
   수치는 content/data.json(콘텐츠 스레드)에서 읽고, 맵은 render3d.js(three.js)가 그린다.
   좌표는 모두 픽셀 단위(맵 3200×3200)이고, 3D에서는 40px = 1m로 바꿔 그린다. */
import { createRenderer } from './render3d.js';

const D = await fetch('content/data.json').then(r => r.json());
const RULES = D.rules;
const MAP = RULES.mapSize.w;
const CAMP = { x: MAP / 2, y: MAP / 2 };
const DUSK_LEN = 6;
const NIGHT_LEN = RULES.nightDurationSec;
const HP_SOFT = 0.88; // 실제 플레이 테스트에서 밤 난이도가 가팔라 체력 성장을 조금 누그러뜨림

/* 디자인 스레드 아이콘과 몬스터 그림 대응표 */
const GUN_ICON = { pistol: 'gun-pistol', revolver: 'gun-pistol', smg: 'gun-smg', shotgun: 'gun-shotgun', rifle: 'gun-rifle', sniper: 'gun-sniper', flamer: 'gun-laser', minigun: 'gun-minigun', railgun: 'gun-laser' };
const GUN_TIER = { pistol: 1, revolver: 1, smg: 2, shotgun: 2, rifle: 3, sniper: 4, flamer: 4, minigun: 4, railgun: 5 };
const GUN_SND = { pistol: 'pistol', revolver: 'sniper', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', sniper: 'sniper', flamer: 'laser', minigun: 'smg', railgun: 'laser' };
const MON_LOOK = {
  dog:    { sprite: 'wolf',   size: 1.2, tint: 0xc9a27a, r: 16 },
  zombie: { sprite: 'zombie', size: 1.7, tint: 0xffffff, r: 20 },
  boar:   { sprite: 'brute',  size: 1.7, tint: 0xd49a72, r: 22 },
  bugs:   { sprite: 'bat',    size: 0.9, tint: 0xb8f070, r: 12, fly: true },
  crab:   { sprite: 'slime',  size: 1.9, tint: 0x8fb4d8, r: 28 },
  wolf:   { sprite: 'wolf',   size: 1.6, tint: 0x8a7cc8, r: 20 },
  shroom: { sprite: 'slime',  size: 1.4, tint: 0xff8a5a, r: 20 },
  ogre:   { sprite: 'brute',  size: 3.0, tint: 0xb0b8c8, r: 40 },
  wraith: { sprite: 'bat',    size: 1.6, tint: 0xc08aff, r: 20, fly: true },
};
const MON = Object.fromEntries(D.monsters.map(m => [m.id, m]));
const GUNS = D.guns;
const SKILLS = D.skills;
const BRANCHES = [...new Set(SKILLS.map(s => s.branch))];
const RES_NAME = { gold: '골드', scrap: '고철', crystal: '크리스탈' };

/* ================= 유틸 ================= */
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function kfmt(n) {
  n = Math.floor(n);
  if (n >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1) + '억';
  if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1) + '만';
  return n.toLocaleString('ko-KR');
}
const Snd = window.GameAudio || { play() {}, startMusic() {}, stopMusic() {}, setMusicIntensity() {}, toggleMute() { return true; }, isMuted() { return false; } };
const sfx = (n, o) => { if (!bot.on) try { Snd.play(n, o); } catch (e) {} };

/* ================= 상태 ================= */
const SAVE_KEY = 'tanpi.night.save.v2';
function newState() {
  return {
    day: 1, gold: 0, scrap: 0, crystal: 0, sp: 0,
    guns: { pistol: true }, gun: 'pistol',
    up: {}, build: {}, skills: {},
    stats: { kills: 0, played: 0, bossTries: 0, deaths: 0, goldTotal: 0 },
    won: false, last: null,
  };
}
let S = newState();
let R = null;
let mode = 'title';
let paused = false;

/* --- 파생 수치 --- */
const upLv = id => S.up[id] || 0;
const bLv = id => S.build[id] || 0;
function eff() {
  const e = { dmgMult: 1, rateMult: 1, crit: 0, pierce: 0, critDmg: 0, bossDmgMult: 1, hpFlat: 0, dodge: 0, lifesteal: 0, armorFlat: 0, hpMult: 1, revive: 0, gatherMult: 1, pickupMult: 1, goldMult: 1, shopDiscount: 1, buildingMult: 1, dayBonusSec: 0 };
  for (const s of SKILLS) if (S.skills[s.id]) for (const k in s.effect) {
    const v = s.effect[k];
    if (/Mult$|Discount$/.test(k)) e[k] *= v; else e[k] += v;
  }
  return e;
}
let E = eff();
const refreshEff = () => { E = eff(); };
function gunStats(id) {
  const g = GUNS.find(x => x.id === id);
  const crit = 0.05 + E.crit + 0.03 * bLv('lamp');
  return {
    ...g, icon: GUN_ICON[g.id], tier: GUN_TIER[g.id],
    dmg: g.dmg * (1 + 0.12 * upLv('power')) * E.dmgMult,
    rate: g.fireRate * (1 + 0.06 * upLv('rof')) * E.rateMult,
    mag: Math.round(g.magazine * (1 + 0.1 * upLv('mag'))),
    reload: g.reloadSec * Math.max(0.3, 1 - 0.04 * upLv('mag')),
    hits: 1 + g.pierce + E.pierce,
    spread: g.spreadDeg * Math.PI / 180,
    crit, critMul: 2 + E.critDmg,
  };
}
function power(id = S.gun) {
  const g = gunStats(id);
  const cycle = g.mag / g.rate + g.reload;
  const sustained = g.dmg * g.pellets * g.mag / cycle * (1 + g.crit * (g.critMul - 1));
  return sustained * (g.pellets > 1 ? 0.6 : 1);
}
const bestPower = () => Math.max(...GUNS.filter(g => S.guns[g.id]).map(g => power(g.id)));
const bossReq = () => D.boss.hp * (100 / (100 + D.boss.armor)) / 150 / E.bossDmgMult;
const maxHp = () => (RULES.playerBase.hp + 25 * upLv('armor') + E.hpFlat) * E.hpMult;
const armorVal = () => 4 * upLv('armor') + E.armorFlat;
const moveSpeed = () => RULES.playerBase.moveSpeed * (1 + 0.05 * upLv('boots'));
const gatherRate = () => RULES.playerBase.gatherPerSec * (1 + 0.15 * upLv('tools')) * E.gatherMult;
const dayLen = () => RULES.dayDurationSec + E.dayBonusSec;
const ROAM = MAP * 0.47;
function dayInfo(d) {
  if (d <= D.days.length) return D.days[d - 1];
  const n = RULES.nightSpawn, last = D.days[D.days.length - 1];
  return { ...last, day: d, nightSpawnCount: n.baseCount + n.countPerDay * (d - 1), hpMult: Math.pow(n.hpGrowthPerDay, d - 1), dmgMult: Math.pow(n.dmgGrowthPerDay, d - 1), goldMult: Math.pow(n.goldGrowthPerDay, d - 1), elite: d % 5 === 0 ? 'nightmare' : null };
}

/* ================= 하루 만들기 ================= */
let uid = 1;
function makeRun(kind) {
  const p = { x: CAMP.x, y: CAMP.y + 170, hp: maxHp(), vx: 0, vy: 0, dash: 0, dashCd: 0, inv: 0, ang: 0, revive: E.revive > 0, poison: 0, stun: 0, gathering: null, gp: 0 };
  const g = gunStats(S.gun);
  R = {
    kind, boss: kind === 'boss', t: 0, phase: kind === 'boss' ? 'boss' : 'day', info: dayInfo(S.day),
    p, ammo: g.mag, reload: 0, cd: 0,
    enemies: [], bullets: [], ebullets: [], nodes: [], drops: [], pops: [], fx: [], warns: [],
    turrets: [], spawned: 0, toSpawn: 0, eliteDone: false, crystalDone: 0,
    loot: { gold: 0, scrap: 0, crystal: 0, sp: 0 }, kills: 0, flash: 0, shake: 0, hurt: 0,
    over: false, bossObj: null, flameT: 0, dayLen: dayLen(), nightLen: NIGHT_LEN,
  };
  const nT = bLv('turret');
  for (let i = 0; i < nT; i++) { const a = i / nT * Math.PI * 2 + 0.3; R.turrets.push({ id: uid++, x: CAMP.x + Math.cos(a) * 190, y: CAMP.y + Math.sin(a) * 190, cd: Math.random(), ang: 0 }); }
  if (R.boss) {
    const B = D.boss;
    const b = { id: uid++, type: 'boss', boss: true, name: B.name, x: CAMP.x + 650, y: CAMP.y - 350, hp: B.hp, max: B.hp, r: 80, sp: B.speed, dmg: B.contactDmg, armor: B.armor, gold: 0, hit: 0, ph: 0, atk: 2.5, dashT: 4, summonT: 6, meteorT: 5, mode: 'walk', contact: 0, look: { sprite: 'boss', size: 6.5, tint: 0xffffff } };
    R.enemies.push(b); R.bossObj = b;
  } else seedNodes();
  return R;
}
function seedNodes() {
  const want = { scrap: 46, car: 14, ammo: 12, crystal: 0 };
  for (const res of D.dayResources) {
    if (res.unlockDay > S.day) continue;
    const n = res.id === 'crystal' ? (res.perDayMax || 1) : want[res.id] || 10;
    for (let i = 0; i < n; i++) placeNode(res, res.id === "crystal" ? 900 : 480);
  }
}
function placeNode(res, minD) {
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * Math.PI * 2, d = rand(minD, ROAM);
    const x = CAMP.x + Math.cos(a) * d, y = CAMP.y + Math.sin(a) * d;
    if (R.nodes.some(n => dist2(n, { x, y }) < 110 * 110)) continue;
    R.nodes.push({ id: uid++, type: res.id, res, x, y, r: res.id === 'car' ? 46 : res.id === 'crystal' ? 26 : 30, rot: Math.random() * 6, prog: 0, seed: Math.random() });
    return;
  }
}

/* ================= 진행 ================= */
function step(dt) {
  if (!R || R.over) return;
  R.t += dt; S.stats.played += dt;
  const p = R.p;
  if (R.kind === 'day') {
    if (R.phase === 'day' && R.t >= dayLen()) { R.phase = 'dusk'; R.t = 0; toast('해가 집니다. 캠프 불빛 근처로 돌아가세요', 'red'); sfx('warning', { pulses: 2 }); }
    else if (R.phase === 'dusk' && R.t >= DUSK_LEN) startNight();
    else if (R.phase === 'night' && R.t >= NIGHT_LEN) { endDay(true); return; }
  } else if (R.t >= D.boss.timeLimitSec) { loseBoss(true); return; }

  // 이동
  const inp = input.move();
  let spd = moveSpeed() * (R.flameT > 0 ? 0.85 : 1) * (S.gun === 'minigun' ? 0.85 : 1);
  if (p.stun > 0) { p.stun -= dt; spd = 0; }
  if (p.dash > 0) { p.dash -= dt; spd *= 3.1; }
  if (p.dashCd > 0) p.dashCd -= dt;
  if (p.inv > 0) p.inv -= dt;
  p.vx += (inp.x * spd - p.vx) * Math.min(1, dt * 14); p.vy += (inp.y * spd - p.vy) * Math.min(1, dt * 14);
  p.x = clamp(p.x + p.vx * dt, 60, MAP - 60); p.y = clamp(p.y + p.vy * dt, 60, MAP - 60);
  if (input.dash) { input.dash = false; if (p.dashCd <= 0 && (inp.x || inp.y)) { p.dash = 0.17; p.dashCd = 1.2; p.inv = 0.3; sfx('click', { pitch: 0.6 }); } }

  // 회복과 독
  const nearCamp = dist2(p, CAMP) < 300 * 300;
  const regen = RULES.playerBase.regenPerSec + 0.5 * upLv('medkit') + (nearCamp ? 2 : 0) + (R.phase === 'day' ? 2 : 0);
  p.hp = Math.min(maxHp(), p.hp + regen * dt);
  if (p.poison > 0) { p.poison -= dt; p.hp -= 2 * R.info.dmgMult * dt; if (p.hp <= 0) playerDown(); }

  // 채집 (낮): 자원 근처에 서 있으면 자동으로 모은다
  if (R.phase === 'day' || R.phase === 'dusk') gatherTick(dt);

  // 조준과 사격
  const aim = input.aimTarget();
  p.ang = Math.atan2(aim.y - p.y, aim.x - p.x);
  const g = gunStats(S.gun);
  if (R.cd > 0) R.cd -= dt;
  if (R.flameT > 0) R.flameT -= dt;
  if (R.reload > 0) { R.reload -= dt; if (R.reload <= 0) { R.reload = 0; R.ammo = g.mag; } }
  if (input.reload) { input.reload = false; startReload(); }
  if (input.firing() && p.stun <= 0 && !p.gathering) fire(g);

  if (R.phase === 'night') spawnTick();
  if (R.boss) bossTick(dt);

  // 포탑
  const tDmg = D.buildings.find(b => b.id === 'turret').dps * (1 + 0.12 * upLv('power')) * Math.pow(1.35, bLv('turretup'));
  for (const tw of R.turrets) {
    tw.cd -= dt; if (tw.cd > 0) continue;
    let best = null, bd = 480 * 480;
    for (const e of R.enemies) { const d = dist2(e, tw); if (d < bd) { bd = d; best = e; } }
    if (best) { tw.ang = Math.atan2(best.y - tw.y, best.x - tw.x); shoot(tw.x, tw.y, tw.ang, 1400, tDmg / 2.5, 1, 520, { tower: true }); tw.cd = 0.4; }
    else tw.cd = 0.25;
  }

  // 총알
  for (const b of R.bullets) {
    const sx = b.x, sy = b.y;
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0) continue;
    for (const e of R.enemies) {
      if (e.hp <= 0 || b.hit.includes(e.id)) continue;
      const rr = e.r + (b.flame ? 18 : 6);
      if (segHit(sx, sy, b.x, b.y, e.x, e.y, rr)) {
        b.hit.push(e.id); hurtEnemy(e, b.dmg, b);
        if (--b.hits <= 0 || e.type === 'crab') { b.life = 0; break; }
      }
    }
  }
  R.bullets = R.bullets.filter(b => b.life > 0);

  // 적 총알
  for (const b of R.ebullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (dist2(b, p) < (b.r + 16) ** 2) { b.life = 0; hurtPlayer(b.dmg, b.poison); }
  }
  R.ebullets = R.ebullets.filter(b => b.life > 0);
  // 낙하 경고
  for (const w of R.warns) {
    w.t -= dt;
    if (w.t <= 0 && !w.done) { w.done = true; R.shake = Math.max(R.shake, 10); fx('boom', w.x, w.y, w.r); if (dist2(w, p) < w.r * w.r) { hurtPlayer(w.dmg); if (w.stun) p.stun = 0.8; } }
  }
  R.warns = R.warns.filter(w => w.t > -0.4);

  for (const e of R.enemies) updateEnemy(e, dt);
  for (const e of R.enemies) if (e.hp <= 0 && !e.dead) killEnemy(e);
  R.enemies = R.enemies.filter(e => !e.dead);
  separate();

  // 줍기
  const mag = RULES.playerBase.pickupRadius * E.pickupMult + 40;
  for (const d of R.drops) {
    d.t += dt;
    const dd = Math.sqrt(dist2(d, p));
    if (d.t > 0.3 && dd < mag + 60) { const k = Math.min(1, dt * 9); d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k; }
    else { d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 0.88; d.vy *= 0.88; }
    if (dd < 26) { d.got = true; collect(d.res, d.amt); }
  }
  R.drops = R.drops.filter(d => !d.got && d.t < 45);
  for (const q of R.pops) { q.y -= 40 * dt; q.life -= dt; }
  R.pops = R.pops.filter(q => q.life > 0);
  if (R.pops.length > 70) R.pops.splice(0, R.pops.length - 70);
  for (const f of R.fx) f.t += dt;
  R.fx = R.fx.filter(f => f.t < f.dur);
  if (R.fx.length > 300) R.fx.splice(0, R.fx.length - 300);
  if (R.flash > 0) R.flash -= dt;
  if (R.hurt > 0) R.hurt -= dt;
  R.shake *= Math.pow(0.02, dt);
}
function segHit(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((cx - x1) * dx + (cy - y1) * dy) / l2, 0, 1);
  const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
  return px * px + py * py < r * r;
}
function separate() {
  const es = R.enemies, n = es.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = es[i], b = es[j], dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) > 90 || Math.abs(dy) > 90) continue;
    const rr = (a.r + b.r) * 0.75, d2 = dx * dx + dy * dy;
    if (d2 > 0 && d2 < rr * rr) { const d = Math.sqrt(d2), k = (rr - d) / 2 / d; if (!a.boss) { a.x -= dx * k; a.y -= dy * k; } if (!b.boss) { b.x += dx * k; b.y += dy * k; } }
  }
}

/* --- 채집 --- */
function gatherTick(dt) {
  const p = R.p;
  let near = null;
  for (const n of R.nodes) if (dist2(n, p) < (n.r + 50) ** 2) { near = n; break; }
  const moving = Math.hypot(p.vx, p.vy) > 60;
  if (!near || moving) { if (p.gathering) p.gathering.prog = Math.max(0, p.gathering.prog - dt); p.gathering = null; return; }
  p.gathering = near;
  near.prog += dt * gatherRate() / near.res.gatherSec;
  if (Math.random() < dt * 4) fx('spark', near.x + rand(-20, 20), near.y + rand(-20, 20), 0, near.type === 'crystal' ? 0x8ff3f6 : 0xd7c8a0);
  if (near.prog >= 1) {
    const r = near.res;
    let amt = rand(r.amount[0], r.amount[1]);
    if (r.scalesWithDay) amt *= Math.pow(r.scalesWithDay, S.day - 1);
    const key = r.gives === '골드' ? 'gold' : r.gives === '크리스탈' ? 'crystal' : 'scrap';
    const pieces = key === 'crystal' ? 1 : 3;
    for (let i = 0; i < pieces; i++) drop(key, amt / pieces, near.x, near.y);
    fx('burst', near.x, near.y, near.r, key === 'crystal' ? 0x5fe0e6 : key === 'gold' ? 0xf2b632 : 0x9aa3b5);
    sfx('coin', { pitch: key === 'crystal' ? 1.6 : 0.9 });
    R.nodes = R.nodes.filter(n => n !== near);
    p.gathering = null;
    // 자원은 시간이 지나면 다른 곳에 다시 생긴다 (결정은 하루 한 번)
    if (r.id !== 'crystal') setTimeout(() => { if (R && !R.over && R.phase === 'day') placeNode(r, 480); }, r.respawnSec * 1000 / (bot.fast ? 60 : 1));
  }
}

/* --- 밤 --- */
function startNight() {
  R.phase = 'night'; R.t = 0;
  R.toSpawn = R.info.nightSpawnCount; R.spawned = 0;
  p_gatherReset();
  toast(`${S.day}일차 밤. 몬스터가 몰려옵니다`, 'red');
  sfx('warning'); Snd.setMusicIntensity(2);
}
function p_gatherReset() { if (R.p.gathering) R.p.gathering = null; }
function nightCurve(t) { // 처음 20초 50%, 마지막 30초 150%
  const a = Math.min(t, 20) * 0.5, b = clamp(t - 20, 0, NIGHT_LEN - 50), c = clamp(t - (NIGHT_LEN - 30), 0, 30) * 1.5;
  return (a + b + c) / (10 + (NIGHT_LEN - 50) + 45);
}
function spawnTick() {
  if (R.t > NIGHT_LEN - 4) return;
  const should = Math.min(R.toSpawn, Math.ceil(R.toSpawn * nightCurve(R.t + 1)));
  const pool = R.info.monsters;
  const wsum = pool.reduce((s, id) => s + MON[id].weight, 0);
  while (R.spawned < should) {
    let r = Math.random() * wsum, id = pool[0];
    for (const m of pool) { r -= MON[m].weight; if (r <= 0) { id = m; break; } }
    const a = Math.random() * Math.PI * 2;
    const pack = id === 'bugs' ? 5 : id === 'zombie' ? 1 + Math.floor(Math.random() * 3) : 1;
    for (let i = 0; i < pack && R.spawned < R.toSpawn; i++) { spawnMon(id, a + rand(-0.15, 0.15)); R.spawned++; }
  }
  if (R.info.elite && !R.eliteDone && R.t > NIGHT_LEN - 45) { R.eliteDone = true; spawnElite(R.info.elite); }
}
function spawnMon(id, ang, at, mul = 1) {
  const m = MON[id], L = MON_LOOK[id], info = R.info, p = R.p;
  const a = ang ?? Math.random() * Math.PI * 2, d = rand(900, 1100);
  const e = {
    id: uid++, type: id, look: L, name: m.name,
    x: at ? at.x : clamp(p.x + Math.cos(a) * d, 30, MAP - 30), y: at ? at.y : clamp(p.y + Math.sin(a) * d, 30, MAP - 30),
    hp: m.hp * Math.pow(info.hpMult, HP_SOFT) * mul, max: m.hp * Math.pow(info.hpMult, HP_SOFT) * mul, sp: m.speed * rand(0.9, 1.1), r: L.r,
    dmg: m.dmg * info.dmgMult, gold: m.gold * info.goldMult * mul, hit: 0, ph: Math.random() * 6, contact: 0, atk: rand(1, 3), face: 1,
  };
  R.enemies.push(e);
  return e;
}
function spawnElite(eid) {
  const el = D.elites.find(x => x.id === eid); if (!el) return;
  const pool = R.info.monsters, avg = pool.reduce((s, id) => s + MON[id].hp, 0) / pool.length;
  const e = spawnMon(el.base, Math.random() * 7);
  e.elite = el; e.name = el.name;
  e.hp = e.max = avg * Math.pow(R.info.hpMult, HP_SOFT) * RULES.eliteHpMult;
  e.gold = MON[el.base].gold * R.info.goldMult * RULES.eliteGoldMult;
  e.r = e.look.r * 2.2; e.look = { ...e.look, size: e.look.size * 2.3 }; e.sp *= 0.8; e.dmg *= 2; e.atk = 3;
  toast(`엘리트 등장: ${el.name}`, 'red'); sfx('warning', { pulses: 4 });
}
function updateEnemy(e, dt) {
  const p = R.p;
  e.ph += dt * 8; if (e.hit > 0) e.hit -= dt; if (e.contact > 0) e.contact -= dt;
  const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
  e.face = dx < 0 ? -1 : 1;
  if (e.boss) return;
  if (R.phase === 'night' && R.t > NIGHT_LEN - 3 && !e.elite) e.flee = true;
  if (e.flee) { e.x -= dx / d * e.sp * dt; e.y -= dy / d * e.sp * dt; e.fade = (e.fade || 0) + dt; if (e.fade > 1.4) e.dead = true; return; }
  let sp = e.sp, ux = dx / d, uy = dy / d;
  const t = e.type;
  if (t === 'boar' || (e.elite && e.elite.id === 'king_boar')) {
    e.chg = (e.chg || 0) - dt;
    if (e.chg <= 0 && d < 260 && !e.charging) { e.charging = e.elite ? 3 : 1; e.cT = 0; e.cx = ux; e.cy = uy; }
    if (e.charging) { e.cT += dt; if (e.cT > 0.35) { sp *= 2.5; ux = e.cx; uy = e.cy; } if (e.cT > 1.35) { e.charging--; e.cT = 0; e.cx = ux = dx / d; e.cy = uy = dy / d; if (!e.charging) e.chg = 3; } }
  } else if (t === 'wolf') { const z = Math.sin(e.ph * 0.8) * 0.9; ux = dx / d - dy / d * z; uy = dy / d + dx / d * z; }
  else if (t === 'wraith') {
    e.tp = (e.tp || 3) - dt;
    if (e.tp <= 0) { e.tp = 3; fx('burst', e.x, e.y, 30, 0xc08aff); const a = Math.random() * 7, rr = rand(220, 340); e.x = clamp(p.x + Math.cos(a) * rr, 30, MAP - 30); e.y = clamp(p.y + Math.sin(a) * rr, 30, MAP - 30); fx('burst', e.x, e.y, 30, 0xc08aff); }
    e.atk -= dt;
    if (e.atk <= 0 && d < 600) { e.atk = 2.4; R.ebullets.push({ x: e.x, y: e.y, vx: ux * 300, vy: uy * 300, dmg: e.dmg * 0.7, life: 3, r: 8, col: 0xc08aff }); }
    if (d < 200) sp *= 0.2;
  } else if (t === 'bugs') { ux += Math.sin(e.ph * 1.3) * 0.5; uy += Math.cos(e.ph * 1.1) * 0.5; }
  if (e.elite) eliteSkill(e, dt, d);
  const k = Math.hypot(ux, uy) || 1;
  e.x += ux / k * sp * dt; e.y += uy / k * sp * dt;
  if (d < e.r + 18 && e.contact <= 0) {
    if (t === 'shroom' && !e.elite) { e.hp = 0; e.selfBoom = true; return; }
    e.contact = RULES.contactHitSec * (e.elite ? 0.6 : 1); hurtPlayer(e.dmg, t === 'bugs');
  }
}
function eliteSkill(e, dt) {
  e.atk -= dt; if (e.atk > 0) return;
  const id = e.elite.id;
  if (id === 'alpha_dog') { for (let i = 0; i < 10; i++) spawnMon('dog', 0, { x: e.x + rand(-90, 90), y: e.y + rand(-90, 90) }, 0.6); e.atk = 14; toast('송곳니가 부하를 부릅니다', 'red'); }
  else if (id === 'grey_ogre') { R.warns.push({ x: R.p.x, y: R.p.y, r: 170, t: 1.1, dur: 1.1, dmg: e.dmg * 1.2, stun: true }); e.atk = 5; }
  else if (id === 'wraith_lord' || id === 'nightmare') { for (let i = 0; i < 3; i++) { const c = spawnMon('wraith', 0, { x: e.x + rand(-120, 120), y: e.y + rand(-120, 120) }, 0.4); c.gold *= 0.3; } e.atk = 9; }
  else e.atk = 99;
}

/* --- 보스 --- */
function bossTick(dt) {
  const b = R.bossObj; if (!b || b.dead) return;
  const B = D.boss, p = R.p, hpK = b.hp / b.max;
  const ph = hpK > B.phases[0].hpAbove ? 0 : hpK > B.phases[1].hpAbove ? 1 : 2;
  if (ph !== b.phaseIdx) { b.phaseIdx = ph; toast(B.phases[ph].name, 'red'); sfx('warning', { pulses: 3 }); R.shake = 14; }
  const dm = B.phases[ph].dmgMult || 1, spd = ph === 2 ? 1.6 : 1, fast = ph === 2 && hpK < 0.1 ? 1.5 : 1;
  b.ph += dt * 4; if (b.hit > 0) b.hit -= dt; if (b.contact > 0) b.contact -= dt;
  const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy) || 1;
  b.face = dx < 0 ? -1 : 1;
  if (b.mode === 'dash') {
    b.mt += dt;
    if (b.mt > 0.5) { b.x += b.cx * 760 * dt; b.y += b.cy * 760 * dt; R.shake = Math.max(R.shake, 3); }
    if (b.mt > 1.3) b.mode = 'walk';
  } else { b.x += dx / d * B.speed * spd * dt; b.y += dy / d * B.speed * spd * dt; }
  b.x = clamp(b.x, 80, MAP - 80); b.y = clamp(b.y, 80, MAP - 80);
  b.atk -= dt * fast; b.dashT -= dt * fast;
  if (b.atk <= 0) {
    if (ph === 0) { const base = Math.atan2(dy, dx); for (let i = 0; i < 8; i++) { const a = base + (i - 3.5) * 0.13; R.ebullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * 340, vy: Math.sin(a) * 340, dmg: B.projectileDmg * dm, life: 4, r: 11, col: 0xff3a4a }); } b.atk = 2; }
    else { const n = 16, off = Math.random(); for (let i = 0; i < n; i++) { const a = (i + off) / n * Math.PI * 2; R.ebullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, dmg: B.projectileDmg * dm, life: 5, r: 12, col: 0xff3a4a }); } b.atk = ph === 2 ? 1.8 : 2.6; }
    sfx('shoot', { variant: 'shotgun', pitch: 0.5 });
  }
  if (b.dashT <= 0 && b.mode !== 'dash') { b.mode = 'dash'; b.mt = 0; b.cx = dx / d; b.cy = dy / d; b.dashT = ph === 2 ? 3 : 4; }
  if (ph >= 1) { b.summonT -= dt; if (b.summonT <= 0) { b.summonT = 10; for (let i = 0; i < 8; i++) { const m = spawnMon(Math.random() < 0.5 ? 'zombie' : 'wolf', 0, { x: b.x + rand(-160, 160), y: b.y + rand(-160, 160) }); m.hp = m.max = MON[m.type].hp * dayInfo(22).hpMult; m.dmg = MON[m.type].dmg * dayInfo(22).dmgMult; m.gold = 0; } } }
  if (ph === 2) { b.meteorT -= dt * fast; if (b.meteorT <= 0) { b.meteorT = 1.6; for (let i = 0; i < 3; i++) R.warns.push({ x: p.x + rand(-260, 260), y: p.y + rand(-260, 260), r: 120, t: 1, dur: 1, dmg: B.projectileDmg * 1.5 * dm }); } }
  if (d < b.r + 20 && b.contact <= 0) { b.contact = 1; hurtPlayer(B.contactDmg * dm); }
}

/* --- 전투 --- */
function shoot(x, y, ang, speed, dmg, hits, range, o = {}) {
  R.bullets.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, dmg, hits, hit: [], life: range / speed, ...o });
}
function fire(g) {
  if (R.reload > 0 || R.cd > 0) return;
  if (R.ammo <= 0) { startReload(); return; }
  R.ammo--; R.cd = 1 / g.rate;
  const p = R.p, mx = p.x + Math.cos(p.ang) * 36, my = p.y + Math.sin(p.ang) * 36;
  const o = { crit: g.crit, critMul: g.critMul, gun: g.id };
  if (g.id === 'flamer') { o.flame = true; R.flameT = 0.15; }
  if (g.id === 'railgun' || g.id === 'sniper') o.beam = true;
  for (let i = 0; i < g.pellets; i++) {
    const a = p.ang + (Math.random() - 0.5) * g.spread;
    shoot(mx, my, a, g.id === 'flamer' ? 620 : g.id === 'railgun' ? 4000 : 1500 * rand(0.95, 1.05), g.dmg, g.hits, g.range * (g.id === 'flamer' ? rand(0.8, 1.05) : 1), o);
  }
  R.flash = 0.05;
  R.shake = Math.max(R.shake, { shotgun: 5, sniper: 6, railgun: 10, revolver: 3 }[g.id] || 1.2);
  if (g.id !== 'flamer' || Math.random() < 0.25) sfx('shoot', { variant: GUN_SND[g.id] });
  fx('shell', p.x, p.y, 0, 0xd79a3e, p.ang + 1.9);
  if (R.ammo <= 0) startReload();
}
function startReload() {
  const g = gunStats(S.gun);
  if (R.reload > 0 || R.ammo >= g.mag) return;
  R.reload = g.reload; sfx('click', { pitch: 0.8 });
}
function hurtEnemy(e, dmg, b) {
  let d = dmg;
  const crit = Math.random() < (b.crit || 0);
  if (crit) d *= b.critMul;
  if (e.type === 'crab' && !e.elite) { const fa = Math.atan2(R.p.y - e.y, R.p.x - e.x), ba = Math.atan2(-b.vy, -b.vx); if (Math.cos(fa - ba) > 0) d *= 0.5; }
  if (e.boss) d *= 100 / (100 + e.armor);
  if (e.boss || e.elite) d *= E.bossDmgMult;
  e.hp -= d; e.hit = 0.08;
  if (E.lifesteal && !b.tower) R.p.hp = Math.min(maxHp(), R.p.hp + Math.min(d * E.lifesteal, 5 * 0.1));
  if (!e.boss && e.type !== 'ogre' && !e.elite) { const v = Math.hypot(b.vx, b.vy) || 1; e.x += b.vx / v * 7; e.y += b.vy / v * 7; }
  if (!b.flame || Math.random() < 0.2) pop(e.x + rand(-10, 10), e.y - e.r, kfmt(d) + (crit ? '!' : ''), crit ? '#ff7a1a' : '#eef0f5', crit ? 1.3 : 0.9);
  fx('blood', b.x, b.y, 0, e.look.fly ? 0x9aa3b5 : 0x7c2f2f);
  if (Math.random() < 0.2) sfx('hit');
}
function killEnemy(e) {
  e.dead = true; R.kills++; S.stats.kills++;
  fx('burst', e.x, e.y, e.r, e.type === 'shroom' ? 0xff8a5a : 0x5a1f1f);
  if (e.boss) { winBoss(); return; }
  if (e.type === 'shroom') {
    R.shake = Math.max(R.shake, 8); fx('boom', e.x, e.y, 110);
    if (e.selfBoom || dist2(e, R.p) < 110 * 110) hurtPlayer(e.dmg);
    if (!e.selfBoom) for (const o of R.enemies) if (o !== e && !o.dead && dist2(o, e) < 140 * 140) { o.hp -= e.max * 3; o.hit = 0.1; }
    if (e.selfBoom) return;
  }
  if (e.elite) {
    const cr = RULES.crystalPerElite.base + RULES.crystalPerElite.perDay * S.day;
    drop('crystal', cr, e.x, e.y);
    R.loot.sp += RULES.skillPointPerElite; S.sp += RULES.skillPointPerElite;
    toast(`${e.name} 처치! 크리스탈 +${Math.round(cr)}, 스킬 포인트 +1`, 'gold'); R.shake = 14;
    if (e.elite.id === 'queen_bug') for (let i = 0; i < 20; i++) spawnMon('bugs', 0, { x: e.x + rand(-80, 80), y: e.y + rand(-80, 80) }, 0.5);
  }
  if (e.gold > 0) { const coins = Math.min(5, 1 + Math.floor(Math.log10(e.gold + 1) * 1.5)); for (let i = 0; i < coins; i++) drop('gold', e.gold * E.goldMult / coins, e.x, e.y); }
  sfx('kill');
}
function drop(res, amt, x, y) { const a = Math.random() * 7, s = rand(90, 230); R.drops.push({ id: uid++, res, amt, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0 }); }
function collect(res, amt) {
  R.loot[res] += amt; S[res] += amt;
  if (res === 'gold') S.stats.goldTotal += amt;
  if (Math.random() < 0.5) sfx('coin', { volume: 0.5 });
  if (amt >= 1) pop(R.p.x, R.p.y - 40, '+' + kfmt(amt) + ' ' + RES_NAME[res], { gold: '#f2b632', scrap: '#c3cad8', crystal: '#7ff0f4' }[res], 0.85);
}
function hurtPlayer(d, poison) {
  const p = R.p;
  if (p.inv > 0 || R.over) return;
  d *= 100 / (100 + armorVal());
  d *= Math.pow(1 - D.buildings.find(b => b.id === 'barricade').dmgReduce, bLv('barricade'));
  d *= 1 - E.dodge;
  p.hp -= d; p.inv = 0.15; R.shake = Math.max(R.shake, 6); R.hurt = 0.35;
  if (poison) p.poison = 2;
  pop(p.x, p.y - 34, '-' + kfmt(d), '#e5484d', 1);
  sfx('hit', { pitch: 0.5 });
  if (p.hp <= 0) playerDown();
}
function playerDown() {
  const p = R.p;
  if (R.over) return;
  if (p.revive) { p.revive = false; p.hp = maxHp() * 0.5; p.inv = 2; p.poison = 0; toast('두 번째 기회! 다시 일어났습니다', 'gold'); return; }
  if (R.boss) loseBoss(false); else endDay(false);
}
function pop(x, y, txt, col, size = 1) { R.pops.push({ x, y, txt, col, size, life: 0.8 }); }
function fx(kind, x, y, r = 0, col = 0xffffff, ang = 0) { R.fx.push({ kind, x, y, r, col, ang, t: 0, dur: kind === 'boom' ? 0.5 : kind === 'burst' ? 0.6 : kind === 'shell' ? 0.6 : 0.35, seed: Math.random() }); }

/* --- 하루 끝 --- */
function endDay(survived) {
  R.over = true;
  const loot = { ...R.loot };
  let lost = 0;
  if (!survived) { lost = Math.floor(loot.gold * (1 - RULES.deathLootKeep)); S.gold -= lost; S.stats.deaths++; }
  const prod = { gold: 0, scrap: 0, crystal: 0 };
  for (const b of D.buildings) {
    const n = bLv(b.id); if (!n || !b.produces) continue;
    for (const k in b.produces) prod[k] += b.produces[k] * n * E.buildingMult * (k === 'gold' && b.cost.goldMult ? Math.pow(b.cost.goldMult, S.day - 1) : 1);
  }
  for (const k in prod) S[k] += prod[k];
  S.sp += RULES.skillPointPerDay;
  S.last = { day: S.day, survived, loot, lost, prod, kills: R.kills };
  S.day++;
  save();
  if (bot.on) { mode = 'hub'; return; }
  setTimeout(goHub, survived ? 300 : 900);
  if (!survived) { toast('쓰러졌습니다. 골드 절반만 챙겨 캠프로 돌아갑니다', 'red'); }
}
function winBoss() {
  R.over = true; S.won = true; save();
  Snd.setMusicIntensity(0);
  if (bot.on) { mode = 'hub'; return; }
  setTimeout(showWin, 1200);
}
function loseBoss(timeout) {
  R.over = true; save();
  if (bot.on) { mode = 'hub'; return; }
  const left = Math.round(R.bossObj.hp / R.bossObj.max * 100);
  showModal(`<h2>${timeout ? '시간 초과' : '패배'}</h2><p>${D.boss.name}의 체력을 ${left}% 남겼습니다. ${timeout ? `제한 시간 ${D.boss.timeLimitSec}초 안에 쓰러뜨려야 합니다.` : ''} 잃은 것은 없으니 캠프에서 더 강해져서 다시 도전하세요.</p><div class="acts"><button class="gt-btn gt-btn--primary" data-act="hub">캠프로</button></div>`);
}

/* ================= 저장 ================= */
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
function load() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.day) { S = Object.assign(newState(), s); refreshEff(); return true; } } catch (e) {}
  return false;
}

/* ================= 입력 ================= */
const keys = {};
const mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false };
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let touchMode = matchMedia('(pointer: coarse)').matches;
const bot = { on: false, fast: false };
let locked = false;
const SENS = 0.0035;
const input = {
  dash: false, reload: false,
  move() {
    if (bot.on && R) return botMove();
    let x = 0, y = 0;
    if (keys.KeyW || keys.ArrowUp) y -= 1; if (keys.KeyS || keys.ArrowDown) y += 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1; if (keys.KeyD || keys.ArrowRight) x += 1;
    if (joy.id !== null) { x = joy.x; y = joy.y; }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    if (locked && R) { // 바라보는(쏘는) 방향 기준: W 앞, S 뒤, A 왼쪽, D 오른쪽
      const a = R.p.ang, fx = Math.cos(a), fy = Math.sin(a), rx = -fy, ry = fx, fwd = -y, side = x;
      return { x: fx * fwd + rx * side, y: fy * fwd + ry * side };
    }
    return { x, y };
  },
  aimTarget() {
    if (touchMode || bot.on) { const t = autoTarget(); if (t) return lead(t); const p = R.p; return { x: p.x + Math.cos(p.ang) * 100, y: p.y + Math.sin(p.ang) * 100 }; }
    if (locked) { const p = R.p; return { x: p.x + Math.cos(p.ang) * 100, y: p.y + Math.sin(p.ang) * 100 }; }
    return view.screenToGround(mouse.x, mouse.y) || { x: R.p.x + 1, y: R.p.y };
  },
  firing() { return touchMode || bot.on ? !!autoTarget() : mouse.down; },
};
function lead(t) { return { x: t.x, y: t.y }; }
let atCache = { t: -1, v: null };
function autoTarget() {
  if (atCache.t === R.t && atCache.r === R) return atCache.v;
  const p = R.p, rng = gunStats(S.gun).range * 0.95;
  let best = null, bd = rng * rng;
  for (const e of R.enemies) { const d = dist2(e, p) * (e.boss ? 0.7 : 1); if (d < bd) { bd = d; best = e; } }
  atCache = { t: R.t, r: R, v: best };
  return best;
}

/* ================= 3D 화면 ================= */
const view = await createRenderer({ canvas: $('cv'), overlay: $('ov'), MAP, CAMP, low: touchMode });

/* ================= HUD ================= */
let hudT = 0;
function updateHud() {
  if (!R) return;
  const p = R.p, g = gunStats(S.gun);
  $('hpBar').style.setProperty('--value', clamp(p.hp / maxHp() * 100, 0, 100));
  $('hpTxt').textContent = Math.max(0, Math.ceil(p.hp));
  $('spTxt').textContent = `스킬 포인트 ${S.sp}` + (p.poison > 0 ? ' · 중독' : '') + (p.stun > 0 ? ' · 기절' : '');
  const clock = $('clock');
  clock.classList.toggle('is-night', R.phase === 'night' || R.phase === 'dusk');
  clock.classList.toggle('is-boss', R.boss);
  if (R.boss) {
    const left = Math.ceil(D.boss.timeLimitSec - R.t);
    $('dayTxt').textContent = '보스전'; $('phaseTxt').textContent = '결전';
    $('clockHint').textContent = `제한 시간 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('clockSun').style.left = (R.t / D.boss.timeLimitSec * 100) + '%';
  } else {
    $('dayTxt').textContent = S.day + '일차';
    const dl = dayLen(), total = dl + DUSK_LEN + NIGHT_LEN;
    const el = R.phase === 'day' ? R.t : R.phase === 'dusk' ? dl + R.t : dl + DUSK_LEN + R.t;
    $('clockSun').style.left = (el / total * 100) + '%';
    $('phaseTxt').textContent = R.phase === 'day' ? '낮' : R.phase === 'dusk' ? '해 질 녘' : '밤';
    const left = Math.ceil(R.phase === 'day' ? dl - R.t : R.phase === 'dusk' ? DUSK_LEN - R.t : NIGHT_LEN - R.t);
    $('clockHint').textContent = R.phase === 'day' ? (p.gathering ? `채집 중 ${Math.round(p.gathering.prog * 100)}%` : `자원 옆에 멈춰 서면 채집합니다 · 밤까지 ${left}초`) : R.phase === 'dusk' ? `몬스터가 깨어납니다 · ${left}초` : `새벽까지 ${left}초 · 남은 몬스터 ${R.enemies.length + R.toSpawn - R.spawned}`;
  }
  $('resPanel').innerHTML = ['gold', 'scrap', 'crystal'].map(k => `<div class="res res-${k}"><img src="design/icons/${k === 'gold' ? 'ui-coin' : 'res-' + k}.svg" alt=""><span>${RES_NAME[k]}</span><b>${kfmt(S[k])}</b></div>`).join('');
  $('gunName').textContent = g.name;
  const src = 'design/icons/' + g.icon + '.svg';
  if (!$('gunIcon').src.endsWith(src)) $('gunIcon').src = src;
  $('ammoTxt').textContent = R.reload > 0 ? '장전 중' : `${R.ammo} / ${g.mag}`;
  $('reloadBar').style.setProperty('--value', R.reload > 0 ? (1 - R.reload / g.reload) * 100 : R.ammo / g.mag * 100);
  const bb = $('bossBar');
  bb.hidden = !R.bossObj && !R.enemies.some(e => e.elite);
  const big = R.bossObj || R.enemies.find(e => e.elite);
  if (big) { $('bossName').textContent = big.name; $('bossHp').style.setProperty('--value', Math.max(0, big.hp / big.max * 100)); }
}

/* ================= 캠프 화면 ================= */
let hubTab = 'shop';
const costOf = (spec, lv) => {
  const c = {};
  for (const k in spec) { if (k === 'goldMult') continue; const [base, gr] = spec[k]; c[k] = Math.ceil(base * Math.pow(gr, lv) * (k === 'gold' ? E.shopDiscount : 1)); }
  return c;
};
const canPay = c => Object.keys(c).every(k => S[k] >= c[k] - 1e-9);
const pay = c => { for (const k in c) S[k] -= c[k]; };
const costHtml = c => Object.keys(c).length ? Object.keys(c).map(k => `<span class="cost">${kfmt(c[k])} ${RES_NAME[k]}</span>`).join('') : '<span class="cost">무료</span>';
const gunCost = g => { const c = {}; for (const k in g.cost) c[k] = Math.ceil(g.cost[k] * (k === 'gold' ? E.shopDiscount : 1)); return c; };

function goHub() {
  if (document.pointerLockElement) document.exitPointerLock();
  mode = 'hub'; R = null; paused = false;
  $('hud').hidden = true; $('joy').hidden = true; $('dashBtn').hidden = true;
  $('hub').hidden = false; $('title').hidden = true; $('modal').hidden = true;
  Snd.setMusicIntensity(0);
  view.setMode('hub', S);
  renderHub();
}
function renderHub() {
  refreshEff();
  $('hubEyebrow').textContent = `${S.day}일차 아침`;
  $('hubWallet').innerHTML = ['gold', 'scrap', 'crystal'].map(k => `<div class="gt-stat ${k === 'gold' ? 'gt-stat--money' : ''}"><img class="gt-icon gt-icon--sm" src="design/icons/${k === 'gold' ? 'ui-coin' : 'res-' + k}.svg" alt=""><span class="gt-stat__label">${RES_NAME[k]}</span><span class="gt-stat__value">${kfmt(S[k])}</span></div>`).join('') + `<div class="gt-stat"><img class="gt-icon gt-icon--sm" src="design/icons/ui-skill.svg" alt=""><span class="gt-stat__label">스킬</span><span class="gt-stat__value" style="color:var(--gt-purple)">${S.sp}</span></div>`;
  const L = S.last;
  const row = (a, b, cls = '') => `<span>${a}</span><b class="${cls}">${b}</b>`;
  if (L) {
    $('ledger').innerHTML = row(`${L.day}일차 밤`, L.survived ? '버팀' : '쓰러짐', L.survived ? 'hl' : 'bad') + row('처치한 몬스터', kfmt(L.kills)) + row('주운 골드', kfmt(L.loot.gold)) + (L.lost ? row('쓰러져서 잃은 골드', '−' + kfmt(L.lost), 'bad') : '') + row('모은 고철', kfmt(L.loot.scrap)) + (L.loot.crystal >= 1 ? row('모은 크리스탈', kfmt(L.loot.crystal)) : '') +
      '<hr>' + row('아침 생산 골드', '+' + kfmt(L.prod.gold), 'hl') + row('아침 생산 고철', '+' + kfmt(L.prod.scrap)) + row('하루 보상', '스킬 포인트 +1', 'hl');
  } else $('ledger').innerHTML = row('첫날', '') + '<span class="note">낮에는 고철 더미, 부서진 차량, 보급 상자 옆에 멈춰 서서 채집하세요. 밤에는 사방에서 몬스터가 달려옵니다.</span>';
  const pw = bestPower(), req = bossReq();
  $('powerNow').textContent = kfmt(pw); $('powerReq').textContent = kfmt(req);
  $('powerBar').style.setProperty('--value', clamp(pw / req * 100, 0, 100));
  $('btnNextDay').textContent = `${S.day}일차 시작`;
  $('btnBoss').textContent = S.won ? '보스 다시 잡기' : '보스에 도전하기';
  document.querySelectorAll('#hubTabs .gt-tab').forEach(b => {
    b.classList.toggle('is-active', b.dataset.tab === hubTab);
    if (b.dataset.tab === 'skill') b.textContent = 'SKILLS';
  });
  $('hubList').innerHTML = hubTab === 'skill' ? skillHtml() : hubTab === 'shop' ? shopHtml() : hubTab === 'gear' ? gearHtml() : buildHtml();
}
function card({ id, icon, tier, name, lv, desc, cost, state, label }) {
  const ok = cost && canPay(cost);
  const cls = state === 'max' ? 'is-maxed' : state === 'locked' ? 'is-locked' : state === 'equip' || state === 'equipped' ? (state === 'equipped' ? 'is-equipped' : '') : ok ? 'is-affordable' : 'is-expensive';
  const btn = state === 'max' ? '<button class="gt-card__price" disabled>최대</button>'
    : state === 'equipped' ? '<button class="gt-card__price" disabled>장착 중</button>'
    : state === 'equip' ? `<button class="gt-card__price" data-act="${id}">장착<small>보유</small></button>`
    : state === 'locked' ? `<button class="gt-card__price" disabled><img class="gt-icon gt-icon--sm" src="design/icons/ui-lock.svg" alt="">${label}</button>`
    : `<button class="gt-card__price" data-act="${id}">${costHtml(cost)}<small>${ok ? label || '구매' : '부족'}</small></button>`;
  return `<div class="gt-card gt-tier-${tier} ${cls}" id="card-${id}"><div class="gt-card__icon"><img src="design/icons/${icon}.svg" alt=""></div><div><div class="gt-card__name">${name}${lv ? `<span class="gt-card__level">${lv}</span>` : ''}</div><div class="gt-card__desc">${desc}</div></div>${btn}</div>`;
}
function shopHtml() {
  const guns = GUNS.map((g, i) => {
    const own = S.guns[g.id], st = gunStats(g.id), locked = !own && g.unlockDay > S.day;
    const desc = `피해 ${kfmt(st.dmg)}${g.pellets > 1 ? '×' + g.pellets : ''} · 초당 ${st.rate.toFixed(1)}발 · 탄창 ${st.mag} · 사거리 ${g.range}${st.hits > 1 ? ` · 관통 ${st.hits - 1}` : ''}<br>화력 <span class="up">${kfmt(power(g.id))}</span>`;
    return card({ id: 'gun-' + g.id, icon: st.icon, tier: st.tier, name: g.name, lv: `[${i + 1}]`, desc, cost: gunCost(g), state: own ? (S.gun === g.id ? 'equipped' : 'equip') : locked ? 'locked' : 'buy', label: locked ? `${g.unlockDay}일차` : '구매' });
  }).join('');
  const ups = D.shopUpgrades.filter(u => u.cat === '무기 강화').map(u => upCard(u, { power: 'ui-damage', rof: 'ui-firerate', mag: 'ui-ammo' }[u.id])).join('');
  return `<p class="sec-title">무기 강화 · 모든 총에 적용</p>${ups}<p class="sec-title">총기</p>${guns}`;
}
function upCard(u, icon) {
  const l = upLv(u.id), max = l >= u.max;
  return card({ id: 'up-' + u.id, icon, tier: Math.min(5, 1 + Math.floor(l / Math.max(2, u.max / 5))), name: u.name, lv: `Lv ${l}/${u.max}`, desc: u.desc, cost: costOf(u.cost, l), state: max ? 'max' : 'buy', label: '강화' });
}
function gearHtml() {
  const icons = { armor: 'ui-heart', boots: 'ui-upgrade', tools: 'ui-worker', medkit: 'ui-heart' };
  return `<p class="sec-title">장비 · 고철로 삽니다</p>` + D.shopUpgrades.filter(u => u.cat === '장비').map(u => upCard(u, icons[u.id])).join('') +
    `<p class="sec-title">지금 체력 ${Math.round(maxHp())} · 방어 ${Math.round(armorVal())} · 채집 속도 ×${gatherRate().toFixed(2)}</p>`;
}
function buildHtml() {
  const icons = { scrapper: 'ui-factory', shop: 'ui-coin', turret: 'ui-damage', barricade: 'ui-lock', lamp: 'ui-sun', turretup: 'ui-upgrade' };
  return '<p class="sec-title">캠프 시설 · 매일 아침 생산하거나 밤에 캠프를 지킵니다</p>' + D.buildings.map(b => {
    const n = bLv(b.id), max = n >= b.max, locked = b.unlockDay > S.day;
    let info = b.desc;
    if (b.produces) { const k = Object.keys(b.produces)[0]; const per = b.produces[k] * E.buildingMult * (k === 'gold' && b.cost.goldMult ? Math.pow(b.cost.goldMult, S.day - 1) : 1); info += `<br>하루 ${RES_NAME[k]} <span class="up">+${kfmt(per)}</span>/개 · 지금 ${kfmt(per * n)}`; }
    if (b.id === 'turret') info += `<br>포탑 ${n}개 · 개당 초당 피해 ${kfmt(b.dps * (1 + 0.12 * upLv('power')) * Math.pow(1.35, bLv('turretup')))}`;
    return card({ id: 'bld-' + b.id, icon: icons[b.id], tier: Math.min(5, 1 + Math.floor(n / 3)), name: b.name, lv: `${n}/${b.max}`, desc: info, cost: costOf(b.cost, n), state: max ? 'max' : locked ? 'locked' : 'buy', label: locked ? `${b.unlockDay}일차` : n ? '증설' : '건설' });
  }).join('');
}
function skillHtml() {
  return `<p class="sp-note">스킬 포인트 <b>${S.sp}</b> · 매일 아침 1점, 엘리트를 잡으면 1점을 더 얻습니다. 앞 칸을 배워야 다음 칸이 열립니다.</p><div class="tree">` + BRANCHES.map(br => `<div class="branch"><h4>${br}</h4>` + SKILLS.filter(s => s.branch === br).map(s => {
    const have = !!S.skills[s.id], open = s.requires.every(r => S.skills[r]);
    const cls = have ? 'max' : !open ? 'locked' : S.sp >= s.cost ? 'can' : '';
    const req = s.requires.length ? `<em>필요: ${s.requires.map(r => SKILLS.find(x => x.id === r).name).join(', ')}</em>` : '';
    return `<button class="skill ${cls}" data-act="sk-${s.id}"><span class="skill-top"><b>${s.name}</b><span class="skill-cost">${have ? '배움' : s.cost + '점'}</span></span><small>${s.desc}</small>${req}</button>`;
  }).join('') + '</div>').join('') + '</div>';
}
function hubAction(act) {
  const [kind, id] = [act.slice(0, act.indexOf('-')), act.slice(act.indexOf('-') + 1)];
  if (kind === 'gun') {
    const g = GUNS.find(x => x.id === id);
    if (S.guns[id]) { S.gun = id; sfx('click'); }
    else { if (g.unlockDay > S.day) return deny(); const c = gunCost(g); if (!canPay(c)) return deny(); pay(c); S.guns[id] = true; S.gun = id; sfx('buy'); toast(`${g.name} 구매`, 'gold'); }
  } else if (kind === 'up') {
    const u = D.shopUpgrades.find(x => x.id === id), c = costOf(u.cost, upLv(id));
    if (upLv(id) >= u.max || !canPay(c)) return deny(); pay(c); S.up[id] = upLv(id) + 1; sfx('upgrade');
  } else if (kind === 'bld') {
    const b = D.buildings.find(x => x.id === id), c = costOf(b.cost, bLv(id));
    if (bLv(id) >= b.max || b.unlockDay > S.day || !canPay(c)) return deny(); pay(c); S.build[id] = bLv(id) + 1; sfx('buy'); toast(`${b.name} ${S.build[id]}개`, 'gold');
  } else if (kind === 'sk') {
    const s = SKILLS.find(x => x.id === id);
    if (S.skills[id] || S.sp < s.cost || !s.requires.every(r => S.skills[r])) return deny();
    S.sp -= s.cost; S.skills[id] = true; sfx('upgrade'); toast(`${s.name} 습득`, 'gold');
  }
  refreshEff(); save();
  if (mode === 'hub' && !bot.on) {
    renderHub(); view.setMode('hub', S);
    const el = document.getElementById('card-' + act); if (el) { el.classList.remove('gt-level-up'); void el.offsetWidth; el.classList.add('gt-level-up'); }
  }
  return true;
}
function deny() { sfx('click', { pitch: 0.5 }); return false; }

/* ================= 모달, 토스트 ================= */
function toast(txt, kind = '') {
  if (bot.on) return;
  const el = document.createElement('div'); el.className = 'gt-toast' + (kind ? ' gt-toast--' + kind : ''); el.textContent = txt;
  const st = $('toasts'); st.appendChild(el); while (st.children.length > 3) st.firstChild.remove();
  el.addEventListener('animationend', () => el.remove(), { once: true });
}
function showModal(html, cls = '') { $('modalBox').className = 'gt-modal ' + cls; $('modalBox').innerHTML = html; $('modal').hidden = false; }
function showWin() {
  const m = Math.floor(S.stats.played / 60);
  $('ending').hidden = false; $('hud').hidden = true;
  const st = [['버틴 날', `${S.day - 1}일`], ['플레이 시간', `${Math.floor(m / 60)}시간 ${m % 60}분`], ['처치한 몬스터', kfmt(S.stats.kills)], ['번 골드', kfmt(S.stats.goldTotal)], ['보스 도전', `${S.stats.bossTries}번`], ['쓰러진 밤', `${S.stats.deaths}번`]];
  $('endStats').innerHTML = st.map(([a, b]) => `<div class="gt-ending__stat"><b>${b}</b><span>${a}</span></div>`).join('');
  Snd.play('upgrade');
}

/* ================= 흐름 ================= */
function startDay(kind) {
  refreshEff();
  if (kind === 'boss') S.stats.bossTries++;
  makeRun(kind);
  mode = 'run'; paused = false;
  if (bot.on) return;
  $('hub').hidden = true; $('title').hidden = true; $('modal').hidden = true; $('ending').hidden = true; $('hud').hidden = false;
  $('dashBtn').hidden = !touchMode;
  view.setMode('run', S, R);
  Snd.startMusic(); Snd.setMusicIntensity(kind === 'boss' ? 2 : 1);
  if (kind === 'boss') { toast(`결전: ${D.boss.name}`, 'red'); sfx('warning', { pulses: 5 }); }
  else toast(`${S.day}일차 아침`, 'gold');
  updateHud();
}
function setPause(v) {
  if (mode !== 'run' || !R || R.over) return;
  paused = v;
  if (v) showModal(`<h2>일시정지</h2><p>${R.boss ? '보스전' : S.day + '일차'} 진행 중입니다.</p><div class="acts"><button class="gt-btn gt-btn--primary" data-act="resume">계속</button><button class="gt-btn gt-btn--ghost" data-act="mute">${Snd.isMuted() ? '소리 켜기' : '소리 끄기'}</button><button class="gt-btn gt-btn--ghost" data-act="giveup">${R.boss ? '포기하고 캠프로' : '오늘은 접고 캠프로'}</button></div>`);
  else { $('modal').hidden = true; lockPointer(); }
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'hub') { $('modal').hidden = true; $('ending').hidden = true; goHub(); }
  else if (a === 'resume') setPause(false);
  else if (a === 'giveup') { $('modal').hidden = true; paused = false; if (R.boss) { R.over = true; goHub(); } else endDay(false); }
  else if (a === 'mute') { Snd.toggleMute(); setPause(true); }
  else if (a === 'reset') { if (b.dataset.confirm) { S = newState(); refreshEff(); save(); $('ending').hidden = true; goHub(); } else { b.dataset.confirm = '1'; b.textContent = '한 번 더 누르면 기록을 모두 지웁니다'; } }
  else if (mode === 'hub') hubAction(a);
});
$('hubTabs').addEventListener('click', ev => { const t = ev.target.closest('.gt-tab'); if (!t) return; hubTab = t.dataset.tab; sfx('click'); renderHub(); });
$('btnNextDay').onclick = () => startDay('day');
$('btnBoss').onclick = () => {
  const pw = bestPower();
  if (pw < bossReq() * 0.5 && !$('btnBoss').dataset.warned) { $('btnBoss').dataset.warned = '1'; $('btnBoss').textContent = '화력이 많이 부족합니다. 그래도 도전'; return; }
  delete $('btnBoss').dataset.warned; startDay('boss');
};
let hasSave = false;
$('btnNew').onclick = () => {
  if (hasSave && !$('btnNew').dataset.confirm) { $('btnNew').dataset.confirm = '1'; $('btnNew').textContent = '저장을 지우고 새로 시작'; return; }
  S = newState(); refreshEff(); save(); startDay('day');
};
$('btnContinue').onclick = () => goHub();
$('btnPause').onclick = () => setPause(true);
$('btnSound').onclick = () => { const m = Snd.toggleMute(); $('btnSound').textContent = m ? '소리 꺼짐' : '소리 켜짐'; };

window.addEventListener('keydown', ev => {
  keys[ev.code] = true;
  if (mode !== 'run') return;
  if (ev.code === 'Space' || ev.code === 'ShiftLeft') { input.dash = true; ev.preventDefault(); }
  if (ev.code === 'KeyR') input.reload = true;
  if (ev.code === 'Escape' || ev.code === 'KeyP') setPause(!paused);
  const owned = GUNS.filter(g => S.guns[g.id]);
  const n = parseInt(ev.key, 10);
  if (n >= 1 && n <= 9) { const g = GUNS[n - 1]; if (g && S.guns[g.id] && R && !R.over) { S.gun = g.id; R.ammo = gunStats(S.gun).mag; R.reload = 0; R.cd = 0.25; sfx('click'); } }
  if (ev.code === 'KeyQ' && owned.length > 1 && R) { const i = owned.findIndex(g => g.id === S.gun); S.gun = owned[(i + 1) % owned.length].id; R.ammo = gunStats(S.gun).mag; R.reload = 0; R.cd = 0.25; }
});
window.addEventListener('keyup', ev => { keys[ev.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; if (mode === 'run' && !paused) setPause(true); });
const cv = $('ov');
cv.addEventListener('pointermove', ev => {
  if (ev.pointerType !== 'mouse') return;
  touchMode = false;
  if (locked) { if (R && mode === 'run' && !paused) R.p.ang += ev.movementX * SENS; return; }
  mouse.x = ev.clientX; mouse.y = ev.clientY;
});
// 마우스를 화면 가운데에 고정한다 (포인터 잠금). ESC로 풀리면 일시정지
function lockPointer() { if (touchMode || locked || mode !== 'run') return; try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === cv;
  if (!locked && mode === 'run' && R && !R.over && !paused) setPause(true);
});
cv.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse') { mouse.down = ev.button === 0; if (!locked) { mouse.x = ev.clientX; mouse.y = ev.clientY; lockPointer(); } touchMode = false; $('dashBtn').hidden = true; return; }
  touchMode = true; if (mode === 'run') $('dashBtn').hidden = false;
  if (joy.id === null) { joy.id = ev.pointerId; joy.ox = ev.clientX; joy.oy = ev.clientY; joy.x = joy.y = 0; const j = $('joy'); j.hidden = mode !== 'run'; j.style.left = ev.clientX + 'px'; j.style.top = ev.clientY + 'px'; j.firstElementChild.style.transform = 'translate(-50%,-50%)'; }
  try { cv.setPointerCapture(ev.pointerId); } catch (e) {}
});
cv.addEventListener('pointermove', ev => {
  if (ev.pointerId !== joy.id) return;
  const dx = ev.clientX - joy.ox, dy = ev.clientY - joy.oy, m = Math.hypot(dx, dy), r = 50, k = m > r ? r / m : 1;
  joy.x = dx * k / r; joy.y = dy * k / r;
  $('joy').firstElementChild.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
});
const endJoy = ev => { if (ev.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; $('joy').hidden = true; } };
cv.addEventListener('pointerup', endJoy); cv.addEventListener('pointercancel', endJoy);
window.addEventListener('pointerup', ev => { if (ev.pointerType === 'mouse') mouse.down = false; });
$('dashBtn').addEventListener('pointerdown', ev => { ev.stopPropagation(); input.dash = true; });
cv.addEventListener('contextmenu', ev => ev.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'run' && !paused) setPause(true); });

/* ================= 자동 플레이 (밸런스 확인용) ================= */
function botMove() {
  const p = R.p;
  let tx = CAMP.x, ty = CAMP.y;
  if (R.phase === 'day') {
    if (p.gathering) return { x: 0, y: 0 };
    let best = null, bd = 1e12;
    for (const n of R.nodes) { const v = { car: 2.2, ammo: 1.6, crystal: 4, scrap: 1 }[n.type]; const d = dist2(n, p) / v; if (d < bd) { bd = d; best = n; } }
    if (best) { tx = best.x; ty = best.y; }
  } else {
    let near = null, nd = 1e12;
    for (const e of R.enemies) { const d = dist2(e, p); if (d < nd) { nd = d; near = e; } }
    const t = R.t * 0.45;
    tx = CAMP.x + Math.cos(t) * 220; ty = CAMP.y + Math.sin(t) * 220;
    if (near && nd < (near.boss ? 420 : 180) ** 2) { tx = p.x - (near.x - p.x); ty = p.y - (near.y - p.y); if (nd < (near.r + 60) ** 2) input.dash = true; }
  }
  const dx = tx - p.x, dy = ty - p.y, m = Math.hypot(dx, dy);
  return m < 20 ? { x: 0, y: 0 } : { x: dx / m, y: dy / m };
}
function botShop() {
  for (let guard = 0; guard < 300; guard++) {
    const opts = [];
    GUNS.forEach(g => { if (!S.guns[g.id] && g.unlockDay <= S.day) opts.push({ act: 'gun-' + g.id, c: gunCost(g), w: 0.5 }); });
    D.shopUpgrades.forEach(u => { if (upLv(u.id) < u.max) opts.push({ act: 'up-' + u.id, c: costOf(u.cost, upLv(u.id)), w: u.cat === '장비' ? 1 : 1 }); });
    D.buildings.forEach(b => { if (bLv(b.id) < b.max && b.unlockDay <= S.day) opts.push({ act: 'bld-' + b.id, c: costOf(b.cost, bLv(b.id)), w: 1 }); });
    const af = opts.filter(o => canPay(o.c));
    if (!af.length) break;
    const val = o => ((o.c.gold || 0) + (o.c.scrap || 0) * 3 + (o.c.crystal || 0) * 500) * o.w;
    af.sort((a, b) => val(a) - val(b));
    hubAction(af[0].act);
  }
  let best = S.gun; for (const g of GUNS) if (S.guns[g.id] && power(g.id) > power(best)) best = g.id; S.gun = best;
  for (let i = 0; i < 30; i++) { const s = SKILLS.find(s => !S.skills[s.id] && S.sp >= s.cost && s.requires.every(r => S.skills[r])); if (!s) break; hubAction('sk-' + s.id); }
}

/* ================= 루프 ================= */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (mode === 'run' && !paused && R && !R.over) { step(dt); hudT += dt; if (hudT > 0.1) { hudT = 0; updateHud(); } }
  view.render(dt, { mode, R, S, locked, yaw: locked && R ? R.p.ang : -Math.PI / 2, aim: !touchMode && mode === 'run' ? (locked ? { x: innerWidth / 2, y: innerHeight * 0.42 } : mouse) : null, gun: S.gun, gunIcon: GUN_ICON[S.gun], eff: E, lamps: bLv('lamp') });
  requestAnimationFrame(frame);
}
hasSave = load();
$('btnContinue').hidden = !hasSave;
if (hasSave) $('btnNew').classList.replace('gt-btn--primary', 'gt-btn--ghost');
if (touchMode) $('titleKeys').textContent = '손가락으로 끌어서 이동 · 조준과 사격은 자동 · 오른쪽 버튼으로 구르기';
view.setMode('title', S);
document.body.classList.add('is-ready');
requestAnimationFrame(frame);

window.__game = {
  get S() { return S; }, get R() { return R; }, get mode() { return mode; }, D,
  bot, step, botShop, startDay, goHub, power, bestPower, bossReq, setState(s) { S = Object.assign(newState(), s); refreshEff(); },
  simDay(kind = 'day') {
    bot.on = true; bot.fast = true;
    startDay(kind); let guard = 0;
    while (mode === 'run' && R && !R.over && guard++ < 40000) step(1 / 30);
    return { day: S.day, won: S.won, last: S.last, hp: R && R.p.hp, bossLeft: R && R.bossObj ? R.bossObj.hp / R.bossObj.max : null };
  },
};
