// Makes the candidate styles for Dual Input's sounds, which the user picks from by ear at
// stage 20b. Each style plays take-control's two cues, control passed and refused, and
// sketches the voice phrases' two later ones, an offer opening and an offer timing out, so a
// style that can't stretch to four shows before it's picked
// (record/areas/product/03-v1-scope.md, "Voice phrases").
//
// Every cue goes through Opus at 24 kbps, as the core embeds a sound, and is set to the
// loudness of stage 20's stand-in for control passing, so the styles differ in character alone.
//
//   node experiments/areas/control/sounds/make.mjs <page.html> [<iowa folder>]
//
// It needs ffmpeg, with libopus, on the PATH. It writes the listening page, with the round
// `ROUND` names, to the path it's given, and keeps no other output. The styles
// cut from recordings need the folder the University of Iowa's files were downloaded to, and
// they're left out without it: Marimba.yarn.pp.C5B5.aif, Vibraphone.bow.C5B5.aif, and
// Piano.pp.C5.aiff, E5, Ab5, and B5, from theremin.music.uiowa.edu/MIS.html, which publishes
// them to be "used for any projects, without restrictions".

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 48_000;
const here = dirname(fileURLToPath(import.meta.url));
const standIns = join(here, '../../../../src/features/take-control/core/src/sounds');
const [pagePath, iowa] = process.argv.slice(2);
if (!pagePath) {
  console.error('usage: node experiments/areas/control/sounds/make.mjs <page.html> [<iowa folder>]');
  process.exit(1);
}

const semitones = (hz, n) => hz * 2 ** (n / 12);
const TAU = 2 * Math.PI;

// The same noise on every run, so a cue sounds the same each time it's made.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A biquad's coefficients, from Robert Bristow-Johnson's Audio EQ Cookbook.
function biquad(type, hz, q) {
  const w = (TAU * hz) / RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const [b0, b1, b2] = {
    lowpass: [(1 - cos) / 2, 1 - cos, (1 - cos) / 2],
    highpass: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2],
    bandpass: [alpha, 0, -alpha],
  }[type];
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function run(samples, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    samples[i] = y;
  }
  return samples;
}

// A struck note: partials at multiples of `hz`, each with its own level and decay, and each
// rising over its `attack` so the note starts without a click. `wobble(t)` scales the whole
// note by the cue's time, as a vibraphone's motor does.
function strike(out, at, hz, level, partials, wobble = () => 1) {
  const first = Math.round(at * RATE);
  for (const { ratio, amp, decay, attack = 0.0015, detune = 0 } of partials) {
    const w = (TAU * (hz * ratio + detune)) / RATE;
    if (amp === 0 || w >= Math.PI * 0.8) continue;
    for (let i = 0; first + i < out.length; i++) {
      const t = i / RATE;
      const shape = Math.min(t / attack, 1) * Math.exp(-t / decay);
      if (t > attack && shape < 1e-5) break;
      out[first + i] += level * amp * shape * wobble(at + t) * Math.sin(w * i);
    }
  }
}

// A held tone: partials at multiples of `hz` that rise over `attack`, hold for `hold` seconds,
// then fall away with a time constant of `release`.
function tone(out, at, hz, level, { hold, attack = 0.004, release, partials }) {
  const first = Math.round(at * RATE);
  for (let i = 0; first + i < out.length && i / RATE < hold + release * 10; i++) {
    const t = i / RATE;
    const shape = Math.min(t / attack, 1) * (t < hold ? 1 : Math.exp(-(t - hold) / release));
    let sum = 0;
    for (const [ratio, amp] of partials) {
      if (hz * ratio < RATE * 0.4) sum += amp * Math.sin((TAU * hz * ratio * i) / RATE);
    }
    out[first + i] += level * shape * sum;
  }
}

// A burst of filtered noise: the strike of a mallet on wood, or a knuckle on a block.
function burst(out, at, level, { hz, q, decay, seed }) {
  const length = Math.round(decay * 12 * RATE);
  const next = random(seed);
  const noise = new Float64Array(length);
  for (let i = 0; i < length; i++) noise[i] = (next() * 2 - 1) * Math.exp(-i / RATE / decay);
  run(noise, biquad('bandpass', hz, q));
  const first = Math.round(at * RATE);
  for (let i = 0; i < length && first + i < out.length; i++) out[first + i] += level * noise[i];
}

// A two-operator FM voice: a carrier at `hz` whose phase a modulator at `ratio` times `hz`
// pushes by an index that dies away over `bright` seconds, so the note starts bright and mellows.
function fm(out, at, hz, level, { ratio, index, bright, decay, attack = 0.002 }) {
  const first = Math.round(at * RATE);
  const carrier = (TAU * hz) / RATE;
  const modulator = carrier * ratio;
  for (let i = 0; first + i < out.length; i++) {
    const t = i / RATE;
    const shape = Math.min(t / attack, 1) * Math.exp(-t / decay);
    if (t > attack && shape < 1e-5) break;
    const push = index * Math.exp(-t / bright) * Math.sin(modulator * i);
    out[first + i] += level * shape * Math.sin(carrier * i + push);
  }
}

// The pitch at `t` along `path`, a list of [seconds, hz] where the first is at 0, gliding
// from each pitch to the next over `glide` seconds.
function pitch(path, glide, t) {
  let from = path[0][1];
  for (const [start, to] of path.slice(1)) {
    if (t <= start) return from;
    const x = Math.min((t - start) / glide, 1);
    if (x < 1) return from * (to / from) ** (x * x * (3 - 2 * x));
    from = to;
  }
  return from;
}

// A soft synthesizer note: two band-limited saws 12 cents apart, gliding along `path`,
// through a low-pass filter whose cutoff follows `cutoff(t)`. The filter is Zavalishin's
// state-variable filter, which stays stable while its cutoff moves every sample.
function synth(out, at, level, { path, glide, attack, decay, cutoff, q = 0.8 }) {
  const first = Math.round(at * RATE);
  const length = out.length - first;
  const phases = [0, 0.37];
  const spread = [2 ** (-6 / 1200), 2 ** (6 / 1200)];
  let ic1 = 0, ic2 = 0;
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    const hz = pitch(path, glide, t);
    let saw = 0;
    for (let o = 0; o < 2; o++) {
      phases[o] = (phases[o] + (hz * spread[o]) / RATE) % 1;
      const top = Math.min(24, Math.floor(12_000 / (hz * spread[o])));
      for (let k = 1; k <= top; k++) saw += Math.sin(TAU * k * phases[o]) / k;
    }
    const g = Math.tan((Math.PI * Math.min(cutoff(t), RATE * 0.45)) / RATE);
    const a1 = 1 / (1 + g * (g + 1 / q));
    const a2 = g * a1;
    const v3 = saw * 0.5 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + g * a2 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    out[first + i] += level * Math.min(t / attack, 1) * Math.exp(-t / decay) * v2;
  }
}

// A plucked string, by Karplus and Strong's method: the string's shape as it's let go, one
// period long, circles a delay line, and averaging each sample with the one before as it comes
// round takes the high overtones away first, as a string loses them. A finger pulls the string
// into a triangle a fifth of the way along it, whose overtones fall away fast, with a little
// noise for the skin; `soft` smooths it further, toward 1 for a muted string.
function pluck(out, at, hz, level, { decay, soft, seed }) {
  const first = Math.round(at * RATE);
  const length = out.length - first;
  const period = RATE / hz - 0.5; // the averaging delays the loop by half a sample
  const loss = Math.exp(-1 / (decay * hz));
  const next = random(seed);
  const span = Math.round(period);
  const excite = new Float64Array(span);
  let smooth = 0, mean = 0;
  for (let i = 0; i < span; i++) {
    const x = i / span;
    const shape = x < 0.2 ? x / 0.2 : (1 - x) / 0.8;
    smooth = soft * smooth + (1 - soft) * (shape + 0.08 * (next() * 2 - 1));
    excite[i] = smooth;
    mean += smooth / span;
  }
  const y = new Float64Array(length);
  const back = (k) => {
    if (k < 0) return 0;
    const i = Math.floor(k);
    return y[i] + (y[i + 1] - y[i]) * (k - i);
  };
  for (let n = 0; n < length; n++) {
    const fed = 0.5 * (back(n - period) + back(n - period - 1));
    y[n] = (n < span ? excite[n] - mean : 0) + loss * fed;
    out[first + n] += level * y[n];
  }
}

// A blown note, as a wooden flute plays it: a near-pure tone along `path`, breath noise tuned
// around it, a puff of air as it starts, and a slow vibrato that comes in after 0.1s.
function blow(out, at, level, { path, glide = 0.02, hold, attack = 0.03, release = 0.06, breath = 0.1, seed }) {
  const first = Math.round(at * RATE);
  const length = Math.min(out.length - first, Math.round((hold + release * 8) * RATE));
  const next = random(seed);
  const air = new Float64Array(length);
  for (let i = 0; i < length; i++) air[i] = next() * 2 - 1;
  run(air, biquad('bandpass', path[0][1], 3));
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    const swell = Math.min(t / attack, 1);
    const shape = swell * swell * (3 - 2 * swell) * (t < hold ? 1 : Math.exp(-(t - hold) / release));
    const vibrato = 1 + 0.004 * Math.sin(TAU * 5 * t) * Math.min(Math.max((t - 0.1) / 0.1, 0), 1);
    phase += (pitch(path, glide, t) * vibrato) / RATE;
    const note = Math.sin(TAU * phase) + 0.1 * Math.sin(2 * TAU * phase) + 0.035 * Math.sin(3 * TAU * phase);
    const puff = 2 * swell * Math.exp(-t / 0.02);
    out[first + i] += level * (shape * note + breath * (shape + puff) * air[i]);
  }
}

// A brass note by FM, carrier and modulator at one pitch: the index follows the note's own
// level, so it brightens as it swells and mellows as it fades, as a horn does, and a low-pass
// keeps it warm.
function brass(out, at, level, { path, glide = 0.03, hold, attack = 0.04, release = 0.08, bright = 2.2, cutoff = 2000 }) {
  const first = Math.round(at * RATE);
  const length = Math.min(out.length - first, Math.round((hold + release * 8) * RATE));
  const voice = new Float64Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / RATE;
    const swell = Math.min(t / attack, 1);
    const shape = swell ** 1.5 * (t < hold ? 1 : Math.exp(-(t - hold) / release));
    phase += pitch(path, glide, t) / RATE;
    voice[i] = shape * Math.sin(TAU * phase + bright * shape * Math.sin(TAU * phase));
  }
  run(voice, biquad('lowpass', cutoff, 0.707));
  for (let i = 0; i < length; i++) out[first + i] += level * voice[i];
}

// A drop into water: a sine whose pitch climbs by `rise` of itself over 60ms as it rings down,
// which is how a bubble sounds as it forms. A negative `rise` sinks instead.
function bubble(out, at, hz, level, { rise, decay }) {
  const first = Math.round(at * RATE);
  let phase = 0;
  for (let i = 0; first + i < out.length; i++) {
    const t = i / RATE;
    const shape = Math.min(t / 0.003, 1) * Math.exp(-t / decay);
    if (t > 0.003 && shape < 1e-5) break;
    phase += (hz * (1 + rise * Math.min(t / 0.06, 1))) / RATE;
    out[first + i] += level * shape * Math.sin(TAU * phase);
  }
}

// A recording from the Iowa folder, as 48 kHz mono samples.
function recording(name) {
  const raw = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(iowa, name), '-ac', '1', '-ar', String(RATE), '-f', 'f64le', '-'], { maxBuffer: 1 << 30 });
  return new Float64Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
}

function levels(samples, block) {
  const out = [];
  for (let i = 0; i + block <= samples.length; i += block) out.push(peak(samples.subarray(i, i + block)));
  return out;
}

// Where each struck note in a recording starts: a 5ms block three times louder than any in the
// 50ms before it, and above 3% of the recording's peak, at least 1s after the last start.
function strikes(samples) {
  const block = RATE / 200;
  const level = levels(samples, block);
  const top = Math.max(...level);
  const starts = [];
  for (let b = 10; b < level.length; b++) {
    const before = Math.max(...level.slice(b - 10, b));
    if (level[b] > top * 0.03 && level[b] > before * 3 && (!starts.length || b - starts.at(-1) > 200)) starts.push(b);
  }
  return starts.map((b) => b * block);
}

// Where each bowed note in a recording is fullest: the loudest 50ms block of each run of blocks
// above a fifth of the recording's peak, where runs under 6s apart are one note whose bow
// faltered, since the recording's notes are 11s to 17s apart. A bow takes about 2s to bring a bar to full voice, too long for a cue, so a bowed
// cue starts from there.
function swells(samples) {
  const block = RATE / 20;
  const level = levels(samples, block);
  const top = Math.max(...level);
  const fullest = [];
  let best = -1;
  level.forEach((l, b) => {
    if (l > top * 0.2) {
      if (best < 0 || l > level[best]) best = b;
    } else if (best >= 0) {
      const last = fullest.at(-1);
      if (last !== undefined && best - last < 120) {
        if (level[best] > level[last]) fullest[fullest.length - 1] = best;
      } else {
        fullest.push(best);
      }
      best = -1;
    }
  });
  return fullest.map((b) => b * block);
}

// One instrument's notes, each cut from 3ms before it starts, keyed by semitones from C5. A note
// it lacks is the nearest one it has played faster or slower, as a sampler does, which moves
// the note's timbre a little with its pitch.
// The player's notes vary in loudness, so each is set to one level over its first 150ms, and a
// cue's own `v` alone sets how hard a note sounds.
function instrument(notes) {
  for (const [k, sound] of notes) {
    const head = sound.subarray(0, Math.round(0.15 * RATE));
    const rms = Math.sqrt(head.reduce((sum, x) => sum + x * x, 0) / head.length);
    notes.set(k, sound.map((x) => (x * 0.1) / rms));
  }
  return (k, seconds) => {
    const near = [...notes.keys()].reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a));
    const source = notes.get(near);
    const speed = 2 ** ((k - near) / 12);
    const out = new Float64Array(Math.round(seconds * RATE));
    for (let i = 0; i < out.length; i++) {
      const x = i * speed;
      const j = Math.floor(x);
      if (j + 1 >= source.length) break;
      out[i] = source[j] + (source[j + 1] - source[j]) * (x - j);
    }
    return out;
  };
}

function cut(samples, starts) {
  if (starts.length !== 12) throw new Error(`found ${starts.length} notes where C5 to B5 has 12`);
  const lead = Math.round(0.003 * RATE);
  return new Map(starts.map((s, k) => [k, samples.slice(Math.max(s - lead, 0), s + RATE)]));
}

const C5 = 523.25;

// A recorded note, played at `hz`, `v` loud. A refusal's note is damped 10ms after it starts,
// as a hand on the bar or the piano's damper would.
function sample(out, at, hz, v, muted, { attack = 0, decay = Infinity, mutedDecay = 0.06 }, note) {
  const sound = note(Math.round(12 * Math.log2(hz / C5)), 0.8);
  const first = Math.round(at * RATE);
  for (let i = 0; i < sound.length && first + i < out.length; i++) {
    const t = i / RATE;
    const swell = attack ? Math.min(t / attack, 1) : 1;
    const fall = muted ? Math.exp(-Math.max(t - 0.01, 0) / mutedDecay) : Math.exp(-t / decay);
    out[first + i] += v * swell * swell * (3 - 2 * swell) * fall * sound[i];
  }
}

// A small room, from Freeverb's eight combs and four all-passes, so a note sounds played
// somewhere rather than inside the headset. `scale` shrinks the room's delays.
function room(samples, { size, damp, wet, scale = 1 }) {
  const line = (n) => ({ buf: new Float64Array(Math.round((n * scale * RATE) / 44_100)), i: 0, store: 0 });
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(line);
  const passes = [556, 441, 341, 225].map(line);
  const feedback = 0.7 + 0.28 * size;
  for (let s = 0; s < samples.length; s++) {
    const x = samples[s] * 0.015;
    let y = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.store = o * (1 - damp) + c.store * damp;
      c.buf[c.i] = x + c.store * feedback;
      c.i = (c.i + 1) % c.buf.length;
      y += o;
    }
    for (const p of passes) {
      const o = p.buf[p.i];
      p.buf[p.i] = y + o * 0.5;
      p.i = (p.i + 1) % p.buf.length;
      y = o - y;
    }
    samples[s] += wet * 3 * y;
  }
}

// Cuts what's below 150Hz, which a headset's engine noise covers anyway, and adds the style's
// room. Over the last 0.2s it damps the cue, as a hand on a bell would, and fades the last 30ms,
// so a tail that would ring past the cue's length dies away rather than stopping. Round three
// leaves out the cut and the damping where the stand-ins had neither.
function finish(samples, reverb, { lowCut = true, damp = true } = {}) {
  if (lowCut) run(samples, biquad('highpass', 150, 0.707));
  if (reverb) room(samples, reverb);
  const damped = Math.max(samples.length - Math.round((damp ? 0.2 : 0.03) * RATE), 0);
  for (let i = damped; i < samples.length; i++) {
    const left = (samples.length - 1 - i) / (0.03 * RATE);
    const fade = left < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * left) : 1;
    samples[i] *= (damp ? Math.exp(-(i - damped) / RATE / 0.07) : 1) * fade;
  }
  return samples;
}

// The loudest 400ms of a cue in LUFS, as ITU-R BS.1770 measures momentary loudness: K-weighted,
// with silence around a cue shorter than the window.
function loudness(samples) {
  const window = 0.4 * RATE;
  const x = new Float64Array(samples.length + 2 * window);
  x.set(samples, window);
  run(x, { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 });
  run(x, { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 });
  const sums = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) sums[i + 1] = sums[i] + x[i] * x[i];
  let loudest = 0;
  for (let s = 0; s + window <= x.length; s += RATE / 100) {
    loudest = Math.max(loudest, (sums[s + window] - sums[s]) / window);
  }
  return -0.691 + 10 * Math.log10(loudest);
}

const peak = (samples) => samples.reduce((top, s) => Math.max(top, Math.abs(s)), 0);

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32_767), i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// A 16-bit mono WAV's samples, found by walking its chunks, since ffmpeg may write others.
function samplesOf(file) {
  for (let at = 12; at < file.length; ) {
    const id = file.toString('ascii', at, at + 4);
    const size = file.readUInt32LE(at + 4);
    if (id === 'data') {
      const out = new Float64Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = file.readInt16LE(at + 8 + i * 2) / 32_768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('the WAV has no data chunk');
}

const work = mkdtempSync(join(tmpdir(), 'dualinput-sounds-'));
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

// The cue as a pilot hears it: through Opus at 24 kbps, which the helper's encoder uses for a
// feature's sound, at complexity 5, then decoded again.
function asShipped(opus, name) {
  const out = join(work, `${name}.wav`);
  ffmpeg('-i', opus, '-ar', String(RATE), '-ac', '1', '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', out);
  return readFileSync(out);
}

function encode(samples, name) {
  const source = join(work, `${name}.source.wav`);
  writeFileSync(source, wav(samples));
  const opus = join(work, `${name}.opus`);
  ffmpeg('-i', source, '-c:a', 'libopus', '-b:a', '24k', '-application', 'audio', '-compression_level', '5', opus);
  return asShipped(opus, name);
}

// Each cue's notes, in semitones from the style's root, with when each starts and how hard it's
// played. Control passing rises a fifth, and a refusal falls a tritone, lower and muted. The
// offer taps the root twice, so control passing after it climbs from the note the offer left;
// the offer timing out falls a fourth, 3dB softer, since nothing's wrong.
const cues = {
  passed: { seconds: 0.65, notes: [{ t: 0, n: 0, v: 0.8 }, { t: 0.115, n: 7, v: 1 }] },
  refused: { seconds: 0.45, muted: true, notes: [{ t: 0, n: -5, v: 1 }, { t: 0.12, n: -11, v: 0.9 }] },
  offer: { seconds: 0.55, notes: [{ t: 0, n: 0, v: 0.9 }, { t: 0.1, n: 0, v: 0.55 }] },
  timeout: { seconds: 0.65, softer: 3, notes: [{ t: 0, n: 0, v: 0.8 }, { t: 0.14, n: -5, v: 0.65 }] },
};

// Passing control as three notes up a major chord, as fingers roll it on a string or a tine.
const rolled = (gap) => ({ notes: [{ t: 0, n: 0, v: 0.7 }, { t: gap, n: 4, v: 0.8 }, { t: 2 * gap, n: 7, v: 1 }] });

// Stage 20's stand-in cues, as src/apps/core-helper/src/audio/sound.rs makes them, with one
// thing changed: `rise`, the seconds each note takes to start; `ring`, how many times longer
// each fades; `shimmer`, how many hertz a second, half-level voice sits above each partial;
// `shift`, how many semitones every note moves; `second`, control passing's second note; and
// `tail`, seconds added to each cue for a ring or a room to die away in. The offer and its
// timing out, which the stand-ins never had, follow round one's motifs from the same G5.
//
// Round four fills the notes out: `fuller` gives each six overtones, the higher ones fading
// sooner, as a struck note's do; `octave` sounds each note an octave below too, at half level;
// and `chord` puts the rest of a G major chord under each chime note, and a minor third under
// each refusal note.
const CHIME = [[1, 1], [2, 0.22], [3, 0.05]];
const DULL = [[1, 1], [3, 0.28], [5, 0.1]];
const FULL_CHIME = [[1, 1], [2, 0.4], [3, 0.22], [4, 0.12], [5, 0.07], [6, 0.04]];
const FULL_DULL = [[1, 1], [2, 0.15], [3, 0.4], [4, 0.08], [5, 0.2], [7, 0.1]];
function standIn({ rise = 0.004, ring = 1, shimmer = 0, shift = 0, second = 1175, tail = 0, fuller = false, octave = false, chord = false } = {}) {
  const voice = (out, at, hz, fade, level, overtones) => {
    const partials = overtones.flatMap(([ratio, share]) => {
      const decay = (fade * ring) / (fuller ? 1 + 0.25 * (ratio - 1) : 1);
      return [
        { ratio, amp: share, decay, attack: rise },
        ...(shimmer ? [{ ratio, amp: share * 0.5, decay, attack: rise, detune: shimmer }] : []),
      ];
    });
    strike(out, at, semitones(hz, shift), level, partials);
  };
  // `under` lists the chord's notes below this one, in semitones, each with its share of level.
  const note = (out, at, hz, fade, level, dull, under = []) => {
    const overtones = dull ? (fuller ? FULL_DULL : DULL) : fuller ? FULL_CHIME : CHIME;
    voice(out, at, hz, fade, level, overtones);
    for (const [n, share] of [...(chord ? under : []), ...(octave ? [[-12, 0.5]] : [])]) {
      voice(out, at, semitones(hz, n), fade, level * share, overtones);
    }
  };
  const major = (thirdBelow, fifthBelow) => [[thirdBelow, 0.45], [fifthBelow, 0.35]];
  return (cue) => {
    const seconds = { passed: 0.55, refused: 0.4, offer: 0.5, timeout: 0.55 }[cue] + tail;
    const out = new Float64Array(Math.round(seconds * RATE));
    if (cue === 'passed') {
      note(out, 0, 784, 0.11, 0.24, false, major(-5, -8));
      note(out, 0.12, second, 0.15, 0.24, false, major(-3, -7));
    } else if (cue === 'refused') {
      note(out, 0, 311, 0.05, 0.34, true, [[-3, 0.45]]);
      note(out, 0.13, 233, 0.07, 0.34, true, [[-3, 0.45]]);
    } else if (cue === 'offer') {
      note(out, 0, 784, 0.11, 0.24, false, major(-5, -8));
      note(out, 0.1, 784, 0.11, 0.14, false, major(-5, -8));
    } else {
      note(out, 0, 784, 0.11, 0.24, false, major(-5, -8));
      note(out, 0.14, 587.33, 0.15, 0.19, false, major(-3, -7));
    }
    return out;
  };
}

// The stand-ins as Dual Input ships them, which rounds three and four start from.
function asIs(round) {
  return {
    id: 'as-is',
    round,
    family: 'Today',
    name: 'As they are',
    blurb: 'Stage 20’s stand-ins, unchanged. The offer and its timing out are new, in the same style.',
    shipped: true,
    render: standIn(),
  };
}

function played(style, cue) {
  const { seconds, muted, notes } = { ...cues[cue], ...style.cues?.[cue] };
  const out = new Float64Array(Math.round(seconds * RATE));
  for (const note of notes) {
    style.play(out, note.t, semitones(style.root, note.n), note.v, muted, note);
    if (note.with !== undefined) style.play(out, note.t, semitones(style.root, note.with), note.v * 0.5, muted, note);
  }
  return out;
}

const vibraphone = {
  id: 'vibraphone',
  family: 'Struck',
  name: 'Vibraphone',
  blurb: 'Metal bars struck with soft yarn mallets. Pure and mellow, with a long, gentle ring.',
  root: 523.25, // C5
  reverb: { size: 0.25, damp: 0.4, wet: 0.16 },
  play(out, at, hz, v, muted) {
    // An aluminum bar tuned like a marimba's, at 4 and 10 times its pitch, but ringing far longer.
    const decay = (muted ? 0.09 : 1.4) * Math.sqrt(523 / hz);
    const motor = this.motor ? (t) => 1 - 0.4 * (0.5 + 0.5 * Math.sin(TAU * 5.5 * t)) : undefined;
    strike(out, at, hz, v * 0.45, [
      { ratio: 1, amp: 1, decay, attack: 0.004 },
      { ratio: 4, amp: muted ? 0.05 : 0.12, decay: decay * 0.15, attack: 0.003 },
      { ratio: 10, amp: muted ? 0 : 0.02, decay: decay * 0.04 },
    ], motor);
    burst(out, at, v * 0.04, { hz: 1500, q: 0.7, decay: 0.002, seed: Math.round(hz) });
  },
};

// Round one, 2026-11-15, was marimba, glass, electric piano, knock, panel tone, and soft synth.
// The user liked none. Soft synth went out first; panel tone felt generically digital; knock,
// and glass a little, were too sudden and sharp. Marimba and electric piano stay on the page
// to compare with round two, which spreads wider rather than narrowing.
const styles = [
  {
    id: 'marimba',
    family: 'Struck',
    round: 1,
    name: 'Marimba',
    blurb: 'A wooden bar struck with a soft mallet. Warm, round, and short.',
    root: 659.26, // E5
    reverb: { size: 0.1, damp: 0.5, wet: 0.12 },
    play(out, at, hz, v, muted) {
      // A tuned bar's overtones sit at 4 and about 10 times its pitch, and its tube under the
      // bar sounds the pitch again, a moment late and a little longer.
      const decay = (muted ? 0.07 : 0.34) * Math.sqrt(659 / hz);
      strike(out, at, hz, v * 0.5, [
        { ratio: 1, amp: 1, decay },
        { ratio: 1, amp: 0.4, decay: decay * 1.4, attack: 0.012, detune: 0.7 },
        { ratio: 3.98, amp: muted ? 0.07 : 0.2, decay: decay * 0.25 },
        { ratio: 9.85, amp: muted ? 0.01 : 0.045, decay: decay * 0.08 },
      ]);
      burst(out, at, v * (muted ? 0.15 : 0.22), { hz: muted ? 900 : 2200, q: 0.8, decay: 0.0018, seed: Math.round(hz) });
    },
  },
  {
    id: 'glass',
    dropped: true,
    name: 'Glass',
    root: 987.77, // B5
    reverb: { size: 0.3, damp: 0.25, wet: 0.2 },
    play(out, at, hz, v, muted) {
      // A free bar's overtones, at 2.76, 5.40, and 8.93 times its pitch, and a second voice
      // 2.6Hz off the first, so the two beat as the bell rings.
      const decay = muted ? 0.07 : 0.45;
      strike(out, at, hz, v * 0.45, [
        { ratio: 1, amp: 1, decay },
        { ratio: 1, amp: 0.45, decay: decay * 0.9, detune: 2.6 },
        { ratio: 0.5, amp: 0.1, decay: decay * 0.7, attack: 0.004 },
        { ratio: 2.756, amp: muted ? 0.05 : 0.16, decay: decay * 0.35 },
        { ratio: 5.404, amp: muted ? 0.01 : 0.05, decay: decay * 0.15 },
        { ratio: 8.933, amp: muted ? 0 : 0.015, decay: decay * 0.08 },
      ]);
      burst(out, at, v * (muted ? 0.05 : 0.1), { hz: muted ? 2500 : 6500, q: 1.2, decay: 0.0012, seed: Math.round(hz) });
    },
  },
  {
    id: 'electric-piano',
    family: 'Struck',
    round: 1,
    name: 'Electric piano',
    blurb: 'A mellow electric piano playing a little chord. Rounded and musical.',
    root: 659.26, // E5
    reverb: { size: 0.15, damp: 0.5, wet: 0.14 },
    // Each note but a refusal's has a softer one under it, so the cue sounds as a chord.
    cues: {
      passed: { notes: [{ t: 0, n: 0, v: 0.8, with: -5 }, { t: 0.115, n: 7, v: 1, with: 4 }] },
      offer: { notes: [{ t: 0, n: 0, v: 0.9, with: -5 }, { t: 0.1, n: 0, v: 0.55 }] },
      timeout: { notes: [{ t: 0, n: 0, v: 0.8, with: -5 }, { t: 0.14, n: -5, v: 0.65, with: -8 }] },
    },
    play(out, at, hz, v, muted) {
      // A body that mellows over 0.2s, and a tine whose bark lasts 15ms.
      fm(out, at, hz, v * 0.4, { ratio: 1, index: muted ? 0.7 : 1.6, bright: 0.2, decay: muted ? 0.12 : 0.5 });
      fm(out, at, hz, v * (muted ? 0.04 : 0.1), { ratio: 7, index: muted ? 0.3 : 1.1, bright: 0.015, decay: 0.12 });
      strike(out, at, hz, v * 0.12, [{ ratio: 1, amp: 1, decay: muted ? 0.15 : 0.6, attack: 0.01 }]);
    },
  },
  {
    id: 'knock',
    dropped: true,
    name: 'Knock',
    root: 987.77, // B5
    reverb: { size: 0.2, damp: 0.3, wet: 0.24 },
    cues: { passed: { seconds: 0.45 }, refused: { seconds: 0.4 }, offer: { seconds: 0.45 }, timeout: { seconds: 0.5 } },
    play(out, at, hz, v, muted) {
      const decay = muted ? 0.03 : 0.045;
      strike(out, at, hz, v * 0.5, [
        { ratio: 1, amp: 1, decay, attack: 0.0008 },
        { ratio: 2.57, amp: muted ? 0.12 : 0.32, decay: decay * 0.55, attack: 0.0006 },
        { ratio: 4.3, amp: muted ? 0.03 : 0.12, decay: decay * 0.35, attack: 0.0005 },
      ]);
      burst(out, at, v * (muted ? 0.35 : 0.5), { hz: muted ? 1100 : 2800, q: 0.7, decay: 0.0016, seed: Math.round(hz) });
    },
  },
  {
    id: 'panel',
    dropped: true,
    name: 'Panel tone',
    root: 880, // A5
    reverb: { size: 0, damp: 0.6, wet: 0.04, scale: 0.5 },
    // Beeps hold, so each note says how long.
    cues: {
      passed: { seconds: 0.42, notes: [{ t: 0, n: 0, v: 0.85, hold: 0.075 }, { t: 0.11, n: 7, v: 1, hold: 0.13 }] },
      refused: { seconds: 0.45, notes: [{ t: 0, n: -5, v: 1, hold: 0.09 }, { t: 0.14, n: -11, v: 1, hold: 0.15 }] },
      offer: { seconds: 0.4, notes: [{ t: 0, n: 0, v: 0.9, hold: 0.06 }, { t: 0.1, n: 0, v: 0.9, hold: 0.06 }] },
      timeout: { seconds: 0.48, notes: [{ t: 0, n: 0, v: 0.8, hold: 0.08 }, { t: 0.15, n: -5, v: 0.7, hold: 0.14 }] },
    },
    play(out, at, hz, v, muted, note) {
      // A refusal buzzes, with the odd overtones a square wave has.
      tone(out, at, hz, v * 0.5, {
        hold: note.hold,
        release: muted ? 0.025 : 0.035,
        partials: muted ? [[1, 1], [3, 0.3], [5, 0.15], [7, 0.08]] : [[1, 1], [2, 0.08], [3, 0.04]],
      });
    },
  },
  {
    id: 'soft-synth',
    dropped: true,
    name: 'Soft synth',
    root: 659.26, // E5
    reverb: { size: 0.3, damp: 0.4, wet: 0.2 },
    render(cue) {
      const root = this.root;
      const out = new Float64Array(Math.round({ passed: 0.6, refused: 0.45, offer: 0.55, timeout: 0.6 }[cue] * RATE));
      const opens = (t, from, to, rise, fall) => from + (to - from) * Math.min(t / rise, 1) * Math.exp(-t / fall);
      if (cue === 'passed') {
        synth(out, 0, 0.3, {
          path: [[0, root], [0.1, semitones(root, 7)]],
          glide: 0.045, attack: 0.012, decay: 0.32,
          cutoff: (t) => opens(t, 600, 3600, 0.04, 0.3) + (t > 0.1 ? opens(t - 0.1, 0, 1500, 0.03, 0.2) : 0),
        });
      } else if (cue === 'refused') {
        synth(out, 0, 0.3, {
          path: [[0, semitones(root, -5)], [0.11, semitones(root, -11)]],
          glide: 0.05, attack: 0.008, decay: 0.17, q: 0.9,
          cutoff: (t) => 350 + 2200 * Math.exp(-t / 0.12),
        });
      } else if (cue === 'offer') {
        synth(out, 0, 0.3, { path: [[0, root]], glide: 0.05, attack: 0.05, decay: 0.25, cutoff: (t) => opens(t, 500, 3000, 0.08, 0.25) });
      } else {
        synth(out, 0, 0.3, {
          path: [[0, root], [0.12, semitones(root, -5)]],
          glide: 0.12, attack: 0.02, decay: 0.3,
          cutoff: (t) => 400 + 2500 * Math.exp(-t / 0.2),
        });
      }
      return out;
    },
  },

  // Round two, 2026-11-15.
  vibraphone,
  {
    ...vibraphone,
    id: 'vibraphone-motor',
    name: 'Vibraphone with motor',
    blurb: 'The same vibraphone with its motor on, so each note pulses softly. The classic jazz vibes sound.',
    motor: true,
  },
  {
    id: 'felt-piano',
    family: 'Struck',
    name: 'Felt piano',
    blurb: 'A piano with felt between its hammers and strings. Soft, close, and muted.',
    root: 392, // G4
    reverb: { size: 0.3, damp: 0.5, wet: 0.2 },
    cues: {
      passed: { notes: [{ t: 0, n: 0, v: 0.75 }, { t: 0.12, n: 7, v: 0.9, with: 4 }] },
      refused: { notes: [{ t: 0, n: -1, v: 1 }, { t: 0.12, n: -7, v: 0.9 }] },
    },
    play(out, at, hz, v, muted) {
      // A stiff string's overtones run a little sharp, and felt takes the high ones down. The
      // lowest four sound on a second string 0.45Hz off, as a piano's unison does.
      const partials = [];
      for (let n = 1; n <= 10; n++) {
        const ratio = n * Math.sqrt(1 + 0.00035 * n * n);
        const amp = n ** -1.7 * Math.exp(-n / 5);
        const decay = (muted ? 0.1 : 1.2) / (1 + 0.35 * (n - 1));
        partials.push({ ratio, amp, decay, attack: 0.005 + 0.0008 * n });
        if (n <= 4) partials.push({ ratio, amp: amp * 0.7, decay, attack: 0.005, detune: 0.45 });
      }
      strike(out, at, hz, v * 0.35, partials);
      burst(out, at, v * 0.05, { hz: 260, q: 0.6, decay: 0.004, seed: Math.round(hz) });
    },
  },
  {
    id: 'handpan',
    family: 'Struck',
    name: 'Handpan',
    blurb: 'A steel handpan played with the hand. Round and warm, with a hum under each note.',
    root: 440, // A4
    reverb: { size: 0.3, damp: 0.35, wet: 0.2 },
    play(out, at, hz, v, muted) {
      // Each note field is tuned to its pitch, the octave, and the twelfth above.
      const decay = muted ? 0.1 : 0.9;
      strike(out, at, hz, v * 0.4, [
        { ratio: 1, amp: 1, decay, attack: 0.007 },
        { ratio: 1, amp: 0.25, decay, attack: 0.009, detune: 1.1 },
        { ratio: 2, amp: muted ? 0.12 : 0.3, decay: decay * 0.6, attack: 0.006 },
        { ratio: 3, amp: muted ? 0.04 : 0.12, decay: decay * 0.4, attack: 0.005 },
      ]);
      burst(out, at, v * 0.04, { hz: 300, q: 0.7, decay: 0.006, seed: Math.round(hz) });
    },
  },
  {
    id: 'kalimba',
    family: 'Plucked',
    name: 'Kalimba',
    blurb: 'A thumb piano’s metal tines on a wooden box. Light and sweet; passing control rolls three notes.',
    root: 587.33, // D5
    reverb: { size: 0.15, damp: 0.45, wet: 0.12 },
    cues: { passed: rolled(0.07) },
    play(out, at, hz, v, muted) {
      // A tine's second mode sits near 6 times its pitch, and the box under it thuds softly.
      const decay = (muted ? 0.08 : 0.7) * Math.sqrt(587 / hz);
      strike(out, at, hz, v * 0.45, [
        { ratio: 1, amp: 1, decay, attack: 0.0025 },
        { ratio: 1, amp: 0.2, decay: decay * 1.1, attack: 0.003, detune: 1.3 },
        { ratio: 2, amp: 0.05, decay: decay * 0.3 },
        { ratio: 5.93, amp: muted ? 0.03 : 0.1, decay: decay * 0.12 },
      ]);
      burst(out, at, v * 0.06, { hz: 400, q: 0.8, decay: 0.004, seed: Math.round(hz) });
    },
  },
  {
    id: 'harp',
    family: 'Plucked',
    name: 'Harp',
    blurb: 'Plucked nylon strings, rolled as a little chord when control passes.',
    root: 523.25, // C5
    reverb: { size: 0.3, damp: 0.4, wet: 0.18 },
    cues: { passed: rolled(0.065) },
    play(out, at, hz, v, muted) {
      pluck(out, at, hz, v * 0.9, { decay: muted ? 0.06 : 0.8, soft: muted ? 0.85 : 0.6, seed: Math.round(hz * 7) });
    },
  },
  {
    id: 'flute',
    family: 'Blown',
    name: 'Wooden flute',
    blurb: 'Soft blown notes with a little breath and a slow vibrato. No strike at all: each note swells in.',
    root: 659.26, // E5
    reverb: { size: 0.3, damp: 0.4, wet: 0.2 },
    render(cue) {
      const root = this.root;
      const out = new Float64Array(Math.round(cues[cue].seconds * RATE));
      if (cue === 'passed') {
        blow(out, 0, 0.5, { path: [[0, root], [0.12, semitones(root, 7)]], hold: 0.32, seed: 1 });
      } else if (cue === 'refused') {
        // Two short tongued notes, breathier than the rest.
        blow(out, 0, 0.5, { path: [[0, semitones(root, -5)]], hold: 0.07, attack: 0.015, breath: 0.25, seed: 2 });
        blow(out, 0.13, 0.45, { path: [[0, semitones(root, -11)]], hold: 0.1, attack: 0.015, breath: 0.25, seed: 3 });
      } else if (cue === 'offer') {
        blow(out, 0, 0.5, { path: [[0, root]], hold: 0.26, attack: 0.06, seed: 4 });
      } else {
        blow(out, 0, 0.5, { path: [[0, root], [0.15, semitones(root, -5)]], glide: 0.05, hold: 0.32, seed: 5 });
      }
      return out;
    },
  },
  {
    id: 'horn',
    family: 'Blown',
    name: 'Horn',
    blurb: 'A soft French horn. Warm and broad, slurring up a fifth when control passes.',
    root: 349.23, // F4
    reverb: { size: 0.4, damp: 0.45, wet: 0.22 },
    render(cue) {
      const root = this.root;
      const out = new Float64Array(Math.round(cues[cue].seconds * RATE));
      if (cue === 'passed') {
        brass(out, 0, 0.5, { path: [[0, root], [0.13, semitones(root, 7)]], hold: 0.34 });
      } else if (cue === 'refused') {
        // Two short notes, darker than the rest.
        const short = { hold: 0.07, attack: 0.025, bright: 1.4, cutoff: 1400 };
        brass(out, 0, 0.5, { path: [[0, semitones(root, -2)]], ...short });
        brass(out, 0.13, 0.5, { path: [[0, semitones(root, -8)]], ...short, hold: 0.1 });
      } else if (cue === 'offer') {
        brass(out, 0, 0.5, { path: [[0, root]], hold: 0.25, attack: 0.08 });
      } else {
        brass(out, 0, 0.5, { path: [[0, root], [0.15, semitones(root, -5)]], glide: 0.06, hold: 0.32, bright: 1.6 });
      }
      return out;
    },
  },
  {
    id: 'drop',
    family: 'Other',
    name: 'Drop',
    blurb: 'Water drops: a short bloop that rises for each note, or sinks for a refusal. Playful.',
    root: 659.26, // E5
    reverb: { size: 0.2, damp: 0.3, wet: 0.15 },
    play(out, at, hz, v, muted) {
      bubble(out, at, hz, v * 0.5, { rise: muted ? -0.25 : 0.5, decay: muted ? 0.05 : 0.09 });
    },
  },

  // Round two's recordings. Vibraphone.sustain.pp.C5B5.aif was downloaded too and left out:
  // its notes sit 45dB to 50dB below full scale and each still rings under the next.
  {
    id: 'marimba-recorded',
    family: 'Recorded',
    name: 'Marimba, recorded',
    blurb: 'A real marimba played with soft yarn mallets, recorded by the University of Iowa. The real thing beside round one’s made-up marimba.',
    root: 659.26, // E5
    reverb: { size: 0.15, damp: 0.5, wet: 0.14 },
    recorded() {
      const samples = recording('Marimba.yarn.pp.C5B5.aif');
      return instrument(cut(samples, strikes(samples)));
    },
    play(out, at, hz, v, muted) {
      // Rounding the mallet's first 4ms takes the edge off its strike.
      sample(out, at, hz, v, muted, { attack: 0.004 }, this.note);
    },
  },
  {
    id: 'piano-recorded',
    family: 'Recorded',
    name: 'Piano, recorded',
    blurb: 'A real Steinway played softly, recorded by the University of Iowa. Passing control lands on a little chord.',
    root: 659.26, // E5
    reverb: { size: 0.2, damp: 0.5, wet: 0.1 },
    cues: { passed: { notes: [{ t: 0, n: 0, v: 0.8 }, { t: 0.115, n: 7, v: 1, with: 4 }] } },
    recorded() {
      const notes = new Map();
      for (const [k, name] of [[0, 'C5'], [4, 'E5'], [8, 'Ab5'], [11, 'B5']]) {
        const samples = recording(`Piano.pp.${name}.aiff`);
        const start = Math.max(strikes(samples)[0] - Math.round(0.003 * RATE), 0);
        notes.set(k, samples.slice(start, start + RATE));
      }
      return instrument(notes);
    },
    play(out, at, hz, v, muted) {
      sample(out, at, hz, v, muted, { mutedDecay: 0.08 }, this.note);
    },
  },
  {
    id: 'bowed-vibraphone',
    family: 'Recorded',
    name: 'Bowed vibraphone, recorded',
    blurb: 'A real vibraphone bar played with a bow, recorded by the University of Iowa. It sings with no strike at all: each note fades in fast and dies away.',
    root: 659.26, // E5
    reverb: { size: 0.3, damp: 0.4, wet: 0.16 },
    recorded() {
      const samples = recording('Vibraphone.bow.C5B5.aif');
      return instrument(cut(samples, swells(samples).map((s) => s - Math.round(0.05 * RATE))));
    },
    play(out, at, hz, v, muted) {
      sample(out, at, hz, v, muted, { attack: muted ? 0.015 : 0.035, decay: 0.3, mutedDecay: 0.07 }, this.note);
    },
  },

  // Round three, 2026-11-15. Of every style in rounds one and two, the user found stage 20's
  // stand-ins the best fit, so round three tries them as they are and with one thing changed
  // in each.
  { ...asIs(3) },
  {
    id: 'softer',
    round: 3,
    family: 'One change each',
    name: 'Softer start',
    blurb: 'Each note swells in over 12ms instead of 4ms, so it starts rounder.',
    render: standIn({ rise: 0.012 }),
  },
  {
    id: 'room',
    round: 3,
    family: 'One change each',
    name: 'A touch of room',
    blurb: 'A small room around each note, so it sounds a little less dry and close.',
    reverb: { size: 0.15, damp: 0.5, wet: 0.12 },
    tail: 0.1,
    render: standIn({ tail: 0.1 }),
  },
  {
    id: 'longer',
    round: 3,
    family: 'One change each',
    name: 'Longer ring',
    blurb: 'Each note rings 1.6 times as long before it fades.',
    tail: 0.1,
    render: standIn({ ring: 1.6, tail: 0.1 }),
  },
  {
    id: 'shimmer',
    round: 3,
    family: 'One change each',
    name: 'Gentle shimmer',
    blurb: 'A second voice 4Hz above each note, so it wavers slightly as it fades.',
    render: standIn({ shimmer: 4 }),
  },
  {
    id: 'lower',
    round: 3,
    family: 'One change each',
    name: 'A fourth lower',
    blurb: 'Every note a fourth lower: warmer, a little less bright.',
    render: standIn({ shift: -5 }),
  },
  {
    id: 'fourth',
    round: 3,
    family: 'One change each',
    name: 'Rising a fourth',
    blurb: 'Control passing rises a fourth, G to C, instead of a fifth, so it sounds more settled. The rest is unchanged.',
    render: standIn({ second: 1046.5 }),
  },

  // Round four, 2026-11-15. None of round three beat the stand-ins as they are, and the user
  // heard them as close to a single tone, not rich, so round four keeps their tune and shape
  // and fills out each note.
  { ...asIs(4) },
  {
    id: 'fuller',
    round: 4,
    family: 'Richer',
    name: 'Fuller tone',
    blurb: 'Six overtones in each note where the stand-ins have two, so each sounds less like a pure tone.',
    render: standIn({ fuller: true }),
  },
  {
    id: 'octave',
    round: 4,
    family: 'Richer',
    name: 'Octave below',
    blurb: 'Each note sounds an octave below too, at half level, for body.',
    render: standIn({ octave: true }),
  },
  {
    id: 'chord',
    round: 4,
    family: 'Richer',
    name: 'Chords',
    blurb: 'Each note is the top of a soft G major chord; a refusal’s notes each have a minor third under them.',
    render: standIn({ chord: true }),
  },
  {
    id: 'fuller-octave',
    round: 4,
    family: 'Richer',
    name: 'Fuller tone, octave below',
    blurb: 'The first two together.',
    render: standIn({ fuller: true, octave: true }),
  },
  {
    id: 'fullest',
    round: 4,
    family: 'Richer',
    name: 'All of it',
    blurb: 'Fuller tone, octave below, and chords, in a touch of room.',
    reverb: { size: 0.15, damp: 0.5, wet: 0.12 },
    tail: 0.1,
    render: standIn({ fuller: true, octave: true, chord: true, tail: 0.1 }),
  },
];

// The round the page shows. The user picked none of round four over the stand-ins either, and
// stage 20b kept the stand-ins for v1 (record/areas/control/log.md, 2026-11-15).
const ROUND = 4;

// The envelope a cue button draws: the peak of each 12.5ms slice of the first 0.7s, as a
// share of the loudest slice of any cue, so the shapes compare at one scale.
const SLICES = 56;
function envelope(samples) {
  const width = (0.7 * RATE) / SLICES;
  return Array.from({ length: SLICES }, (_, i) => peak(samples.subarray(Math.round(i * width), Math.round((i + 1) * width))));
}

const reference = {
  passed: asShipped(join(standIns, 'control-passed.opus'), 'stand-in-passed'),
  refused: asShipped(join(standIns, 'refused.opus'), 'stand-in-refused'),
};
const target = loudness(samplesOf(reference.passed));
const refusedTarget = loudness(samplesOf(reference.refused));
console.log(`target: ${target.toFixed(1)} LUFS, the stand-in for control passing`);

const page = { target: Math.round(target * 10) / 10, styles: [] };
const rows = [];
function add(entry, cue, file) {
  const samples = samplesOf(file);
  const stats = {
    seconds: Math.round((samples.length / RATE) * 100) / 100,
    peak: Math.round(20 * Math.log10(peak(samples)) * 10) / 10,
    lufs: Math.round(loudness(samples) * 10) / 10,
  };
  rows.push({ style: entry.id, cue, ...stats });
  entry.cues[cue] = { ...stats, shape: envelope(samples), audio: file.toString('base64') };
}

for (const style of styles) {
  if (style.recorded) {
    if (!iowa) {
      console.log(`${style.id} is left out, with no Iowa folder`);
      continue;
    }
    style.note = style.recorded();
  }
  const entry = { id: style.id, family: style.family, round: style.round ?? 2, name: style.name, blurb: style.blurb, cues: {} };
  for (const cue of Object.keys(cues)) {
    if (style.shipped && reference[cue]) {
      add(entry, cue, reference[cue]);
      continue;
    }
    // Rounds three and four keep the stand-ins' own levels, where its refusal sits 1.4dB under
    // control passing.
    const fromStandIns = style.round >= 3;
    const shape = fromStandIns ? { lowCut: false, damp: Boolean(style.tail) } : {};
    const raw = finish(style.render ? style.render(cue) : played(style, cue), style.reverb, shape);
    const goal = fromStandIns && cue === 'refused' ? refusedTarget : target - (cues[cue].softer ?? 0);
    const gain = 10 ** ((goal - loudness(raw)) / 20);
    const scaled = raw.map((s) => s * gain);
    if (peak(scaled) > 0.85) console.warn(`${style.id} ${cue} peaks at ${peak(scaled).toFixed(2)}`);
    add(entry, cue, encode(scaled, `${style.id}-${cue}`));
  }
  if (!style.dropped && entry.round === ROUND) page.styles.push(entry);
}

const FAMILIES = ['Today', 'Richer', 'One change each', 'Recorded', 'Struck', 'Plucked', 'Blown', 'Other'];
page.styles.sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family));

const loudest = Math.max(...page.styles.flatMap((entry) => Object.values(entry.cues).flatMap((cue) => cue.shape)));
for (const entry of page.styles) {
  for (const cue of Object.values(entry.cues)) cue.shape = cue.shape.map((p) => Math.round((p / loudest) * 100));
}

console.table(rows.filter((row) => page.styles.some((entry) => entry.id === row.style)));
const template = readFileSync(join(here, 'page.html'), 'utf8');
writeFileSync(pagePath, template.replace('/* CUES */', `const DATA = ${JSON.stringify(page)};`));
console.log(`wrote ${pagePath}, ${Math.round(readFileSync(pagePath).length / 1024)} KB`);
rmSync(work, { recursive: true, force: true });
