// Sound, synthesized: every effect is WebAudio oscillators and filtered noise, so the
// game ships no audio files and makes no network request. The context is created on
// the first user gesture (the play button) and stays suspended until then.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function noise(when, dur, filterFreq, gainVal, type = 'lowpass') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  function tone(when, freq, dur, gainVal, type = 'sine', slideTo = null) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, when + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(gain).connect(master);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  function shot(kind) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    if (kind === 'longbow') {
      noise(t, 0.28, 900, 0.9);
      tone(t, 160, 0.22, 0.5, 'sawtooth', 45);
    } else if (kind === 'hornet') {
      noise(t, 0.1, 1600, 0.55);
      tone(t, 220, 0.07, 0.25, 'square', 90);
    } else if (kind === 'p9') {
      noise(t, 0.09, 2000, 0.5);
      tone(t, 260, 0.06, 0.2, 'square', 110);
    } else {
      noise(t, 0.14, 1200, 0.75);
      tone(t, 190, 0.1, 0.35, 'sawtooth', 60);
    }
  }

  function distantShot() {
    if (!ensure()) return;
    const t = ctx.currentTime;
    noise(t, 0.12, 500, 0.16);
  }

  function dryClick() {
    if (!ensure()) return;
    tone(ctx.currentTime, 1400, 0.03, 0.15, 'square');
  }

  function reload() {
    if (!ensure()) return;
    const t = ctx.currentTime;
    tone(t, 900, 0.04, 0.2, 'square');
    tone(t + 0.25, 700, 0.04, 0.2, 'square');
    tone(t + 0.55, 1100, 0.05, 0.25, 'square');
  }

  function hit(kill) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    tone(t, 1800, 0.05, 0.25, 'sine');
    if (kill) tone(t + 0.07, 2400, 0.08, 0.3, 'sine');
  }

  function hurt() {
    if (!ensure()) return;
    const t = ctx.currentTime;
    tone(t, 140, 0.15, 0.4, 'sawtooth', 70);
    noise(t, 0.08, 400, 0.25);
  }

  function beep(freq = 1200) {
    if (!ensure()) return;
    tone(ctx.currentTime, freq, 0.09, 0.3, 'sine');
  }

  function explosion() {
    if (!ensure()) return;
    const t = ctx.currentTime;
    noise(t, 0.9, 300, 1.0);
    tone(t, 120, 0.8, 0.8, 'sine', 28);
    noise(t + 0.05, 0.4, 1200, 0.5, 'bandpass');
  }

  function grenadePin() {
    if (!ensure()) return;
    tone(ctx.currentTime, 2000, 0.03, 0.2, 'square');
  }

  function buy() {
    if (!ensure()) return;
    const t = ctx.currentTime;
    tone(t, 880, 0.06, 0.25, 'sine');
    tone(t + 0.07, 1320, 0.08, 0.25, 'sine');
  }

  function roundEnd(win) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const notes = win ? [523, 659, 784, 1047] : [392, 330, 262, 196];
    notes.forEach((freq, i) => tone(t + i * 0.13, freq, 0.22, 0.3, 'triangle'));
  }

  function matchEnd(win) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const notes = win ? [523, 659, 784, 1047, 1319] : [330, 294, 262, 196];
    notes.forEach((freq, i) => tone(t + i * 0.16, freq, 0.3, 0.3, 'triangle'));
  }

  return {
    ensure, shot, distantShot, dryClick, reload, hit, hurt, beep,
    explosion, grenadePin, buy, roundEnd, matchEnd,
  };
}
