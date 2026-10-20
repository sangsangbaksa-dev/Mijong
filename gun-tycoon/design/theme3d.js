// 총 타이쿤 3D 맵 연출 값 (three.js 용 데이터만, 게임 로직 없음)
// 사용 예:
//   import { PHASES, MONSTERS, applyPhase } from './design/theme3d.js';
//   applyPhase(THREE, scene, { sun, ambient, hemi }, 'night');
// 낮/밤 전환은 lerpPhase 로 두 페이즈 값을 섞어 매 프레임 적용하면 부드럽게 바뀝니다.

export const PHASES = {
  //            하늘색      안개색      안개 시작/끝   태양 색     태양 세기  환경광 세기  반구광(하늘/땅)            손전등
  day:   { sky: 0x8fc8ff, fog: 0xb8dcff, fogNear: 40, fogFar: 180, sun: 0xfff1d0, sunI: 2.2, ambI: 0.55, hemiSky: 0xcfe8ff, hemiGround: 0x5a7a3a, hemiI: 0.6, torchI: 0 },
  dusk:  { sky: 0xff9a5a, fog: 0x9a5a7a, fogNear: 30, fogFar: 140, sun: 0xff8a4a, sunI: 1.2, ambI: 0.35, hemiSky: 0xffb38a, hemiGround: 0x3a2a3a, hemiI: 0.45, torchI: 0.6 },
  night: { sky: 0x0a0e24, fog: 0x0a0e24, fogNear: 12, fogFar: 70,  sun: 0x6d7fc9, sunI: 0.25, ambI: 0.12, hemiSky: 0x2b3466, hemiGround: 0x0a0a12, hemiI: 0.25, torchI: 3.0 },
  dawn:  { sky: 0x9fb2ff, fog: 0xc9b2c9, fogNear: 30, fogFar: 150, sun: 0xffc0a0, sunI: 1.0, ambI: 0.35, hemiSky: 0xc9d4ff, hemiGround: 0x4a4a3a, hemiI: 0.45, torchI: 0.4 },
  boss:  { sky: 0x2a0508, fog: 0x3a0a10, fogNear: 15, fogFar: 90,  sun: 0xff3a3a, sunI: 0.8, ambI: 0.2,  hemiSky: 0x6a1a2a, hemiGround: 0x100005, hemiI: 0.35, torchI: 2.0 },
};

// 플레이어가 들고 다니는 손전등 (밤에 SpotLight 또는 PointLight 로)
export const TORCH = { color: 0xffe2a8, distance: 22, angle: Math.PI / 5, penumbra: 0.6 };

// 몬스터 스프라이트 (THREE.Sprite 로 빌보드 처리). scale 은 월드 단위(미터)
export const MONSTERS = {
  slime:  { img: 'design/assets/monster-slime.png',  scale: 1.2, name: '슬라임',   eyeGlow: 0x9af0a0 },
  zombie: { img: 'design/assets/monster-zombie.png', scale: 1.8, name: '좀비',     eyeGlow: 0xffe36b },
  wolf:   { img: 'design/assets/monster-wolf.png',   scale: 1.6, name: '그림자 늑대', eyeGlow: 0xff4a4a },
  bat:    { img: 'design/assets/monster-bat.png',    scale: 1.4, name: '흡혈 박쥐', eyeGlow: 0xff4a4a, fly: 2.2 },
  brute:  { img: 'design/assets/monster-brute.png',  scale: 3.0, name: '오우거',   eyeGlow: 0xff7a1a },
  boss:   { img: 'design/assets/monster-boss.png',   scale: 7.0, name: '심연의 군주', eyeGlow: 0xff3a3a },
};

// 플레이어 (3인칭 뒷모습 스프라이트). 카메라는 플레이어 뒤 위쪽에서 따라가면 이 그림과 각도가 맞습니다
export const PLAYER = { img: 'design/assets/player-back.png', portrait: 'design/assets/player-portrait.png', scale: 1.9, camera: { back: 6, up: 4, lookAhead: 6 } };

// 바닥 텍스처: RepeatWrapping, 4m 마다 한 번 반복
export const GROUND = { img: 'design/assets/tex-grass-seamless.jpg', metersPerTile: 4 };

const COLOR_KEYS = new Set(['sky', 'fog', 'sun', 'hemiSky', 'hemiGround']);

export function lerpPhase(a, b, t) {
  const A = PHASES[a], B = PHASES[b], out = {};
  for (const k in A) {
    const x = A[k], y = B[k];
    if (COLOR_KEYS.has(k)) {
      const r = ((x >> 16) & 255) + ((((y >> 16) & 255) - ((x >> 16) & 255)) * t);
      const g = ((x >> 8) & 255) + ((((y >> 8) & 255) - ((x >> 8) & 255)) * t);
      const bl = (x & 255) + (((y & 255) - (x & 255)) * t);
      out[k] = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
    } else {
      out[k] = x + (y - x) * t;
    }
  }
  return out;
}

// p: PHASES 값 또는 lerpPhase 결과 / lights: { sun, ambient, hemi, torch } 중 있는 것만
export function applyPhase(THREE, scene, lights, p) {
  if (typeof p === 'string') p = PHASES[p];
  scene.background = new THREE.Color(p.sky);
  if (!scene.fog) scene.fog = new THREE.Fog(p.fog, p.fogNear, p.fogFar);
  scene.fog.color.setHex(p.fog); scene.fog.near = p.fogNear; scene.fog.far = p.fogFar;
  if (lights.sun)     { lights.sun.color.setHex(p.sun); lights.sun.intensity = p.sunI; }
  if (lights.ambient) { lights.ambient.intensity = p.ambI; }
  if (lights.hemi)    { lights.hemi.color.setHex(p.hemiSky); lights.hemi.groundColor.setHex(p.hemiGround); lights.hemi.intensity = p.hemiI; }
  if (lights.torch)   { lights.torch.intensity = p.torchI; }
}
