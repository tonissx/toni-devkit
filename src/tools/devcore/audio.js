/**
 * Som do DevCore — tudo sintetizado na hora (Web Audio), sem arquivos de áudio. Composições originais:
 * a referência é de clima (Castlevania: SOTN — gótico, cravo, órgão e cordas; Vampire Survivors — efeitos curtos e
 * satisfatórios), sem reaproveitar músicas ou samples. Ver docs/devcore-mapa-singularity.md §6.1.
 *
 * API: configureAudio({ on, volume }) · startMusic(theme) · stopMusic() · sfx(name)
 * O contexto de áudio nasce no primeiro som (sempre depois de um clique: "Lutar", "Comprar"…).
 */

let ctx = null;
let master = null;
let musicBus = null;
let noiseBuf = null;
const settings = { on: true, volume: 0.35 };

/** Liga/desliga e volume (0–1). Vale na hora, inclusive para a música tocando. */
export function configureAudio({ on, volume }) {
  if (on != null) settings.on = !!on;
  if (volume != null) settings.volume = Math.max(0, Math.min(1, volume));
  if (master) master.gain.setTargetAtTime(settings.on ? settings.volume : 0, ctx.currentTime, 0.05);
  if (!settings.on) stopMusic();
}

function ac() {
  if (!settings.on) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    // "Sala": um eco curto com realimentação dá o ar de castelo sem pesar.
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.19;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    master.connect(ctx.destination);
    master.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(wet); wet.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.55;
    musicBus.connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Uma nota: oscilador → (filtro) → envelope → destino. */
function tone(t, midi, dur, { type = 'square', gain = 0.12, attack = 0.005, decay = null, slideTo = null, filter = null, detune = 0, out = master } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz(midi), t);
  if (slideTo != null) o.frequency.exponentialRampToValueAtTime(hz(slideTo), t + dur);
  o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  if (decay) g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, decay));
  else { g.gain.setValueAtTime(gain, t + Math.max(attack, dur * 0.7)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  let node = o;
  if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); node = f; }
  node.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}

/** Ruído (percussão, "whoosh"). */
function noise(t, dur, { gain = 0.15, hp = 1200, out = master } = {}) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t); src.stop(t + dur + 0.02);
}

/* ─────────────── instrumentos ─────────────── */
const organ = (t, m, d, out) => { tone(t, m, d, { type: 'sine', gain: 0.07, attack: 0.03, out }); tone(t, m + 12, d, { type: 'sine', gain: 0.035, attack: 0.03, out }); tone(t, m + 19, d, { type: 'sine', gain: 0.018, attack: 0.03, out }); };
const harpsichord = (t, m, d, out, filter = 3200) => tone(t, m, d, { type: 'square', gain: 0.045, decay: 0.22, filter, out });
const strings = (t, m, d, out) => { tone(t, m, d, { type: 'sawtooth', gain: 0.03, attack: 0.18, filter: 1500, detune: -6, out }); tone(t, m, d, { type: 'sawtooth', gain: 0.03, attack: 0.18, filter: 1500, detune: 6, out }); };
const bass = (t, m, d, out) => tone(t, m, d, { type: 'triangle', gain: 0.16, decay: d * 0.9, out });
/* bateria: bumbo com peso (pancada + estalo), caixa com corpo, chimbal, prato e tons */
const kick = (t, out, accent = 1) => {
  tone(t, 47, 0.32, { type: 'sine', gain: 0.5 * accent, slideTo: 26, decay: 0.3, out });
  tone(t, 35, 0.22, { type: 'triangle', gain: 0.18 * accent, decay: 0.2, out });
  noise(t, 0.012, { gain: 0.12 * accent, hp: 3000, out });
};
const snare = (t, out, accent = 1) => {
  tone(t, 55, 0.11, { type: 'triangle', gain: 0.16 * accent, slideTo: 50, decay: 0.1, out });
  noise(t, 0.17, { gain: 0.17 * accent, hp: 1400, out });
};
const hat = (t, out, accent = 1, open = false) => noise(t, open ? 0.2 : 0.035, { gain: (open ? 0.05 : 0.04) * accent, hp: 7500, out });
const crash = (t, out) => { noise(t, 1.4, { gain: 0.08, hp: 4500, out }); noise(t, 0.4, { gain: 0.05, hp: 2500, out }); };
const tom = (t, m, out) => tone(t, m, 0.26, { type: 'sine', gain: 0.3, slideTo: m - 6, decay: 0.26, out });

/**
 * Padrões da bateria (16 passos por compasso). kick/snare: passos com batida; ghost: caixa fraca; fill: virada de tons no
 * último compasso do loop (passo → nota). Localhost: groove sincopado e pesado; chefe: bumbo duplo e caixa mais densa.
 */
const DRUMS = {
  localhost: { kick: [0, 3, 8, 10, 11], snare: [4, 12], ghost: [7, 15], hats: 2, openHat: [14], crashEvery: 2,
    fill: { 12: 52, 13: 50, 14: 47, 15: 43 } },
  boss: { kick: [0, 1, 3, 6, 8, 9, 11, 14], snare: [4, 12], ghost: [2, 7, 10, 15], hats: 1, openHat: [6, 14], crashEvery: 1,
    fill: { 8: 55, 9: 55, 10: 52, 11: 52, 12: 48, 13: 48, 14: 43, 15: 43 } },
  // Pântano: meio-tempo arrastado (caixa no 3), bumbo pesado e chimbal só nas semínimas; virada grave no fim.
  staging: { kick: [0, 7, 10], snare: [8], ghost: [14], hats: 4, openHat: [12], crashEvery: 4,
    fill: { 12: 47, 13: 45, 14: 43, 15: 40 } },
  'staging-boss': { kick: [0, 2, 3, 6, 8, 10, 11, 14], snare: [4, 12], ghost: [7, 15], hats: 2, openHat: [6, 14], crashEvery: 1,
    fill: { 8: 52, 10: 50, 11: 50, 12: 47, 13: 47, 14: 43, 15: 40 } },
};
const lead = (t, m, d, out) => { tone(t, m, d, { type: 'square', gain: 0.05, attack: 0.01, filter: 2600, out }); tone(t, m, d, { type: 'triangle', gain: 0.05, attack: 0.01, out }); };
/** Segunda voz (o "outro lado" do merge conflict): serra filtrada, levemente desafinada. */
const lead2 = (t, m, d, out) => { tone(t, m, d, { type: 'sawtooth', gain: 0.024, attack: 0.02, filter: 1800, detune: 14, out }); tone(t, m, d, { type: 'sine', gain: 0.02, attack: 0.02, out }); };

/* ─────────────── temas (originais) ───────────────
 * chords: tríade por compasso (MIDI) · melody: 16 passos por compasso (semicolcheias; null = pausa) */
const THEMES = {
  // Localhost: tenso e perigoso — ré menor harmônica, acorde napolitano (E♭), dominante com dó sustenido,
  // baixo pulsando em colcheias, cravo com vizinhas cromáticas e um trítono na melodia.
  localhost: {
    bpm: 140, pulse: true, chromatic: true,
    chords: [[50, 53, 57], [51, 55, 58], [50, 53, 57], [45, 49, 52]],
    melody: [
      [74, null, 75, null, 74, null, null, 69, 70, null, 69, null, 68, null, 69, null],
      [75, null, null, 74, 75, null, 79, null, 78, null, 75, null, 74, null, null, null],
      [77, null, 76, 77, 74, null, null, null, 80, null, 81, null, 77, null, 74, null],
      [73, null, null, 76, 73, null, 69, null, 70, null, 73, null, 76, 75, 73, null],
    ],
  },
  // Pântano Staging: lento e arrastado — mi frígio (o fá natural por cima do mi), cravo abafado como se estivesse
  // debaixo d'água, melodia esparsa e grave; a bateria arrasta em meio-tempo.
  staging: {
    bpm: 112, pulse: true, chromatic: true, arpFilter: 1300,
    chords: [[52, 55, 59], [53, 57, 60], [52, 55, 59], [50, 53, 57]],
    melody: [
      [71, null, null, 72, 71, null, null, null, 67, null, 68, null, 67, null, null, null],
      [69, null, null, null, 72, null, 71, null, 69, null, null, 65, 64, null, null, null],
      [71, null, 72, null, 74, null, null, 75, 74, null, 72, null, 71, null, null, null],
      [69, null, 68, null, 65, null, null, null, 64, null, 65, null, 62, null, null, null],
    ],
  },
  // Chefe do Pântano (The Merge Conflict): duas melodias ao mesmo tempo, uma contra a outra — a segunda voz (counter)
  // insiste meio tom acima ou abaixo da principal, como dois branches que não se entendem.
  'staging-boss': {
    bpm: 150, pulse: true, chromatic: true, timpani: true, arpFilter: 2000,
    chords: [[52, 55, 59], [53, 56, 60], [48, 51, 55], [47, 51, 54]],
    melody: [
      [76, null, 77, null, 76, null, 71, null, 72, null, 71, null, 76, null, null, null],
      [77, null, 80, null, 77, null, 76, null, 72, null, 71, null, 68, null, null, null],
      [79, null, 78, null, 75, null, 72, null, 75, null, 78, null, 79, null, null, null],
      [78, 77, 75, null, 74, null, 71, null, 70, null, 71, null, 66, null, 64, null],
    ],
    counter: [
      [null, null, 76, null, 77, null, 72, null, null, 71, 72, null, 77, null, 76, null],
      [76, null, 79, null, 78, null, 77, null, 71, null, 72, null, 67, null, 68, null],
      [null, 79, null, 77, 76, null, 71, null, 74, null, 79, null, 78, null, 80, null],
      [79, null, 76, null, 75, null, 72, null, 71, null, 70, null, 67, null, 63, null],
    ],
  },
  // Chefe: ainda mais rápido, bumbo dobrado, tímpanos e trítono (sol sustenido) no clímax.
  boss: {
    bpm: 160, pulse: true, chromatic: true, doubleKick: true, timpani: true,
    chords: [[50, 53, 57], [51, 55, 58], [44, 47, 50], [45, 49, 52]],
    melody: [
      [74, 75, 74, null, 81, null, 80, null, 77, null, 74, null, 75, null, 74, null],
      [82, null, 79, null, 75, null, 79, null, 82, 83, 82, null, 79, null, null, null],
      [80, null, 77, null, 74, null, 71, null, 80, null, 83, null, 80, null, 77, null],
      [81, 80, 79, null, 77, null, 76, null, 73, null, null, null, 69, null, 62, null],
    ],
  },
};

let music = null;

/** Começa (ou troca) a música em loop. theme: id de área ('localhost') ou 'boss'. */
export function startMusic(theme) {
  if (!ac()) return;
  stopMusic();
  const T = THEMES[theme] || THEMES.localhost;
  const step = 60 / T.bpm / 4;
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(musicBus);
  // Bateria num barramento próprio com compressor: soa mais "colada" e com mais peso sem estourar o resto.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
  const drums = ctx.createGain();
  drums.gain.value = 0.9;
  drums.connect(comp); comp.connect(out);
  const D = DRUMS[theme] || DRUMS.localhost;
  let n = 0;
  let next = ctx.currentTime + 0.08;
  const total = T.chords.length * 16;
  const schedule = () => {
    while (next < ctx.currentTime + 0.15) {
      const bar = Math.floor((n % total) / 16);
      const s = n % 16;
      const chord = T.chords[bar];
      if (s === 0) { strings(next, chord[0] + 12, step * 16, out); strings(next, chord[2] + 12, step * 16, out); organ(next, chord[1] + 12, step * 16, out); }
      // Cravo: arpejo da tríade em semicolcheias; nos temas tensos, a vizinha cromática (meio tom acima) no fim de cada meio compasso.
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      const tone8 = chord[arp[s % 8]] + 24;
      harpsichord(next, T.chromatic && s % 8 === 7 ? chord[2] + 25 : tone8, step * 0.9, out, T.arpFilter || 3200);
      // Baixo: pulsando em colcheias (tenso) ou em semínimas.
      if (T.pulse ? s % 2 === 0 : s % 4 === 0) bass(next, chord[0] - 12 + (T.pulse && s % 8 === 6 ? 1 : 0), T.pulse ? step * 1.6 : step * 3.5, out);
      // Bateria: no último compasso do loop entra a virada de tons no lugar do groove.
      const fill = bar === T.chords.length - 1 && D.fill[s] != null;
      if (fill) tom(next, D.fill[s], drums);
      else {
        if (D.kick.includes(s)) kick(next, drums, s % 4 === 0 ? 1 : 0.8);
        if (D.snare.includes(s)) snare(next, drums);
        else if (D.ghost.includes(s)) snare(next, drums, 0.3);
      }
      if (s % D.hats === 0 && !fill) hat(next, drums, s % 4 === 0 ? 1.4 : s % 2 === 0 ? 1 : 0.6, D.openHat.includes(s));
      if (s === 0 && bar % D.crashEvery === 0) { crash(next, drums); kick(next, drums); }
      if (T.timpani && s === 12) tone(next, 38, step * 3, { type: 'sine', gain: 0.2, decay: step * 3, out });
      const note = T.melody[bar][s];
      if (note != null) {
        let len = 1;
        while (s + len < 16 && T.melody[bar][s + len] == null && len < 4) len++;
        lead(next, note, step * len * 0.95, out);
      }
      const other = T.counter && T.counter[bar][s];
      if (other != null) {
        let len = 1;
        while (s + len < 16 && T.counter[bar][s + len] == null && len < 4) len++;
        lead2(next, other, step * len * 0.95, out);
      }
      n++;
      next += step;
    }
  };
  schedule();
  const timer = setInterval(schedule, 25);
  music = { timer, out, drums };
}

/** Para a música (com um fade curto). */
export function stopMusic() {
  if (!music) return;
  clearInterval(music.timer);
  const { out } = music;
  music = null;
  if (ctx) { out.gain.setTargetAtTime(0, ctx.currentTime, 0.12); setTimeout(() => out.disconnect(), 800); }
}

/* ─────────────── efeitos ─────────────── */
const SFX = {
  hit: (t) => { tone(t, 64, 0.09, { type: 'square', gain: 0.1, slideTo: 52, decay: 0.09 }); noise(t, 0.05, { gain: 0.05, hp: 2500 }); },
  crit: (t) => { tone(t, 76, 0.12, { type: 'square', gain: 0.11, slideTo: 64, decay: 0.12 }); tone(t + 0.05, 88, 0.12, { type: 'square', gain: 0.07, decay: 0.12 }); noise(t, 0.08, { gain: 0.08, hp: 1800 }); },
  enemyHit: (t) => { tone(t, 52, 0.12, { type: 'sawtooth', gain: 0.09, slideTo: 40, decay: 0.12, filter: 1400 }); },
  miss: (t) => { noise(t, 0.14, { gain: 0.05, hp: 4000 }); tone(t, 79, 0.1, { type: 'triangle', gain: 0.04, slideTo: 74, decay: 0.1 }); },
  heal: (t) => { [72, 76, 79, 84].forEach((m, i) => tone(t + i * 0.05, m, 0.18, { type: 'sine', gain: 0.07, decay: 0.18 })); },
  ability: (t) => { [67, 71, 74, 79, 83].forEach((m, i) => tone(t + i * 0.035, m, 0.12, { type: 'square', gain: 0.06, decay: 0.12, filter: 3500 })); },
  item: (t) => { tone(t, 79, 0.08, { type: 'square', gain: 0.06, decay: 0.08 }); tone(t + 0.07, 86, 0.14, { type: 'square', gain: 0.06, decay: 0.14 }); },
  down: (t) => { tone(t, 60, 0.35, { type: 'sawtooth', gain: 0.08, slideTo: 36, filter: 1200 }); },
  victory: (t) => {
    [62, 66, 69, 74].forEach((m, i) => lead(t + i * 0.11, m, 0.14, master));
    [62, 66, 69, 74].forEach((m) => organ(t + 0.46, m, 0.9, master));
  },
  defeat: (t) => { [62, 61, 57, 50].forEach((m, i) => organ(t + i * 0.22, m, 0.3, master)); },
  // "Gema" do Vampire Survivors: dois toques brilhantes + brilho.
  gain: (t) => { tone(t, 84, 0.1, { type: 'triangle', gain: 0.09, decay: 0.1 }); tone(t + 0.06, 91, 0.22, { type: 'triangle', gain: 0.09, decay: 0.22 }); tone(t + 0.06, 96, 0.3, { type: 'sine', gain: 0.04, decay: 0.3 }); },
};

/** Toca um efeito curto. */
export function sfx(name) {
  if (!ac() || !SFX[name]) return;
  SFX[name](ctx.currentTime + 0.01);
}
