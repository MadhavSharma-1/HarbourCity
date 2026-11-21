/** Synthesised sound: engine, horn, crashes, indicators, splashes, ambience. No audio files needed. */
export class Audio {
  constructor() { this.ctx = null; this.ready = false; }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.6;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    this.master.connect(this.lp).connect(c.destination);
    // noise buffer
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    this.brown = nb;
    const wb = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const wd = wb.getChannelData(0); for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    this.white = wb;
    // engine: two detuned saws + square sub through a lowpass
    this.eng = c.createGain(); this.eng.gain.value = 0;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 600; this.engF.Q.value = 3;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'sawtooth'; this.o2.detune.value = 18;
    this.o3 = c.createOscillator(); this.o3.type = 'square';
    const g3 = c.createGain(); g3.gain.value = 0.5;
    this.o1.connect(this.engF); this.o2.connect(this.engF); this.o3.connect(g3).connect(this.engF);
    this.engF.connect(this.eng).connect(this.master);
    [this.o1, this.o2, this.o3].forEach((o) => { o.frequency.value = 40; o.start(); });
    // ambience (city hum / surf) and tyre squeal
    this.amb = c.createBufferSource(); this.amb.buffer = this.brown; this.amb.loop = true;
    this.ambF = c.createBiquadFilter(); this.ambF.type = 'lowpass'; this.ambF.frequency.value = 500;
    this.ambG = c.createGain(); this.ambG.gain.value = 0.12;
    this.amb.connect(this.ambF).connect(this.ambG).connect(this.master); this.amb.start();
    this.sq = c.createBufferSource(); this.sq.buffer = this.white; this.sq.loop = true;
    this.sqF = c.createBiquadFilter(); this.sqF.type = 'bandpass'; this.sqF.frequency.value = 1800; this.sqF.Q.value = 8;
    this.sqG = c.createGain(); this.sqG.gain.value = 0;
    this.sq.connect(this.sqF).connect(this.sqG).connect(this.master); this.sq.start();
    // horn
    this.hornG = c.createGain(); this.hornG.gain.value = 0;
    const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 2200;
    for (const f of [392, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hf); o.start(); }
    hf.connect(this.hornG).connect(this.master);
    // siren: a square wave swept by a slow LFO; rain: filtered noise
    this.sirenG = c.createGain(); this.sirenG.gain.value = 0;
    const so = c.createOscillator(); so.type = 'square'; so.frequency.value = 700;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.45; const lg = c.createGain(); lg.gain.value = 280;
    lfo.connect(lg).connect(so.frequency);
    const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800;
    so.connect(sf).connect(this.sirenG).connect(this.master); so.start(); lfo.start();
    this.rainS = c.createBufferSource(); this.rainS.buffer = this.white; this.rainS.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 900;
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    this.rainS.connect(rf).connect(this.rainG).connect(this.master); this.rainS.start();
    this.ready = true;
  }
  setSiren(v) { if (this.ready) this.sirenG.gain.setTargetAtTime(v * 0.05, this.ctx.currentTime, 0.2); }
  setRain(v) { if (this.ready) this.rainG.gain.setTargetAtTime(v * 0.05, this.ctx.currentTime, 0.5); }
  resume() { this.init(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setEngine(on, rpm, throttle) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = 18 + (rpm / 60) * 1.0; // firing frequency-ish
    this.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.o2.frequency.setTargetAtTime(f * 1.005, t, 0.05);
    this.o3.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.engF.frequency.setTargetAtTime(300 + throttle * 1400 + rpm * 0.12, t, 0.08);
    this.eng.gain.setTargetAtTime(on ? 0.05 + throttle * 0.09 : 0, t, 0.1);
  }
  setSqueal(k) { if (this.ready) this.sqG.gain.setTargetAtTime(Math.min(k, 1) * 0.07, this.ctx.currentTime, 0.05); }
  setHorn(on, vol = 1) { if (this.ready) this.hornG.gain.setTargetAtTime(on ? 0.09 * vol : 0, this.ctx.currentTime, 0.015); }
  setUnderwater(u) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(u ? 420 : 20000, t, 0.1);
    this.ambF.frequency.setTargetAtTime(u ? 200 : 500, t, 0.2);
    this.ambG.gain.setTargetAtTime(u ? 0.35 : 0.12, t, 0.3);
  }
  burst(dur, freq, vol, type = 'lowpass') {
    if (!this.ready) return;
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.white;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); const t = c.currentTime;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + dur + 0.05);
  }
  crash(intensity) { this.burst(0.25 + intensity * 0.5, 900 + intensity * 1500, Math.min(0.8, 0.15 + intensity * 0.6)); this.tone(70, 0.3, 0.3 * intensity, 'triangle'); }
  splash() { this.burst(0.8, 1400, 0.35, 'bandpass'); }
  tick() { this.tone(1800, 0.03, 0.06, 'square'); }
  tone(freq, dur, vol, type = 'sine', slide = 0) {
    if (!this.ready) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  chime() { this.tone(880, 0.25, 0.15); setTimeout(() => this.tone(1320, 0.4, 0.15), 120); }
  ignition() { this.burst(0.6, 300, 0.25); this.tone(55, 0.7, 0.2, 'sawtooth', 1.8); }
}
