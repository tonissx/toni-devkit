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
  boss: { kick: [0, 3, 6, 8, 10, 11, 14], snare: [4, 12], ghost: [7, 15], hats: 2, openHat: [14], crashEvery: 2,
    fill: { 8: 55, 9: 55, 10: 52, 11: 52, 12: 48, 13: 48, 14: 43, 15: 43 } },
  // Pântano: meio-tempo arrastado (caixa no 3), bumbo pesado e chimbal só nas semínimas; virada grave no fim.
  staging: { kick: [0, 7, 10], snare: [8], ghost: [14], hats: 4, openHat: [12], crashEvery: 4,
    fill: { 12: 47, 13: 45, 14: 43, 15: 40 } },
  // Pico: galope épico; chefe do Pico: bumbo duplo contínuo e prato em todo compasso.
  production: { kick: [0, 3, 8, 11], snare: [4, 12], ghost: [14], hats: 2, openHat: [14], crashEvery: 2, taiko: [0, 6, 8, 10, 14],
    fill: { 12: 55, 13: 52, 14: 48, 15: 43 } },
  'production-boss': { kick: [0, 2, 3, 6, 8, 10, 11, 14], snare: [4, 12], ghost: [15], hats: 2, openHat: [14], crashEvery: 1, taiko: [0, 8],
    fill: { 8: 57, 9: 55, 10: 52, 11: 50, 12: 48, 13: 45, 14: 43, 15: 40 } },
  'staging-boss': { kick: [0, 2, 3, 6, 8, 10, 11, 14], snare: [4, 12], ghost: [7, 15], hats: 2, openHat: [6, 14], crashEvery: 1,
    fill: { 8: 52, 10: 50, 11: 50, 12: 47, 13: 47, 14: 43, 15: 40 } },
};
const lead = (t, m, d, out) => { tone(t, m, d, { type: 'square', gain: 0.05, attack: 0.01, filter: 2600, out }); tone(t, m, d, { type: 'triangle', gain: 0.05, attack: 0.01, out }); };
/* ─────────────── camada épica (Pico): coral, metais, taikos e um reverb de catedral ─────────────── */
let hall = null;
/** Reverb de catedral: resposta ao impulso sintetizada (ruído estéreo decaindo em ~3 s). */
function cathedral() {
  if (hall) return hall;
  const len = Math.floor(ctx.sampleRate * 3.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  hall = ctx.createConvolver();
  hall.buffer = ir;
  return hall;
}
/** Uma voz de envelope lento passando por um filtro (passa-banda: vogal do coral; passa-baixa: metal). */
function voice(t, midi, dur, { type = 'sawtooth', gain = 0.03, attack = 0.3, release = 0.5, detune = 0, filter = 'bandpass', freq = 900, q = 3, sweepTo = null, out }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(hz(midi), t);
  o.detune.value = detune;
  const f = ctx.createBiquadFilter();
  f.type = filter; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + Math.min(0.12, dur / 2));
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
/** Coral "aah": três vozes desafinadas e dois formantes de vogal, entrada lenta. */
const choir = (t, m, d, out) => {
  for (const det of [-9, 0, 9]) {
    voice(t, m, d, { gain: 0.016, attack: 0.45, release: 0.6, detune: det, freq: 730, q: 4, out });
    voice(t, m, d, { gain: 0.01, attack: 0.45, release: 0.6, detune: det, freq: 1090, q: 5, out });
  }
};
/** Metal (trompa/trombone): serra + quadrada com o filtro abrindo no ataque. */
const brass = (t, m, d, out, g = 1) => {
  voice(t, m, d, { gain: 0.05 * g, attack: 0.03, release: 0.15, filter: 'lowpass', freq: 380, sweepTo: 2600, q: 1.2, out });
  voice(t, m, d, { type: 'square', gain: 0.022 * g, attack: 0.03, release: 0.15, detune: 6, filter: 'lowpass', freq: 380, sweepTo: 1800, q: 1, out });
};
/** Taiko: tambor grave com corpo e a pele estalando. */
const taiko = (t, out, accent = 1) => {
  tone(t, 33, 0.55, { type: 'sine', gain: 0.55 * accent, slideTo: 24, decay: 0.55, out });
  tone(t, 40, 0.3, { type: 'triangle', gain: 0.2 * accent, slideTo: 30, decay: 0.3, out });
  noise(t, 0.05, { gain: 0.1 * accent, hp: 600, out });
};

/** Saturação (guitarra): curva suave que "quebra" a serra num timbre de amplificador no talo. */
function distCurve(amount = 40) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  return curve;
}
/** Power chord (fundamental, quinta, oitava) — `mute`: abafado com a mão (curto e grave, o "chug"). */
const guitar = (t, root, d, out, mute = false) => {
  for (const [iv, det] of [[0, -7], [0, 7], [7, 0], [12, -4]]) {
    if (mute && iv === 12) continue;
    voice(t, root + iv, d, { gain: mute ? 0.05 : 0.045, attack: 0.004, release: mute ? 0.05 : 0.2, detune: det, filter: 'lowpass', freq: mute ? 900 : 2600, q: 0.8, out });
  }
};
/** Coral cantando (mais forte que o pad): a melodia ou um canto curto em bloco. */
const chant = (t, m, d, out, g = 1) => {
  for (const det of [-8, 0, 8]) {
    voice(t, m, d, { gain: 0.03 * g, attack: Math.min(0.12, d / 3), release: Math.min(0.3, d / 2), detune: det, freq: 760, q: 4, out });
    voice(t, m, d, { gain: 0.018 * g, attack: Math.min(0.12, d / 3), release: Math.min(0.3, d / 2), detune: det, freq: 1150, q: 5, out });
  }
};

/** Lead "8-bit" brilhante com vibrato que entra depois do ataque (o canto dos temas de Castlevania). */
function leadVib(t, m, d, out) {
  for (const [type, g, det] of [['square', 0.045, 0], ['square', 0.02, 9], ['triangle', 0.04, 0]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz(m), t);
    o.detune.value = det;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.8;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(hz(m) * 0.012, t + Math.min(0.25, d * 0.6)); // vibrato atrasado
    lfo.connect(depth); depth.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3400;
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.008);
    gn.gain.setValueAtTime(g * 0.85, t + Math.max(0.01, d * 0.7));
    gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(f); f.connect(gn); gn.connect(out);
    o.start(t); lfo.start(t); o.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
  }
}
/** Sinos antigos: parciais inarmônicos decaindo devagar (a ponte do Legacy Monolith). */
const bells = (t, m, d, out) => {
  for (const [ratio, g] of [[1, 0.09], [2.76, 0.04], [5.4, 0.022], [8.93, 0.01]]) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(hz(m) * ratio, t);
    const gn = ctx.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.006);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(1.2, d) / Math.sqrt(ratio));
    o.connect(gn); gn.connect(out);
    o.start(t); o.stop(t + Math.max(1.2, d) + 0.05);
  }
};
/** Órgão de igreja em ataque (riff gótico): fundamental, quinta e oitava, curto ou sustentado. */
const organStab = (t, root, d, out, accent = 1) => {
  for (const iv of [0, 7, 12]) {
    tone(t, root + iv, d, { type: 'sine', gain: 0.075 * accent, attack: 0.012, decay: d, out });
    tone(t, root + iv + 12, d, { type: 'sine', gain: 0.035 * accent, attack: 0.012, decay: d, out });
    tone(t, root + iv + 19, d, { type: 'square', gain: 0.008 * accent, attack: 0.012, decay: d * 0.6, filter: 2400, out });
  }
};

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
  // Chefe 2 (The Merge Conflict): duas melodias — main e feature — brigando. A (o duelo) → A' (as vozes trocam de
  // lugar: cada branch com a versão da outra) → B (o merge: pela primeira vez as duas cantam juntas, em terças, sobre
  // acordes luminosos — Dó, Sol, Lá menor, Si) → C (o conflito volta: a segunda voz meio tom acima e um passo atrás, rufo) → A.
  'staging-boss': {
    bpm: 150, pulse: true, chromatic: true, timpani: true, arpFilter: 2000,
    form: ['A', 'A2', 'B', 'C'],
    sections: {
      A: {
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
      A2: {
        chords: [[52, 55, 59], [53, 56, 60], [48, 51, 55], [47, 51, 54]],
        melody: [
          [null, null, 76, null, 77, null, 72, null, null, 71, 72, null, 77, null, 76, null],
          [76, null, 79, null, 78, null, 77, null, 71, null, 72, null, 67, null, 68, null],
          [null, 79, null, 77, 76, null, 71, null, 74, null, 79, null, 78, null, 80, null],
          [79, null, 76, null, 75, null, 72, null, 71, null, 70, null, 67, null, 63, null],
        ],
        counter: [
          [76, null, 77, null, 76, null, 71, null, 72, null, 71, null, 76, null, null, null],
          [77, null, 80, null, 77, null, 76, null, 72, null, 71, null, 68, null, null, null],
          [79, null, 78, null, 75, null, 72, null, 75, null, 78, null, 79, null, null, null],
          [78, 77, 75, null, 74, null, 71, null, 70, null, 71, null, 66, null, 64, null],
        ],
      },
      B: {
        chords: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [47, 51, 54]],
        melody: [
          [76, null, null, null, null, null, null, null, 79, null, null, null, null, null, null, null],
          [79, null, null, null, null, null, null, null, 74, null, null, null, null, null, null, null],
          [76, null, null, null, null, null, null, null, 72, null, null, null, 74, null, null, null],
          [75, null, null, null, null, null, null, null, 71, null, null, null, null, null, null, null],
        ],
        counter: [
          [72, null, null, null, null, null, null, null, 76, null, null, null, null, null, null, null],
          [76, null, null, null, null, null, null, null, 71, null, null, null, null, null, null, null],
          [72, null, null, null, null, null, null, null, 69, null, null, null, 71, null, null, null],
          [71, null, null, null, null, null, null, null, 68, null, null, null, null, null, null, null],
        ],
        lead: 'choir', noArp: true, bassEvery: 8,
        drums: { kick: [0, 10], snare: [8], ghost: [], hats: 4, openHat: [], crashEvery: 4, fill: { 12: 47, 13: 45, 14: 43, 15: 40 } },
      },
      C: {
        chords: [[52, 55, 59], [53, 56, 60], [52, 55, 59], [47, 51, 54]],
        melody: [
          [76, null, 77, null, 79, null, 80, null, 79, null, 77, null, 76, null, 75, null],
          [77, null, 80, null, 82, null, 80, null, 77, null, 76, null, 72, null, 71, null],
          [76, null, 79, null, 83, null, 84, null, 83, null, 79, null, 76, null, 75, null],
          [78, null, 79, null, 78, null, 75, null, 71, null, 70, null, 66, null, 64, null],
        ],
        counter: [
          [null, 77, null, 78, null, 80, null, 81, null, 80, null, 78, null, 77, null, 76],
          [null, 78, null, 81, null, 83, null, 81, null, 78, null, 77, null, 73, null, 72],
          [null, 77, null, 80, null, 84, null, 85, null, 84, null, 80, null, 77, null, 76],
          [null, 79, null, 80, null, 79, null, 76, null, 72, null, 71, null, 67, null, 65],
        ],
        roll: true,
        drums: { kick: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12], ghost: [], hats: 2, openHat: [], crashEvery: 2, fill: {} },
      },
    },
  },
  // Pico Production: épico e grandioso — dó menor com o lá bemol dando peso; coral sustentando os acordes, metais
  // dobrando uma melodia larga e heroica (notas longas, saltos de quinta e oitava), taikos e reverb de catedral.
  production: {
    bpm: 132, pulse: true, chromatic: false, timpani: true, arpFilter: 3600, epic: true,
    chords: [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]],
    melody: [
      [72, null, null, null, 79, null, null, null, 77, null, 75, null, 74, null, 75, null],
      [77, null, null, null, 75, null, null, 72, 80, null, null, null, null, null, null, null],
      [77, null, null, null, 82, null, null, null, 80, null, 79, null, 77, null, 74, null],
      [79, null, null, null, 74, null, null, 71, 67, null, null, null, 71, null, 74, null],
    ],
  },
  // Chefe final (Production Outage): rock pesado com coral épico — guitarras distorcidas em "chug" com acentos em
  // power chord, bateria com bumbo duplo, órgão e cordas segurando o acorde, e o coral cantando a melodia em notas
  // longas (dobrado pelos metais). Dó menor. Não é um loop só: A (tema) → A' (variação, mais alto) → B (ponte: outros
  // acordes, meio-tempo, só o coral e acordes longos) → C (subida: chugs contínuos, melodia subindo, rufo na caixa) → A.
  // riff: x = chug abafado · X = acorde aberto · - = pausa.
  'production-boss': {
    bpm: 150, pulse: false, chromatic: false, timpani: true, epic: true, rock: true,
    form: ['A', 'A2', 'B', 'C'],
    sections: {
      A: {
        chords: [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]],
        riff: ['X-xxx-xxX-xxx-xx', 'X-xxx-xxX-xxX-X-', 'X-xxx-xxX-xxx-xx', 'X-xxX-xxX-X-XXXX'],
        melody: [
          [79, null, null, null, null, null, 77, null, 75, null, null, null, 74, null, 75, null],
          [77, null, null, null, null, null, 75, null, 72, null, null, null, null, null, null, null],
          [74, null, null, null, 77, null, null, null, 82, null, null, null, 80, null, 79, null],
          [79, null, null, null, null, null, null, null, 74, null, null, null, 71, null, null, null],
        ],
      },
      A2: {
        chords: [[48, 51, 55], [44, 48, 51], [46, 50, 53], [43, 47, 50]],
        riff: ['X-xxX-xxX-xxX-xx', 'X-xxX-xxX-xxX-X-', 'X-xxX-xxX-xxX-xx', 'X-X-X-X-XXXXXXXX'],
        melody: [
          [84, null, null, null, null, null, 82, null, 80, null, null, null, 79, null, 80, null],
          [80, null, null, null, 79, null, 77, null, 75, null, null, null, 72, null, null, null],
          [77, null, null, null, 82, null, null, null, 86, null, null, null, 84, null, 82, null],
          [83, null, null, null, null, null, null, null, 79, null, 77, null, 74, null, 71, null],
        ],
      },
      // Ponte: o chão some — acordes novos (iv–VI–III–V), bateria em meio-tempo, guitarras só no primeiro tempo.
      B: {
        chords: [[53, 56, 60], [44, 48, 51], [51, 55, 58], [43, 47, 50]],
        riff: ['X---------------', 'X---------------', 'X---------------', 'X-------X---X-X-'],
        melody: [
          [72, null, null, null, null, null, null, null, 75, null, null, null, null, null, null, null],
          [75, null, null, null, null, null, null, null, 72, null, null, null, 70, null, null, null],
          [70, null, null, null, null, null, null, null, 74, null, null, null, null, null, null, null],
          [74, null, null, null, null, null, null, null, 71, null, null, null, null, null, null, null],
        ],
        drums: { kick: [0, 10], snare: [8], ghost: [], hats: 4, openHat: [], crashEvery: 4, taiko: [0, 8], fill: { 12: 47, 13: 45, 14: 43, 15: 40 } },
        bassEvery: 8,
      },
      // Subida: chugs contínuos, a melodia sobe por graus, e a caixa vira um rufo crescente no último compasso.
      C: {
        chords: [[44, 48, 51], [46, 50, 53], [48, 51, 55], [43, 47, 50]],
        riff: ['xxxxxxxxxxxxxxxx', 'xxxxxxxxxxxxxxxx', 'X-xxX-xxX-xxX-xx', 'X-X-X-X-X-X-X-X-'],
        melody: [
          [72, null, null, null, 75, null, null, null, 77, null, null, null, 79, null, null, null],
          [77, null, null, null, 79, null, null, null, 82, null, null, null, 84, null, null, null],
          [84, null, null, null, null, null, null, null, 87, null, null, null, null, null, null, null],
          [86, null, null, null, null, null, null, null, 83, null, null, null, null, null, null, null],
        ],
        drums: { kick: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12], ghost: [], hats: 2, openHat: [], crashEvery: 2, taiko: [0, 4, 8, 12], fill: {} },
        roll: true,
      },
    },
  },
  // Chefe 1 (Legacy Monolith): no estilo dos temas de Castlevania (composição original) — uma introdução sombria de
  // órgão (só na primeira vez) e então o motor: baixo em oitavas pulsando em colcheias, andamento rápido, ré menor
  // harmônico, lead brilhante com vibrato em frases de pergunta e resposta e arpejos de cravo. A → A' (uma oitava
  // acima, com uma segunda voz em terças) → B (ponte: acordes maiores, a melodia respira) → C (corridas em semicolcheias,
  // rufo) → A.
  boss: {
    bpm: 160, pulse: true, chromatic: false, timpani: true, reverb: true, octaveBass: true, vibLead: true,
    intro: 'I',
    form: ['A', 'A2', 'B', 'C'],
    sections: {
      I: {
        chords: [[50, 53, 57], [49, 52, 57]],
        melody: [
          [74, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
          [73, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        ],
        lead: 'organ', noArp: true, noBass: true,
        drums: { kick: [], snare: [], ghost: [], hats: 16, openHat: [], crashEvery: 99, fill: { 8: 50, 10: 47, 12: 45, 13: 45, 14: 43, 15: 43 } },
      },
      A: {
        chords: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]],
        melody: [
          [74, null, 76, 77, 76, null, 74, null, 73, null, 74, null, 77, null, null, null],
          [70, null, 72, 74, 72, null, 70, null, 69, null, 70, null, 74, null, null, null],
          [79, null, 77, 76, 77, null, 79, null, 82, null, 81, null, 79, null, 77, null],
          [76, null, 77, 76, 73, null, 76, null, 81, null, null, null, 80, null, 81, null],
        ],
      },
      A2: {
        chords: [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]],
        melody: [
          [86, null, 88, 89, 88, null, 86, null, 85, null, 86, null, 89, null, 88, 86],
          [82, null, 84, 86, 84, null, 82, null, 81, null, 82, null, 86, null, 84, 82],
          [91, null, 89, 88, 89, null, 91, null, 94, null, 93, null, 91, null, 89, null],
          [88, 89, 88, 86, 85, null, 88, null, 93, null, null, null, 92, null, 93, null],
        ],
        counter: [
          [82, null, 85, 86, 85, null, 82, null, 81, null, 82, null, 86, null, 85, 82],
          [79, null, 81, 82, 81, null, 79, null, 77, null, 79, null, 82, null, 81, 79],
          [88, null, 86, 85, 86, null, 88, null, 91, null, 89, null, 88, null, 86, null],
          [85, 86, 85, 82, 81, null, 85, null, 89, null, null, null, 88, null, 89, null],
        ],
      },
      // Ponte: o céu abre um instante — Si bemol, Dó, Fá e Lá; a melodia em notas longas, a bateria em meio-tempo.
      B: {
        chords: [[46, 50, 53], [48, 52, 55], [53, 57, 60], [45, 49, 52]],
        melody: [
          [77, null, null, null, null, null, 79, null, 81, null, null, null, 79, null, null, null],
          [79, null, null, null, null, null, 77, null, 76, null, null, null, 72, null, null, null],
          [77, null, null, null, null, null, 81, null, 84, null, null, null, 81, null, null, null],
          [81, null, null, null, 80, null, null, null, 76, null, null, null, 73, null, null, null],
        ],
        drums: { kick: [0, 10], snare: [8], ghost: [], hats: 4, openHat: [], crashEvery: 4, fill: { 12: 47, 13: 45, 14: 43, 15: 40 } },
      },
      // Subida: corridas em semicolcheias que sobem, a resposta caindo, e o rufo de volta ao tema.
      C: {
        chords: [[46, 50, 53], [48, 52, 55], [50, 53, 57], [45, 49, 52]],
        melody: [
          [70, 72, 74, 72, 70, 72, 74, 77, 74, 76, 77, 76, 74, 76, 77, 81],
          [72, 74, 76, 74, 72, 74, 76, 79, 76, 77, 79, 77, 76, 77, 79, 84],
          [74, null, 77, null, 81, null, 86, null, 84, null, 81, null, 77, null, 74, null],
          [81, null, null, null, 80, null, null, null, 77, null, 76, null, 73, null, 69, null],
        ],
        roll: true,
        drums: { kick: [0, 2, 4, 6, 8, 10, 12, 14], snare: [4, 12], ghost: [], hats: 2, openHat: [], crashEvery: 2, fill: {} },
      },
    },
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
  const D0 = DRUMS[theme] || DRUMS.localhost;
  // Rock: as guitarras passam por uma saturação e um corte de agudos antes de entrar na mixagem.
  let amp = null;
  if (T.rock) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = distCurve(55); shaper.oversample = '4x';
    const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 3800;
    amp = ctx.createGain(); amp.gain.value = 0.9;
    const post = ctx.createGain(); post.gain.value = 0.22; // a saturação devolve o sinal quase no talo: volta ao nível da mixagem
    amp.connect(shaper); shaper.connect(cab); cab.connect(post); post.connect(out);
  }
  // Temas épicos: um envio para o reverb de catedral (dá tamanho a tudo — coral, metais e tambores).
  if (T.epic || T.reverb) {
    const send = ctx.createGain();
    send.gain.value = 0.42;
    out.connect(send); send.connect(cathedral()); cathedral().connect(musicBus);
  }
  let n = 0;
  let next = ctx.currentTime + 0.08;
  // Forma da música: lista de compassos { seção, compasso na seção }. Temas sem seções são uma seção só.
  const sections = T.sections || { main: { chords: T.chords, melody: T.melody, counter: T.counter, riff: T.riff } };
  const form = T.form || ['main'];
  const barsOf = (name) => sections[name].chords.map((_, b) => ({ sec: sections[name], b, last: b === sections[name].chords.length - 1 }));
  const intro = T.intro ? barsOf(T.intro) : []; // introdução: toca uma vez, o loop não volta a ela
  const loop = form.flatMap(barsOf);
  const total = loop.length * 16;
  const barAt = (k) => (k < intro.length * 16 ? intro[Math.floor(k / 16)] : loop[Math.floor(((k - intro.length * 16) % total) / 16)]);
  const schedule = () => {
    while (next < ctx.currentTime + 0.15) {
      const at = barAt(n);
      const sec = at.sec;
      const bar = at.b;
      const s = n % 16;
      const chord = sec.chords[bar];
      const D = sec.drums ? { ...D0, ...sec.drums } : D0;
      if (s === 0) { strings(next, chord[0] + 12, step * 16, out); strings(next, chord[2] + 12, step * 16, out); organ(next, chord[1] + 12, step * 16, out); }
      if (T.epic) {
        // Coral sustentando o acorde (aberto: fundamental, quinta e terça em cima).
        if (s === 0) for (const m of [chord[0] + 12, chord[2] + 12, chord[1] + 24]) choir(next, m, step * 16, out);
        // Metais: acordes em ataque no 1 e no "e" do 2 (síncope heroica), e uma chamada no fim do compasso.
        if (!T.rock && (s === 0 || s === 6)) for (const m of [chord[0], chord[2], chord[0] + 12]) brass(next, m, step * (s === 0 ? 5 : 2), out, s === 0 ? 1 : 0.75);
        if (!T.rock && s === 14) brass(next, chord[2] + 12, step * 2, out, 0.6);
        if (D.taiko && D.taiko.includes(s)) taiko(next, drums, s === 0 ? 1 : 0.75);
      }
      // Cravo: arpejo da tríade em semicolcheias; nos temas tensos, a vizinha cromática (meio tom acima) no fim de cada meio compasso.
      const arp = [0, 1, 2, 1, 0, 2, 1, 2];
      const tone8 = chord[arp[s % 8]] + 24;
      if (!T.rock && !sec.noArp) harpsichord(next, T.chromatic && s % 8 === 7 ? chord[2] + 25 : tone8, step * 0.9, out, T.arpFilter || 3200);
      // Rock: o riff das guitarras (chug abafado ou power chord aberto) e o coral em canto curto nos tempos fortes.
      if (sec.riff) {
        const hit = sec.riff[bar][s];
        if (T.riffInst === 'organ') {
          if (hit === 'x') organStab(next, chord[0], step * 0.9, out, 0.8);
          if (hit === 'X') organStab(next, chord[0], step * 2.6, out, 1);
        } else if (amp) {
          if (hit === 'x') guitar(next, chord[0] - 12, step * 0.85, amp, true);
          if (hit === 'X') guitar(next, chord[0] - 12, step * 1.7, amp, false);
        }
      }
      if (T.rock && (s === 0 || s === 8)) for (const m of [chord[0] + 12, chord[2] + 12, chord[1] + 24]) chant(next, m, step * 1.2, out, 0.6);
      // Baixo: pulsando em colcheias (tenso) ou em semínimas.
      if (sec.noBass) { /* introdução: só o órgão */ }
      else if (T.octaveBass && !sec.bassEvery) { if (s % 2 === 0) bass(next, chord[0] - 12 + (s % 4 === 2 ? 12 : 0), step * 1.7, out); } // baixo em oitavas, o motor
      else if (sec.bassEvery ? s % sec.bassEvery === 0 : T.pulse ? s % 2 === 0 : s % 4 === 0) bass(next, chord[0] - 12 + (T.pulse && s % 8 === 6 ? 1 : 0), T.pulse ? step * 1.6 : step * 3.5, out);
      // Bateria: no último compasso de cada seção entra a virada de tons no lugar do groove (ou o rufo da subida).
      const fill = at.last && D.fill[s] != null;
      if (sec.roll && at.last && s >= 8) snare(next, drums, 0.35 + (s - 8) * 0.09);
      if (fill) tom(next, D.fill[s], drums);
      else {
        if (D.kick.includes(s)) kick(next, drums, s % 4 === 0 ? 1 : 0.8);
        if (D.snare.includes(s)) snare(next, drums);
        else if (D.ghost.includes(s)) snare(next, drums, 0.3);
      }
      if (s % D.hats === 0 && !fill) hat(next, drums, s % 4 === 0 ? 1.4 : s % 2 === 0 ? 1 : 0.6, D.openHat.includes(s));
      if (s === 0 && bar % D.crashEvery === 0) { crash(next, drums); kick(next, drums); }
      if (T.timpani && s === 12) tone(next, 38, step * 3, { type: 'sine', gain: 0.2, decay: step * 3, out });
      const note = sec.melody[bar][s];
      if (note != null) {
        let len = 1;
        while (s + len < 16 && sec.melody[bar][s + len] == null && len < 4) len++;
        const voiceOf = sec.lead || (T.rock ? 'choir' : 'lead');
        if (voiceOf === 'bells') bells(next, note, step * 8, out);
        else if (voiceOf === 'organ') { organ(next, note - 12, step * 16, out); organ(next, note - 5, step * 16, out); }
        else if (voiceOf === 'choir') {
          // O coral canta a melodia (notas longas) com os metais por baixo.
          let hold = len;
          while (s + hold < 16 && sec.melody[bar][s + hold] == null) hold++;
          chant(next, note, step * hold * 0.98, out, 0.9);
          if (T.epic || T.rock) brass(next, note - 12, step * hold * 0.95, out, 0.5);
        } else if (T.vibLead) {
          leadVib(next, note, step * len * 0.95, out);
        } else {
          lead(next, note, step * len * 0.95, out);
          if (T.epic) brass(next, note - 12, step * len * 0.95, out, 0.55); // melodia dobrada pelos metais, uma oitava abaixo
        }
      }
      const other = sec.counter && sec.counter[bar][s];
      if (other != null) {
        let len = 1;
        while (s + len < 16 && sec.counter[bar][s + len] == null && len < 4) len++;
        if (sec.lead === 'choir') {
          // As duas vozes juntas no coral (o "merge"): segura até a próxima nota, como a melodia.
          let hold = len;
          while (s + hold < 16 && sec.counter[bar][s + hold] == null) hold++;
          chant(next, other, step * hold * 0.98, out, 0.75);
        } else lead2(next, other, step * len * 0.95, out);
      }
      n++;
      next += step;
    }
  };
  schedule();
  const timer = setInterval(schedule, 25);
  music = { timer, out, drums, amp };
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
/* ─────────────── golpes com impacto: barramento saturado + camadas de pancada, lâmina e tiro ─────────────── */
let punch = null;
/** Barramento dos golpes: saturação (corpo e agressividade) + compressor (soco "na cara" sem estourar). */
function punchBus() {
  if (punch) return punch;
  const drive = ctx.createWaveShaper();
  const n = 1024; const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.6); }
  drive.curve = curve; drive.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 4; comp.ratio.value = 6; comp.attack.value = 0.001; comp.release.value = 0.12;
  punch = ctx.createGain(); punch.gain.value = 0.9;
  punch.connect(drive); drive.connect(comp); comp.connect(master);
  return punch;
}
/** Ruído filtrado com varredura (lâmina cortando o ar, estouro, crepitação). type: bandpass | lowpass | highpass. */
function swish(t, dur, { gain = 0.2, type = 'bandpass', from = 800, to = 5000, q = 1.4, attack = 0.004, out } = {}) {
  if (!noiseBuf) noise(t, 0.001, { gain: 0 });
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(out || punchBus());
  src.start(t); src.stop(t + dur + 0.02);
}
/** Pancada: "tum" grave despencando + estalo seco no ataque + corpo médio. power 0–1.5. */
function thump(t, power = 1, out) {
  const o = out || punchBus();
  tone(t, 45, 0.28, { type: 'sine', gain: 0.55 * power, slideTo: 22, decay: 0.28, out: o });
  tone(t, 57, 0.08, { type: 'triangle', gain: 0.25 * power, slideTo: 40, decay: 0.08, out: o });
  swish(t, 0.018, { gain: 0.5 * power, type: 'highpass', from: 2500, to: 2500, q: 0.7, attack: 0.001, out: o });
  swish(t, 0.12, { gain: 0.3 * power, type: 'lowpass', from: 1800, to: 300, q: 0.8, attack: 0.002, out: o });
}
/** Aço: parciais inarmônicos agudos decaindo rápido (o "shing" de uma lâmina). */
function steel(t, midi = 98, dur = 0.35, gain = 0.09, out) {
  for (const [r, g] of [[1, 1], [2.76, 0.6], [5.4, 0.35], [8.93, 0.18]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(hz(midi) * r, t);
    const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(gain * g, t + 0.003);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur / Math.sqrt(r));
    o.connect(gn); gn.connect(out || punchBus()); o.start(t); o.stop(t + dur + 0.05);
  }
}
/** Tiro/estouro: ruído largo com o brilho caindo + boom grave + crepitação. */
function blast(t, power = 1) {
  swish(t, 0.16, { gain: 0.6 * power, type: 'lowpass', from: 9000, to: 400, q: 0.6, attack: 0.001 });
  tone(t, 40, 0.35, { type: 'sine', gain: 0.5 * power, slideTo: 20, decay: 0.35, out: punchBus() });
  for (let k = 1; k < 5; k++) swish(t + 0.03 + k * 0.022, 0.025, { gain: 0.18 * power, type: 'highpass', from: 4500, to: 4500, attack: 0.001 });
}

const SFX = {
  hit: (t) => { tone(t, 64, 0.09, { type: 'square', gain: 0.1, slideTo: 52, decay: 0.09 }); noise(t, 0.05, { gain: 0.05, hp: 2500 }); },
  crit: (t) => { thump(t, 1.1); steel(t, 96, 0.4, 0.09); swish(t, 0.05, { gain: 0.6, type: 'highpass', from: 3000, to: 3000, attack: 0.001 }); tone(t + 0.04, 88, 0.12, { type: 'square', gain: 0.07, decay: 0.12, out: punchBus() }); },
  enemyHit: (t) => { thump(t, 0.7); swish(t, 0.07, { gain: 0.35, from: 1800, to: 600, q: 1.5, attack: 0.002 }); tone(t, 52, 0.12, { type: 'sawtooth', gain: 0.08, slideTo: 38, decay: 0.12, filter: 1400, out: punchBus() }); },
  miss: (t) => { noise(t, 0.14, { gain: 0.05, hp: 4000 }); tone(t, 79, 0.1, { type: 'triangle', gain: 0.04, slideTo: 74, decay: 0.1 }); },
  heal: (t) => { [72, 76, 79, 84].forEach((m, i) => tone(t + i * 0.05, m, 0.18, { type: 'sine', gain: 0.07, decay: 0.18 })); },
  ability: (t) => { [67, 71, 74, 79, 83].forEach((m, i) => tone(t + i * 0.035, m, 0.12, { type: 'square', gain: 0.06, decay: 0.12, filter: 3500 })); },
  item: (t) => { tone(t, 79, 0.08, { type: 'square', gain: 0.06, decay: 0.08 }); tone(t + 0.07, 86, 0.14, { type: 'square', gain: 0.06, decay: 0.14 }); },
  down: (t) => { tone(t, 60, 0.35, { type: 'sawtooth', gain: 0.08, slideTo: 36, filter: 1200 }); },
  // Efeito visual de ataque: o som de cada pet (tocado no início do golpe; o impacto cai em ~0,22 s, ou ~0,3 s de longe).
  // Tudo passa pelo barramento de impacto (saturação + compressor).
  // Byte: a lâmina cortando o ar e o golpe — "fssh" + "SHING" de aço + pancada.
  'atk-slash': (t) => {
    swish(t + 0.05, 0.17, { gain: 0.32, from: 500, to: 6500, q: 1.6, attack: 0.12 });
    swish(t + 0.21, 0.05, { gain: 0.55, type: 'highpass', from: 3500, to: 3500, attack: 0.001 });
    steel(t + 0.21, 100, 0.45, 0.1);
    thump(t + 0.21, 0.7);
  },
  // Git: o bote no ar e três garradas rasgando (cada uma um corte curto e agudo).
  'atk-claw': (t) => {
    swish(t, 0.2, { gain: 0.22, from: 300, to: 1600, q: 1, attack: 0.08 });
    [0.21, 0.255, 0.3].forEach((d, k) => {
      swish(t + d, 0.06, { gain: 0.5, from: 2200, to: 8000, q: 2, attack: 0.002 });
      steel(t + d, 103 - k * 3, 0.16, 0.05);
    });
    thump(t + 0.21, 0.55);
  },
  // Query: o tentáculo zunindo e o estalo seco do chicote, com pancada.
  'atk-whip': (t) => {
    swish(t + 0.03, 0.18, { gain: 0.26, from: 400, to: 3500, q: 1.2, attack: 0.15 });
    swish(t + 0.21, 0.025, { gain: 0.8, type: 'highpass', from: 2800, to: 2800, attack: 0.0008 });
    tone(t + 0.21, 96, 0.05, { type: 'square', gain: 0.12, slideTo: 72, decay: 0.05, out: punchBus() });
    thump(t + 0.21, 0.65);
  },
  // Memo: o mergulho rasgando o ar e a estocada que perfura — impacto curto, agudo e pesado.
  'atk-pierce': (t) => {
    swish(t, 0.08, { gain: 0.25, type: 'lowpass', from: 900, to: 400, attack: 0.01 });
    swish(t + 0.06, 0.16, { gain: 0.32, from: 700, to: 7000, q: 1.8, attack: 0.13 });
    swish(t + 0.22, 0.04, { gain: 0.6, from: 6000, to: 1500, q: 2.5, attack: 0.001 });
    steel(t + 0.22, 108, 0.2, 0.08);
    thump(t + 0.22, 0.8);
  },
  // Relay: a rajada sai como um disparo de ar e acerta com estrondo.
  'atk-wind': (t) => {
    swish(t, 0.06, { gain: 0.3, type: 'lowpass', from: 700, to: 200, attack: 0.002 });
    swish(t + 0.04, 0.3, { gain: 0.38, from: 300, to: 3200, q: 0.9, attack: 0.03 });
    swish(t + 0.3, 0.2, { gain: 0.45, type: 'lowpass', from: 4000, to: 300, q: 0.7, attack: 0.002 });
    thump(t + 0.3, 0.85);
  },
  // Noxi: carga subindo e o DISPARO — estouro elétrico com boom e crepitação.
  'atk-zap': (t) => {
    tone(t, 55, 0.27, { type: 'sawtooth', gain: 0.06, slideTo: 91, filter: 3000, out: punchBus() });
    tone(t, 67, 0.27, { type: 'square', gain: 0.025, slideTo: 103, filter: 2500, out: punchBus() });
    blast(t + 0.28, 1);
    tone(t + 0.28, 98, 0.12, { type: 'sawtooth', gain: 0.08, slideTo: 60, decay: 0.12, out: punchBus() });
  },
  // Lint: o arremesso zunindo e a noz batendo como uma pedrada (estalo de madeira + pancada).
  'atk-throw': (t) => {
    swish(t, 0.12, { gain: 0.3, from: 600, to: 2600, q: 1.3, attack: 0.04 });
    swish(t + 0.31, 0.03, { gain: 0.7, from: 1600, to: 1200, q: 3, attack: 0.001 });
    tone(t + 0.31, 79, 0.05, { type: 'triangle', gain: 0.2, slideTo: 70, decay: 0.05, out: punchBus() });
    thump(t + 0.31, 0.9);
  },
  // Armo: a bola rolando (ronco e cascalho) e o choque pesado no impacto.
  roll: (t) => {
    tone(t, 33, 0.24, { type: 'sawtooth', gain: 0.1, slideTo: 45, filter: 420, out: punchBus() });
    for (let k = 0; k < 6; k++) swish(t + k * 0.035, 0.03, { gain: 0.16, type: 'highpass', from: 900, to: 900, attack: 0.002 });
    thump(t + 0.23, 1.3);
    swish(t + 0.23, 0.25, { gain: 0.35, type: 'lowpass', from: 1200, to: 150, attack: 0.002 });
  },
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
