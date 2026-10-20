# 총 타이쿤 사운드 모듈 (audio.js)

외부 음원 파일 없이 Web Audio로 효과음과 배경음악을 실시간 합성합니다.

| 파일 | 내용 |
|---|---|
| `audio.js` | 사운드 모듈. `window.GameAudio`를 만듭니다 |
| `demo.html` | 버튼으로 모든 소리를 들어보는 테스트 페이지 |
| `preview.wav` | 모든 효과음 + 배경음악 8마디를 녹음한 28초 샘플 |

## 붙이는 법

```html
<script src="audio/audio.js"></script>
<script src="game.js"></script>
```

일반 `<script>`로 불러오면 됩니다 (ES 모듈 아님). 불러오는 순간 첫 터치/클릭/키 입력을 기다리는 잠금 해제 처리가 자동으로 걸립니다. 브라우저는 사용자 입력 전에 소리를 막기 때문에, 그 전에 부른 `play()`는 조용히 무시되고 `false`를 돌려줍니다. `startMusic()`은 잠긴 상태에서 불러도 기억해 두었다가 첫 터치 때 시작합니다.

## 효과음

```js
GameAudio.play('shoot');                        // 기본 권총
GameAudio.play('shoot', { variant: 'shotgun' }); // pistol, rifle, smg, shotgun, sniper, laser
GameAudio.play('hit');      // 명중
GameAudio.play('kill');     // 적 처치
GameAudio.play('coin');     // 돈 획득
GameAudio.play('buy');      // 구매
GameAudio.play('upgrade');  // 업그레이드
GameAudio.play('warning');  // 경고 (사이렌 3번). { pulses: 5 }로 횟수 변경
GameAudio.play('click');    // UI 버튼
```

공통 옵션: `{ pitch: 1.2 }` 음 높이 배율, `{ volume: 0.5 }` 이 소리만 작게.

같은 소리가 한 프레임에 수십 번 겹치지 않게 자동으로 걸러냅니다. 예를 들어 `shoot`은 0.03초 간격, 동시에 최대 6개까지만 재생되므로 연사나 돈 연속 획득 때 그냥 매번 불러도 됩니다. 소리마다 높이가 살짝씩 달라져 반복이 덜 거슬립니다.

## 배경음악

```js
GameAudio.startMusic();          // 반복 재생 (8마디 루프, 116 BPM, 1초 페이드 인)
GameAudio.stopMusic();           // 0.8초 페이드 아웃. stopMusic(0) 즉시 정지
GameAudio.setMusicIntensity(0);  // 0 잔잔(베이스+화음), 1 보통(+드럼), 2 전투(+멜로디, 빠른 하이햇)
GameAudio.isMusicPlaying();
```

상점 화면은 0, 평소 플레이는 1, 웨이브나 보스전은 2처럼 쓰면 됩니다. 탭을 숨기면 자동으로 멈추고 돌아오면 이어서 재생합니다.

## 볼륨과 음소거

```js
GameAudio.setVolume('master', 0.8);  // master, sfx, music 각각 0~1
GameAudio.getVolume('music');
GameAudio.toggleMute();              // 바뀐 상태(true = 음소거)를 돌려줌
GameAudio.setMuted(true);
GameAudio.isMuted();
GameAudio.isUnlocked();              // 첫 터치 후 소리가 날 수 있는 상태인지
```

볼륨과 음소거 설정은 `localStorage`의 `gunTycoon.audio` 키에 저장되어 다음 접속 때 그대로 적용됩니다.

## 확인한 것

헤드리스 Chromium에서 `demo.html`로 확인했습니다.

- 클릭 전에는 잠겨 있고 `play()`가 `false`, 클릭 후 잠금이 풀리고 8개 효과음 모두 재생됨
- 배경음악 시작, 음소거, 볼륨 저장 동작
- 같은 순간 50번 발사 호출 시 1번만 재생 (겹침 방지)
- 실제 파형을 렌더링해 모든 소리에 음량이 있고 클리핑(1.0 초과)과 NaN이 없음
