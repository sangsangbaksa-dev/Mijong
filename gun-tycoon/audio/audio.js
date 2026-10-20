/*
 * GameAudio — 총 타이쿤용 사운드 모듈 (외부 파일 없음, Web Audio 합성)
 *
 * 사용: <script src="audio/audio.js"></script> 후 window.GameAudio 사용.
 * 자세한 사용법은 같은 폴더의 README.md 참고.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'gunTycoon.audio';
  var AC = global.AudioContext || global.webkitAudioContext;

  var ctx = null;
  var bus = null; // { master, sfx, music, comp }
  var noiseBuf = null;
  var unlocked = false;

  var settings = { master: 0.8, sfx: 0.9, music: 0.5, muted: false };
  loadSettings();

  // 같은 소리가 한 프레임에 수십 번 겹쳐 터지는 것을 막는 제한값
  var LIMITS = {
    shoot:   { gap: 0.03, voices: 6 },
    hit:     { gap: 0.025, voices: 6 },
    kill:    { gap: 0.05, voices: 4 },
    coin:    { gap: 0.04, voices: 6 },
    buy:     { gap: 0.08, voices: 2 },
    upgrade: { gap: 0.15, voices: 2 },
    warning: { gap: 0.6, voices: 1 },
    click:   { gap: 0.02, voices: 4 }
  };
  var lastPlayed = {};
  var activeVoices = {};

  // ---------- 설정 저장 ----------
  function loadSettings() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        ['master', 'sfx', 'music'].forEach(function (k) {
          if (typeof s[k] === 'number') settings[k] = clamp01(s[k]);
        });
        settings.muted = !!s.muted;
      }
    } catch (e) { /* 저장소 없음: 기본값 사용 */ }
  }

  function saveSettings() {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* 무시 */ }
  }

  function clamp01(v) { return Math.max(0, Math.min(1, +v || 0)); }

  // ---------- 초기화 ----------
  function init(opts) {
    if (ctx) return ctx;
    opts = opts || {};
    if (opts.context) ctx = opts.context;
    else if (AC) ctx = new AC({ latencyHint: 'interactive' });
    else return null;

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);

    var master = ctx.createGain();
    master.connect(comp);
    var sfx = ctx.createGain();
    sfx.connect(master);
    var music = ctx.createGain();
    music.connect(master);

    bus = { master: master, sfx: sfx, music: music, comp: comp };
    applyVolumes(true);

    var len = Math.floor(ctx.sampleRate * 1.0);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    return ctx;
  }

  function applyVolumes(immediate) {
    if (!bus) return;
    var t = ctx.currentTime;
    var m = settings.muted ? 0 : settings.master;
    setParam(bus.master.gain, m, t, immediate);
    setParam(bus.sfx.gain, settings.sfx, t, immediate);
    setParam(bus.music.gain, settings.music * 0.6, t, immediate);
  }

  function setParam(p, v, t, immediate) {
    if (immediate) { p.value = v; return; }
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(v, t + 0.05);
  }

  // 브라우저(특히 모바일)는 사용자 입력 전에는 소리를 막는다.
  // 첫 터치/클릭/키 입력에서 AudioContext를 만들고 깨운다.
  function unlock() {
    init();
    if (!ctx) return;
    if (ctx.state === 'suspended' && ctx.resume) {
      var r = ctx.resume();
      if (r && r.then) r.then(function () { if (musicWanted) startMusicNow(); });
    }
    if (!unlocked) {
      // iOS 일부 버전은 무음 버퍼를 한 번 재생해야 열린다
      var b = ctx.createBuffer(1, 1, ctx.sampleRate);
      var s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
      unlocked = true;
      if (musicWanted) startMusicNow();
    }
  }

  function installUnlock() {
    if (!global.addEventListener) return;
    var evs = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown'];
    function handler() {
      unlock();
      if (ctx && ctx.state === 'running') {
        evs.forEach(function (e) { global.removeEventListener(e, handler, true); });
      }
    }
    evs.forEach(function (e) { global.addEventListener(e, handler, true); });

    // 탭이 숨겨지면 멈추고, 돌아오면 다시 재생
    if (global.document) {
      global.document.addEventListener('visibilitychange', function () {
        if (!ctx) return;
        if (global.document.hidden) { if (ctx.suspend) ctx.suspend(); }
        else if (unlocked && ctx.resume) ctx.resume();
      });
    }
  }

  function ready() { return !!ctx && ctx.state !== 'closed'; }

  // ---------- 합성 도우미 ----------
  function rnd(spread) { return 1 + (Math.random() * 2 - 1) * spread; }

  function env(gainNode, t, attack, peak, decay, sustainTime) {
    var g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    if (sustainTime) g.setValueAtTime(peak, t + attack + sustainTime);
    g.exponentialRampToValueAtTime(0.0001, t + attack + (sustainTime || 0) + decay);
    return t + attack + (sustainTime || 0) + decay;
  }

  function tone(dest, t, o) {
    // o: type, freq, freqEnd, attack, peak, decay, hold, detune
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.glide || o.decay));
    if (o.detune) osc.detune.value = o.detune;
    osc.connect(g);
    g.connect(dest);
    var end = env(g, t, o.attack || 0.002, o.peak, o.decay, o.hold);
    osc.start(t);
    osc.stop(end + 0.02);
    return end;
  }

  function noise(dest, t, o) {
    // o: filter, freq, freqEnd, q, attack, peak, decay, hold
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.decay);
    f.Q.value = o.q || 1;
    var g = ctx.createGain();
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    var end = env(g, t, o.attack || 0.001, o.peak, o.decay, o.hold);
    src.start(t, Math.random() * 0.5);
    src.stop(end + 0.02);
    return end;
  }

  function note(n) { return 440 * Math.pow(2, (n - 69) / 12); } // MIDI → Hz

  // ---------- 효과음 ----------
  var SHOOT_VARIANTS = {
    pistol:  { body: 1800, bodyEnd: 400, dec: 0.12, thump: 150, thumpDec: 0.08, peak: 0.8 },
    rifle:   { body: 2600, bodyEnd: 700, dec: 0.08, thump: 180, thumpDec: 0.05, peak: 0.7 },
    smg:     { body: 3200, bodyEnd: 900, dec: 0.06, thump: 200, thumpDec: 0.04, peak: 0.55 },
    shotgun: { body: 1200, bodyEnd: 200, dec: 0.28, thump: 90,  thumpDec: 0.18, peak: 1.0 },
    sniper:  { body: 1500, bodyEnd: 150, dec: 0.45, thump: 70,  thumpDec: 0.25, peak: 1.0 },
    laser:   null
  };

  var SFX = {
    shoot: function (t, out, o) {
      var v = o.variant || 'pistol';
      var p = rnd(0.04) * (o.pitch || 1);
      if (v === 'laser') {
        return tone(out, t, { type: 'sawtooth', freq: 1600 * p, freqEnd: 180, attack: 0.001, peak: 0.35, decay: 0.16 });
      }
      var s = SHOOT_VARIANTS[v] || SHOOT_VARIANTS.pistol;
      var a = noise(out, t, { filter: 'bandpass', freq: s.body * p, freqEnd: s.bodyEnd, q: 0.8, peak: s.peak, decay: s.dec });
      var b = tone(out, t, { type: 'sine', freq: s.thump * p, freqEnd: 40, peak: s.peak * 0.9, decay: s.thumpDec });
      noise(out, t, { filter: 'highpass', freq: 5000, peak: s.peak * 0.4, decay: 0.02 }); // 찰칵 하는 고음
      return Math.max(a, b);
    },

    hit: function (t, out, o) {
      var p = rnd(0.06) * (o.pitch || 1);
      noise(out, t, { filter: 'bandpass', freq: 2500 * p, q: 2, peak: 0.5, decay: 0.05 });
      return tone(out, t, { type: 'square', freq: 520 * p, freqEnd: 260, peak: 0.18, decay: 0.07 });
    },

    kill: function (t, out, o) {
      var p = rnd(0.03) * (o.pitch || 1);
      noise(out, t, { filter: 'lowpass', freq: 3000, freqEnd: 200, q: 0.7, peak: 0.6, decay: 0.3 });
      tone(out, t, { type: 'sawtooth', freq: 440 * p, freqEnd: 60, peak: 0.25, decay: 0.32 });
      tone(out, t, { type: 'sine', freq: 110 * p, freqEnd: 35, peak: 0.7, decay: 0.25 });
      // 짧은 보상 '띵'
      return tone(out, t + 0.08, { type: 'triangle', freq: note(84) * p, peak: 0.15, decay: 0.25 });
    },

    coin: function (t, out, o) {
      var p = rnd(0.02) * (o.pitch || 1);
      tone(out, t, { type: 'square', freq: note(83) * p, peak: 0.18, decay: 0.05, hold: 0.04 });
      return tone(out, t + 0.07, { type: 'square', freq: note(88) * p, peak: 0.18, decay: 0.25 });
    },

    buy: function (t, out, o) {
      var p = o.pitch || 1;
      var seq = [72, 76, 79];
      var end = t;
      seq.forEach(function (n, i) {
        end = tone(out, t + i * 0.06, { type: 'triangle', freq: note(n) * p, peak: 0.3, decay: 0.18 });
        tone(out, t + i * 0.06, { type: 'square', freq: note(n + 12) * p, peak: 0.05, decay: 0.12 });
      });
      noise(out, t, { filter: 'highpass', freq: 7000, peak: 0.15, decay: 0.08 }); // 계산대 '착'
      return end;
    },

    upgrade: function (t, out, o) {
      var p = o.pitch || 1;
      var seq = [60, 64, 67, 72, 76, 79, 84];
      var end = t;
      seq.forEach(function (n, i) {
        end = tone(out, t + i * 0.055, { type: 'square', freq: note(n) * p, peak: 0.1, decay: 0.12 });
        tone(out, t + i * 0.055, { type: 'triangle', freq: note(n) * p, peak: 0.2, decay: 0.2, detune: 7 });
      });
      // 마지막 화음 길게
      [72, 76, 79, 84].forEach(function (n) {
        end = tone(out, t + 0.4, { type: 'triangle', freq: note(n) * p, attack: 0.01, peak: 0.12, decay: 0.6 });
      });
      noise(out, t + 0.4, { filter: 'highpass', freq: 8000, peak: 0.08, decay: 0.4 });
      return end;
    },

    warning: function (t, out, o) {
      var pulses = o.pulses || 3;
      var end = t;
      for (var i = 0; i < pulses; i++) {
        var tt = t + i * 0.3;
        tone(out, tt, { type: 'square', freq: 880, attack: 0.005, peak: 0.2, decay: 0.02, hold: 0.12 });
        end = tone(out, tt + 0.15, { type: 'square', freq: 660, attack: 0.005, peak: 0.2, decay: 0.02, hold: 0.12 });
      }
      return end;
    },

    click: function (t, out, o) {
      return tone(out, t, { type: 'square', freq: 1200 * (o.pitch || 1), peak: 0.08, decay: 0.03 });
    }
  };

  function play(name, opts) {
    var fn = SFX[name];
    if (!fn) { if (global.console) console.warn('[GameAudio] 알 수 없는 효과음:', name); return false; }
    if (!ready() || settings.muted) return false;
    if (ctx.state !== 'running') return false;

    var now = ctx.currentTime;
    var lim = LIMITS[name] || { gap: 0.02, voices: 6 };
    if (lastPlayed[name] && now - lastPlayed[name] < lim.gap) return false;
    if ((activeVoices[name] || 0) >= lim.voices) return false;
    lastPlayed[name] = now;

    opts = opts || {};
    var out = bus.sfx;
    if (typeof opts.volume === 'number') {
      out = ctx.createGain();
      out.gain.value = clamp01(opts.volume);
      out.connect(bus.sfx);
    }
    var end = fn(now + 0.005, out, opts);
    activeVoices[name] = (activeVoices[name] || 0) + 1;
    setTimeout(function () { activeVoices[name]--; }, Math.max(30, (end - now) * 1000));
    return true;
  }

  // ---------- 배경음악 ----------
  // 116 BPM, 16분음표 스텝. 8마디 루프: Am - F - C - G 진행을 두 번.
  var BPM = 116;
  var STEP = 60 / BPM / 4;
  var PROG = [ // 각 마디의 근음(MIDI)과 화음
    { root: 45, chord: [57, 60, 64] }, // Am
    { root: 41, chord: [57, 60, 65] }, // F
    { root: 48, chord: [55, 60, 64] }, // C
    { root: 43, chord: [55, 59, 62] }, // G
    { root: 45, chord: [57, 60, 64] }, // Am
    { root: 41, chord: [57, 60, 65] }, // F
    { root: 43, chord: [55, 59, 62] }, // G
    { root: 40, chord: [56, 59, 64] }  // E (긴장 → Am으로 복귀)
  ];
  var BASS_PAT = [0, null, 12, null, 0, null, 0, 12, null, 0, null, 12, 0, null, 7, null];
  var LEAD_PAT = [0, null, 2, null, 1, null, 2, null, 0, null, 1, 2, null, 1, null, 0]; // 화음 음 인덱스
  var KICK = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0];
  var SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];

  var musicWanted = false;
  var musicPlaying = false;
  var intensity = 1; // 0: 잔잔(베이스+패드), 1: 드럼 추가, 2: 리드 멜로디 + 빠른 하이햇
  var nextStepTime = 0;
  var stepIndex = 0;
  var timer = null;
  var musicOut = null; // 페이드용 게인

  function scheduleStep(i, t) {
    var bar = Math.floor(i / 16) % PROG.length;
    var s = i % 16;
    var h = PROG[bar];
    var out = musicOut;

    // 패드: 마디 시작에 화음
    if (s === 0) {
      h.chord.forEach(function (n, k) {
        tone(out, t, { type: 'triangle', freq: note(n), attack: 0.08, peak: 0.07, decay: 0.6, hold: STEP * 14, detune: k * 4 - 4 });
      });
    }

    // 베이스
    var b = BASS_PAT[s];
    if (b !== null) {
      var osc = ctx.createOscillator();
      var f = ctx.createBiquadFilter();
      var g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = note(h.root + b);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.exponentialRampToValueAtTime(200, t + STEP * 1.5);
      f.Q.value = 4;
      osc.connect(f); f.connect(g); g.connect(out);
      var e = env(g, t, 0.005, 0.22, STEP * 1.6);
      osc.start(t); osc.stop(e + 0.02);
    }

    if (intensity >= 1) {
      if (KICK[s]) tone(out, t, { type: 'sine', freq: 140, freqEnd: 42, glide: 0.12, peak: 0.6, decay: 0.18 });
      if (SNARE[s]) {
        noise(out, t, { filter: 'bandpass', freq: 1800, q: 0.7, peak: 0.28, decay: 0.12 });
        tone(out, t, { type: 'triangle', freq: 200, freqEnd: 140, peak: 0.12, decay: 0.08 });
      }
      var hat = intensity >= 2 ? true : (s % 2 === 0);
      if (hat) noise(out, t, { filter: 'highpass', freq: 8000, peak: s % 4 === 2 ? 0.09 : 0.05, decay: 0.035 });
    }

    if (intensity >= 2) {
      var li = LEAD_PAT[s];
      if (li !== null) {
        var n = h.chord[li] + 12;
        tone(out, t, { type: 'square', freq: note(n), peak: 0.05, decay: STEP * 1.8 });
        tone(out, t + STEP * 3, { type: 'square', freq: note(n), peak: 0.015, decay: STEP }); // 에코
      }
    }
  }

  function scheduler() {
    if (!musicPlaying) return;
    // 실행 시점이 밀렸으면 (탭 복귀 등) 박자를 현재로 당긴다
    if (nextStepTime < ctx.currentTime - 0.2) nextStepTime = ctx.currentTime + 0.05;
    while (nextStepTime < ctx.currentTime + 0.12) {
      scheduleStep(stepIndex, nextStepTime);
      nextStepTime += STEP;
      stepIndex = (stepIndex + 1) % (16 * PROG.length);
    }
  }

  function startMusicNow() {
    if (musicPlaying || !ready() || ctx.state !== 'running') return;
    musicPlaying = true;
    musicOut = ctx.createGain();
    musicOut.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicOut.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.0);
    musicOut.connect(bus.music);
    stepIndex = 0;
    nextStepTime = ctx.currentTime + 0.1;
    scheduler();
    timer = setInterval(scheduler, 25);
  }

  function startMusic() {
    musicWanted = true;
    init();
    if (ctx && ctx.state === 'running') startMusicNow();
    // 아직 잠겨 있으면 첫 터치 때 unlock()이 시작한다
  }

  function stopMusic(fade) {
    musicWanted = false;
    if (!musicPlaying) return;
    musicPlaying = false;
    clearInterval(timer);
    timer = null;
    var out = musicOut;
    musicOut = null;
    var t = ctx.currentTime;
    var f = typeof fade === 'number' ? fade : 0.8;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, f));
    setTimeout(function () { out.disconnect(); }, (f + 0.5) * 1000);
  }

  function setMusicIntensity(level) { intensity = Math.max(0, Math.min(2, level | 0)); }

  // ---------- 볼륨 / 음소거 ----------
  function setVolume(channel, v) {
    if (!(channel in settings) || channel === 'muted') return;
    settings[channel] = clamp01(v);
    applyVolumes(false);
    saveSettings();
  }

  function getVolume(channel) { return settings[channel]; }

  function setMuted(m) {
    settings.muted = !!m;
    applyVolumes(false);
    saveSettings();
  }

  function toggleMute() { setMuted(!settings.muted); return settings.muted; }

  installUnlock();

  global.GameAudio = {
    init: init,
    unlock: unlock,
    play: play,
    startMusic: startMusic,
    stopMusic: stopMusic,
    setMusicIntensity: setMusicIntensity,
    isMusicPlaying: function () { return musicPlaying; },
    setVolume: setVolume,
    getVolume: getVolume,
    setMuted: setMuted,
    isMuted: function () { return settings.muted; },
    toggleMute: toggleMute,
    isUnlocked: function () { return !!ctx && ctx.state === 'running'; },
    sounds: Object.keys(SFX),
    shootVariants: Object.keys(SHOOT_VARIANTS),
    // 테스트용: OfflineAudioContext 등에서 효과음/음악을 특정 시각에 직접 예약
    _render: function (name, t, opts) { return SFX[name](t, bus.sfx, opts || {}); },
    _renderMusic: function (fromStep, steps, t0, level) {
      var saved = intensity;
      intensity = level == null ? 2 : level;
      musicOut = musicOut || bus.music;
      for (var i = 0; i < steps; i++) scheduleStep(fromStep + i, t0 + i * STEP);
      intensity = saved;
    }
  };
})(typeof window !== 'undefined' ? window : this);
