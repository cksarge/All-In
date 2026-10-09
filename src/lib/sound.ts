import { useSettings } from '@/stores/settingsStore';

/**
 * Tiny Web Audio synth: no audio files to load, and everything respects the
 * mute toggle. Later phases add richer per-game sounds on top of this.
 */
export type SoundName = 'click' | 'chip' | 'coins' | 'success' | 'error' | 'whoosh' | 'card' | 'flip' | 'win' | 'lose' | 'turn' | 'pop';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  c: AudioContext,
  { freq, start = 0, dur = 0.12, type = 'sine', gain = 0.12, slide }: {
    freq: number; start?: number; dur?: number; type?: OscillatorType; gain?: number; slide?: number;
  },
) {
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(c: AudioContext, { start = 0, dur = 0.05, gain = 0.08, freq = 3000 }) {
  const t = c.currentTime + start;
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t);
}

export function playSound(name: SoundName) {
  if (!useSettings.getState().soundOn) return;
  const c = audio();
  if (!c) return;
  switch (name) {
    case 'click':
      tone(c, { freq: 880, dur: 0.05, type: 'triangle', gain: 0.05 });
      break;
    case 'chip':
      noise(c, { dur: 0.04, freq: 4200, gain: 0.12 });
      tone(c, { freq: 2400, dur: 0.06, type: 'triangle', gain: 0.04, start: 0.005 });
      break;
    case 'coins':
      for (let i = 0; i < 6; i++) {
        noise(c, { start: i * 0.06, dur: 0.035, freq: 3800 + i * 300, gain: 0.1 });
        tone(c, { freq: 1800 + i * 160, start: i * 0.06, dur: 0.08, type: 'triangle', gain: 0.035 });
      }
      break;
    case 'success':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone(c, { freq: f, start: i * 0.08, dur: 0.22, type: 'triangle', gain: 0.07 }),
      );
      break;
    case 'error':
      tone(c, { freq: 220, dur: 0.18, type: 'sawtooth', gain: 0.04, slide: 160 });
      break;
    case 'whoosh':
      noise(c, { dur: 0.25, freq: 900, gain: 0.05 });
      break;
    case 'card':
      noise(c, { dur: 0.07, freq: 2600, gain: 0.09 });
      noise(c, { start: 0.03, dur: 0.05, freq: 1400, gain: 0.05 });
      break;
    case 'flip':
      noise(c, { dur: 0.05, freq: 3200, gain: 0.07 });
      tone(c, { freq: 600, start: 0.02, dur: 0.05, type: 'triangle', gain: 0.03 });
      break;
    case 'win':
      [659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
        tone(c, { freq: f, start: i * 0.07, dur: 0.25, type: 'triangle', gain: 0.07 }),
      );
      for (let i = 0; i < 4; i++) noise(c, { start: 0.25 + i * 0.05, dur: 0.035, freq: 4200, gain: 0.08 });
      break;
    case 'lose':
      tone(c, { freq: 392, dur: 0.22, type: 'triangle', gain: 0.06, slide: 330 });
      tone(c, { freq: 311, start: 0.18, dur: 0.3, type: 'triangle', gain: 0.05, slide: 262 });
      break;
    case 'turn':
      tone(c, { freq: 880, dur: 0.12, type: 'sine', gain: 0.07 });
      tone(c, { freq: 1320, start: 0.1, dur: 0.16, type: 'sine', gain: 0.06 });
      break;
    case 'pop':
      tone(c, { freq: 520, dur: 0.08, type: 'sine', gain: 0.08, slide: 900 });
      break;
  }
}
