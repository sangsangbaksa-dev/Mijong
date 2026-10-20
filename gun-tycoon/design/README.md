# 총 타이쿤 비주얼 디자인

게임 코드에서 가져다 쓰는 스타일과 아이콘입니다. 외부 라이브러리 없이 CSS와 SVG만 씁니다.
모든 클래스는 `gt-` 접두어를 붙여 게임 코드의 클래스와 겹치지 않게 했습니다.

```
design/
├── style.css           색상, 폰트, HUD, 상점, 낮/밤 월드, 허브, 스킬트리, 보스, 엔딩, 이펙트
├── theme3d.js          3D 맵(three.js)용 낮/밤/보스 조명·안개 값과 몬스터 스프라이트 목록
├── map-ground.svg      2D 바닥 타일 (SVG 대체본)
├── assets/             Canva로 만든 몬스터·보스 PNG, 잔디 텍스처, 허브/엔딩 배경 (SOURCES.md 참고)
├── icons/              총기, 몬스터(SVG 대체본), 자원, 맵 오브젝트, UI 아이콘 (64×64 SVG)
├── preview.html        HUD, 상점 미리보기
├── preview-world.html  밤 전투, 낮 채집, 보스전, 허브, 엔딩 미리보기
└── README.md
```

게임 구조 기준: 넓은 맵(3D)에서 낮에는 자원을 캐고 밤에는 달려오는 몬스터를 쏜다. 하루가 끝나면 허브(2D)에서 상점과 스킬트리를 쓰고, 보스에 도전해 이기면 엔딩.

## 1. 연결하기

```html
<link rel="stylesheet" href="design/style.css">
<body class="gt"> ... </body>
```

폰트는 style.css 맨 위에서 Google Fonts로 불러옵니다. 오프라인이면 시스템 고딕으로 대체됩니다.

| 용도 | 폰트 | 변수 |
|---|---|---|
| 제목, 로고 | Black Han Sans | `--gt-font-display` |
| 본문, 버튼 | Noto Sans KR | `--gt-font-body` |
| 숫자(돈, 피해량) | JetBrains Mono | `--gt-font-num` |

## 2. 색상

어두운 군수공장 배경에 황동색(골드)을 돈과 구매 버튼에만 씁니다.

| 변수 | 값 | 쓰는 곳 |
|---|---|---|
| `--gt-bg` / `--gt-bg-2` | #12141a / #1a1d25 | 페이지 / 패널 배경 |
| `--gt-surface` / `--gt-surface-2` | #232733 / #2d3241 | 카드 / 카드 hover |
| `--gt-gold` | #f2b632 | 자금, 구매 버튼 |
| `--gt-red` | #e5484d | 피해, 적 체력 |
| `--gt-orange` | #ff7a1a | 치명타, 총구 화염, 웨이브 |
| `--gt-green` | #46c46e | 수입, 회복, 최대 레벨 |
| `--gt-blue` | #3fa7ff | 탄약, 장전 |
| `--gt-tier-1` ~ `--gt-tier-5` | 회색 → 초록 → 파랑 → 보라 → 금색 | 일반 · 고급 · 희귀 · 영웅 · 전설 |

## 3. 레이아웃

```html
<div class="gt-layout">
  <header class="gt-hud">…</header>        <!-- 맨 위 한 줄 -->
  <main class="gt-arena">…</main>          <!-- 왼쪽 전투 화면 (position:relative) -->
  <aside class="gt-shop gt-panel">…</aside> <!-- 오른쪽 340px 상점 -->
</div>
```
820px 이하 화면에서는 위에서 아래로 HUD, 전투, 상점 순서로 쌓입니다.

## 4. HUD

```html
<div class="gt-stat gt-stat--money">
  <img class="gt-icon" src="design/icons/ui-coin.svg" alt="">
  <span class="gt-stat__label">자금</span>
  <span class="gt-stat__value">12,480</span>
</div>
```
- 종류: `gt-stat--money`(골드) `gt-stat--income`(초록) `gt-stat--ammo`(파랑) `gt-stat--wave`(주황)
- `gt-hud__spacer`를 사이에 넣으면 뒤 항목이 오른쪽으로 밀립니다.

**진행 바**: 값은 CSS 변수 `--value`(0~100)로 넣습니다.
```html
<div class="gt-bar gt-bar--hp" style="--value:80"></div>
```
```js
bar.style.setProperty('--value', hp / maxHp * 100);
```
종류: `gt-bar--hp` `gt-bar--reload` `gt-bar--xp` `gt-bar--wave`, 굵게 `gt-bar--lg`

## 5. 전투 화면과 적

```html
<div class="gt-enemy" style="left:220px; top:140px">   <!-- left/top = 적 중심 -->
  <div class="gt-bar gt-bar--hp" style="--value:100"></div>
  <img src="design/icons/enemy-grunt.svg" alt="병사">
</div>
```
보스는 `gt-enemy gt-enemy--boss` (128px). 적은 `transform: translate(-50%,-50%)`로 중심 정렬되므로, 이동은 `left/top`으로 하세요.

## 6. 상점 카드

```html
<div class="gt-card gt-tier-2 is-affordable">
  <div class="gt-card__icon"><img src="design/icons/gun-smg.svg" alt=""></div>
  <div>
    <div class="gt-card__name">기관단총<span class="gt-card__level">Lv.4</span></div>
    <div class="gt-card__desc">연사 속도 +15%</div>
  </div>
  <button class="gt-card__price">1,200<small>구매</small></button>
</div>
```

| 상태 클래스 | 모양 | 버튼 글자 예시 |
|---|---|---|
| (없음) | 기본 | 구매 |
| `is-affordable` | 금색 테두리 빛 (원하면 `gt-pulse` 추가로 깜빡임) | 구매 |
| `is-expensive` | 가격 버튼 회색 | 부족 |
| `is-locked` | 카드 전체 흐리게 + 흑백 | 잠김 (`ui-lock.svg`) |
| `is-maxed` | 가격 버튼 초록 테두리 | 최대 |

등급은 `gt-tier-1` ~ `gt-tier-5`로 왼쪽 띠와 아이콘 배경, 레벨 글자색이 바뀝니다.
상점 탭은 `<nav class="gt-tabs"><button class="gt-tab is-active">총기</button>…</nav>`, 탭 이름 제안은 총기 · 강화 · 공장 · 특수입니다.

## 7. 버튼, 배지, 모달, 토스트

- 버튼: `gt-btn` + `gt-btn--primary`(골드) / `gt-btn--danger`(빨강) / `gt-btn--ghost` / `gt-btn--sm`. `disabled`면 자동으로 흐려집니다.
- 배지: `gt-badge` (빨강), `gt-badge--new` (주황), `gt-badge--gold`
- 모달: `<div class="gt-modal-backdrop"><div class="gt-modal">…</div></div>` (웨이브 클리어, 오프라인 수익 등)
- 토스트: `<div class="gt-toast-stack">` 안에 `<div class="gt-toast gt-toast--gold">강화 완료!</div>`를 넣으면 2.2초 뒤 사라집니다. 끝나면 `animationend`에서 제거하세요.

## 8. 아이콘 목록

| 파일 | 내용 | 추천 등급 |
|---|---|---|
| `gun-pistol.svg` | 권총 | 1 |
| `gun-smg.svg` | 기관단총 | 2 |
| `gun-shotgun.svg` | 산탄총 | 2 |
| `gun-rifle.svg` | 돌격소총 | 3 |
| `gun-sniper.svg` | 저격총 | 4 |
| `gun-minigun.svg` | 미니건 | 4 |
| `gun-laser.svg` | 레이저 소총 | 5 |
| `enemy-target.svg` | 연습용 과녁 (튜토리얼) | |
| `monster-*.svg` | 몬스터 SVG 대체본 (slime, zombie, wolf, bat, brute, boss). 기본은 `assets/monster-*.png` | |
| `player.svg` | 플레이어 | |
| `res-wood/stone/scrap/crystal.svg` | 자원 4종 (나무, 돌, 고철, 수정) | |
| `node-tree/rock/scrap.svg` | 낮에 캐는 자원 노드 | |
| `deco-grass.svg` | 맵 장식 | |
| `ui-sun.svg` `ui-moon.svg` | 낮 / 밤 | |
| `ui-skull.svg` | 보스 도전 | |
| `ui-skill.svg` | 스킬트리 | |
| `ui-trophy.svg` | 엔딩 | |
| `ui-heart.svg` | 체력 | |
| `ui-coin.svg` | 자금 | |
| `ui-ammo.svg` | 탄약 | |
| `ui-factory.svg` | 공장 / 초당 수익 | |
| `ui-worker.svg` | 직원 고용 | |
| `ui-damage.svg` | 피해량 강화 | |
| `ui-firerate.svg` | 연사 속도 강화 | |
| `ui-crit.svg` | 치명타 강화 | |
| `ui-upgrade.svg` | 일반 강화 / 레벨 업 | |
| `ui-lock.svg` | 잠김 | |

총기는 모두 오른쪽을 향합니다. 왼쪽을 보게 하려면 `transform: scaleX(-1)`.
`<img src>`로 써도 되고, 색을 바꾸고 싶으면 SVG 내용을 HTML에 직접 넣어도 됩니다.

## 9. 애니메이션 가이드

원칙: 쏘는 손맛은 짧고 강하게(100~250ms), 돈과 강화는 조금 길고 화려하게(600ms 이상). 한 번에 화면 흔들림이 겹치지 않게 합니다.

| 상황 | 클래스 | 붙이는 곳 | 길이 |
|---|---|---|---|
| 발사 반동 | `gt-recoil` | 총 이미지 | 110ms |
| 총구 화염 | `gt-muzzle` (새 요소) | 총구 좌표 | 90ms |
| 탄피/파편 | `gt-spark` (새 요소, `--dx` `--dy` 지정) | 탄착점 | 450ms |
| 적 피격 | `gt-hit` | `.gt-enemy` | 160ms |
| 피해 숫자 | `gt-float` / 치명타 `gt-float--crit` | 전투 화면 안 새 요소 | 800ms |
| 돈 획득 숫자 | `gt-float gt-float--money` | 적이 죽은 자리 | 800ms |
| 적 처치 | `gt-die` | `.gt-enemy`, 끝나면 제거 | 380ms |
| 보스 피격, 폭발 | `gt-shake` | `.gt-arena` | 260ms |
| 자금 증가 | `gt-bump` | `.gt-stat__value` | 220ms |
| 구매 가능 알림 | `gt-pulse` | `.gt-card` | 반복 |
| 강화 성공 | `gt-level-up` | `.gt-card` + 토스트 | 700ms |

**같은 애니메이션을 다시 재생하는 법** (클래스를 뺐다가 다시 넣기):
```js
function play(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;          // 리플로우로 애니메이션 리셋
  el.classList.add(cls);
}
```

**한 번 쓰고 지우는 이펙트** (피해 숫자, 화염, 파편):
```js
function spawn(parent, cls, x, y, text = '') {
  const el = document.createElement('div');
  el.className = cls;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.textContent = text;
  parent.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
  return el;
}
spawn(arena, 'gt-float gt-float--crit', x, y, '-512!');
```

추가 팁
- 연사가 빠른 총(미니건)은 피해 숫자를 매 발마다 띄우지 말고 100ms마다 합쳐서 띄우면 화면이 덜 지저분합니다.
- 큰 숫자는 `1.2만`, `3.4억`처럼 한국식 단위로 줄이면 HUD 폭이 유지됩니다.
- 사용자가 "동작 줄이기"를 켜 두면 모든 애니메이션이 자동으로 거의 꺼집니다.

## 10. 몬스터와 보스 (Canva 아트)

| 파일 | 이름 제안 | 성격 | 2D 클래스 | 3D 크기(m) |
|---|---|---|---|---|
| `assets/monster-slime.png` | 슬라임 | 느리고 약함, 1일차부터 | `gt-enemy--slime` | 1.2 |
| `assets/monster-zombie.png` | 좀비 | 기본 몬스터 | `gt-enemy--zombie` | 1.8 |
| `assets/monster-wolf.png` | 그림자 늑대 | 빠름, 무리 | `gt-enemy--wolf` | 1.6 |
| `assets/monster-bat.png` | 흡혈 박쥐 | 공중, 위아래로 흔들림 | `gt-enemy--bat` | 1.4 |
| `assets/monster-brute.png` | 오우거 | 느리고 튼튼, 후반 | `gt-enemy--brute` | 3.0 |
| `assets/monster-boss.png` | 심연의 군주 | 최종 보스 | `gt-enemy--boss` | 7.0 |

```html
<div class="gt-enemy gt-enemy--wolf" style="left:780px; top:360px">
  <div class="gt-bar gt-bar--hp" style="--value:40"></div>
  <img src="design/assets/monster-wolf.png" alt="그림자 늑대">
</div>
```

## 11. 월드 화면 (2D로 그릴 때)

```html
<div class="gt-world" data-phase="night" style="--light-x:45%; --light-y:62%">
  <div class="gt-world__map gt-world__map--grass"> 플레이어, 몬스터, 노드 (맵 좌표 px) </div>
  <div class="gt-world__tint"></div>
  <div class="gt-world__fx"></div>
  <div class="gt-overlay"><div class="gt-hud">…</div></div>
  <div class="gt-minimap">…</div>
</div>
```
- `data-phase`: `day` → `dusk` → `night` → `dawn`, 보스전은 `boss`. 바꾸면 색이 2.5초에 걸쳐 바뀝니다.
- 카메라: `map.style.transform = \`translate(${-camX}px, ${-camY}px)\``
- 밤 손전등: 플레이어 화면 좌표를 `--light-x`, `--light-y`에, 반지름을 `--light-r`(기본 220px)에. 손전등 강화 스킬로 키우면 좋습니다.
- 맵 위 요소: `gt-player`(`is-left`로 좌우 반전), `gt-node`(`is-harvesting`, `is-depleted`), `gt-pickup`(둥실거리는 드롭), `gt-deco`
- 화면 밖 몬스터 화살표: `<div class="gt-offscreen" style="left:98%;top:30%;--angle:90deg">`, 보스는 `gt-offscreen--boss`
- 플레이어 피격: world에 `gt-hurt`를 200ms 붙였다 떼기

## 12. 3D 맵 (three.js)

3D 모델 파일 없이, 바닥은 Canva 잔디 텍스처를 깐 평면이고 몬스터는 Canva PNG를 `THREE.Sprite`(항상 카메라를 보는 판)로 세웁니다. 2D 아트가 3D 공간에서 달려오는 "2.5D" 느낌이고, 가볍고 웹에서 바로 돌아갑니다.

```js
import { PHASES, MONSTERS, GROUND, TORCH, applyPhase, lerpPhase } from './design/theme3d.js';

const tex = new THREE.TextureLoader().load(GROUND.img);
tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
tex.repeat.set(mapSize / GROUND.metersPerTile, mapSize / GROUND.metersPerTile);

const m = MONSTERS.wolf;
const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.TextureLoader().load(m.img), transparent: true }));
sprite.scale.set(m.scale, m.scale, 1);
sprite.position.y = m.scale / 2 + (m.fly || 0);

applyPhase(THREE, scene, { sun, ambient, hemi, torch }, lerpPhase('dusk', 'night', t)); // 매 프레임
```
- 낮: 밝은 하늘, 안개 멀리 / 해질녘: 주황 / 밤: 안개가 가깝고(12~70m) 플레이어 손전등(`TORCH`)만 밝음 / 보스: 붉은 하늘
- 몬스터 발밑에 반투명 검은 원(그림자)을 하나 깔면 땅에 붙어 보입니다.
- 화면 위 HUD, 상점, 허브, 엔딩은 모두 2D(HTML/CSS)로 3D 캔버스 위에 `gt-overlay`로 올립니다.

## 13. 시계, 자원, 페이즈 배너

```html
<div class="gt-clock" data-phase="night">
  <img class="gt-icon" src="design/icons/ui-moon.svg" alt="">
  <span class="gt-clock__day">3일차</span><span class="gt-clock__phase">밤</span>
  <div class="gt-clock__track" style="--t:72"></div>   <!-- 하루 진행 0~100 -->
</div>
<span class="gt-res"><img src="design/icons/res-wood.svg" alt="">142</span>
<div class="gt-phase-banner gt-phase-banner--night">밤이 찾아옵니다<small>살아남아라</small></div>
```
배너는 2.6초 뒤 사라지니 `animationend`에서 제거. 종류: `--day`, `--night`, `--boss`. 문구 예: "아침이 밝았다 / 자원을 모아라", "밤이 찾아옵니다 / 살아남아라", "심연의 군주가 깨어났다".

보스 체력바: `<div class="gt-bossbar"><div class="gt-bossbar__name">심연의 군주</div><div class="gt-bar" style="--value:58"></div><div class="gt-bossbar__phase">2단계 · 분노</div></div>`

## 14. 허브 화면

```html
<div class="gt-hub">
  <div class="gt-backdrop gt-backdrop--hub"></div>
  <div class="gt-hub__header"><div><div class="gt-hub__day">3일차 생존</div><div class="gt-hub__sub">…</div></div> 자원들 </div>
  <div class="gt-hub__grid">
    <button class="gt-hub-tile"><img src="…"><span class="gt-hub-tile__title">무기 상점</span><span class="gt-hub-tile__desc">…</span></button>
    …
    <button class="gt-hub-tile gt-hub-tile--next">…4일차 시작…</button>
  </div>
  <button class="gt-boss-btn"><img src="design/icons/ui-skull.svg" alt=""><span>보스에 도전하기<small>경고 문구</small></span></button>
</div>
```
보스 버튼은 조건 전에는 `disabled`로 두면 회색이 됩니다.

## 15. 스킬트리

```html
<span class="gt-skillpoints">스킬 포인트 3</span>
<div class="gt-skilltree">
  <div class="gt-branch gt-branch--gun">
    <h3 class="gt-branch__title">사격</h3>
    <button class="gt-skill is-learned"><img src="design/icons/ui-damage.svg" alt=""><span class="gt-skill__lv">3/3</span>
      <span class="gt-tip"><b>강한 탄환</b><br>피해량 +10%</span></button>
    <button class="gt-skill is-available">…</button>
    <button class="gt-skill is-locked">…</button>
  </div>
  <div class="gt-branch gt-branch--survive">…생존…</div>
  <div class="gt-branch gt-branch--gather">…채집…</div>
</div>
```
노드 사이 연결선은 자동이고, 배운 노드 아래 선은 가지 색으로 칠해집니다.

## 16. 엔딩

```html
<div class="gt-ending">
  <div class="gt-backdrop gt-backdrop--ending"></div>
  <img class="gt-ending__trophy" src="design/icons/ui-trophy.svg" alt="">
  <h1 class="gt-ending__title">새벽이 밝았다</h1>
  <p class="gt-ending__sub">심연의 군주를 쓰러뜨리고 마침내 살아남았습니다.</p>
  <div class="gt-ending__stats"><div class="gt-ending__stat"><b>12일</b><span>생존</span></div> …</div>
  <button class="gt-btn gt-btn--primary">처음부터 다시</button>
</div>
```
화면 전체를 덮고, 해가 떠오른 뒤 제목, 기록, 버튼 순서로 나타납니다.
