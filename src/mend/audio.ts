/**
 * All of Mend's sound is synthesized with WebAudio at runtime: no files.
 * Ceramic clinks are short bursts of band-passed noise over a few inharmonic
 * partials; seams "sing" a pentatonic note that rises as the vessel fills.
 */
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export class MendAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private wet: GainNode | null = null;
  private drone: { stop: () => void } | null = null;
  muted = false;
  /** Seconds added to currentTime; used when replaying a session offline. */
  offset = 0;
  private offline = false;

  private log(name: string, args: unknown[]) {
    if (this.offline) return;
    const w = window as any;
    const list = (w.__MEND_AUDIO_LOG ||= []);
    if (list.length < 400) list.push({ t: performance.now() / 1000, name, args });
  }

  private now(): number {
    return this.ctx!.currentTime + this.offset;
  }

  /** Re-render a logged session to a buffer (used to put real app audio on the demo video). */
  static async renderLog(events: { t: number; name: string; args: unknown[] }[], seconds: number, t0: number) {
    const a = new MendAudio();
    a.offline = true;
    const ctx = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
    a.ctx = ctx as unknown as AudioContext;
    a.master = ctx.createGain();
    a.master.gain.value = 0.8;
    a.master.connect(ctx.destination);
    a.reverb = ctx.createConvolver();
    a.reverb.buffer = a.impulse(2.4);
    a.wet = ctx.createGain();
    a.wet.gain.value = 0.35;
    a.reverb.connect(a.wet);
    a.wet.connect(a.master);
    for (const e of events) {
      a.offset = Math.max(0, e.t - t0);
      if (a.offset > seconds) continue;
      (a as any)[e.name](...e.args);
    }
    return ctx.startRendering();
  }

  /** Must be called from a user gesture or once an XR session is running. */
  ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.8;
        this.master.connect(this.ctx.destination);
        this.reverb = this.ctx.createConvolver();
        this.reverb.buffer = this.impulse(2.4);
        this.wet = this.ctx.createGain();
        this.wet.gain.value = 0.35;
        this.reverb.connect(this.wet);
        this.wet.connect(this.master);
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && !this.offline && this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  private out(node: AudioNode) {
    node.connect(this.master!);
    node.connect(this.reverb!);
  }

  /** A small ceramic tick: picking up or setting down a shard. */
  clink(pitch = 1, level = 0.35) {
    this.log('clink', [pitch, level]);
    const ctx = this.ensure();
    if (!ctx) return;
    const t = this.now();
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    this.out(g);
    for (const f of [2100, 3370, 5230]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * pitch * (0.98 + Math.random() * 0.04);
      const og = ctx.createGain();
      og.gain.value = 0.25;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + 0.4);
    }
    const noise = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    noise.buffer = nb;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4000 * pitch;
    bp.Q.value = 2;
    noise.connect(bp);
    bp.connect(g);
    noise.start(t);
  }

  /** A shard locks in: a bell tone that climbs the scale as the vessel fills. */
  seat(step: number) {
    this.log('seat', [step]);
    const ctx = this.ensure();
    if (!ctx) return;
    const t = this.now();
    const base = 392; // G4
    const semis = PENTA[Math.min(step, PENTA.length - 1)];
    const f = base * Math.pow(2, semis / 12);
    this.bell(f, t, 0.32, 2.2);
    this.bell(f * 2, t + 0.02, 0.08, 1.4);
    this.clink(1.2, 0.25);
  }

  /** Gold flowing into a crack: a soft shimmer. */
  shimmer(delay = 0) {
    this.log('shimmer', [delay]);
    const ctx = this.ensure();
    if (!ctx) return;
    const t = this.now() + delay;
    for (let k = 0; k < 5; k += 1) {
      this.bell(1568 * Math.pow(2, PENTA[k + 3] / 12) / 2, t + k * 0.06, 0.035, 0.9);
    }
  }

  /** The vessel is whole again. */
  complete() {
    this.log('complete', []);
    const ctx = this.ensure();
    if (!ctx) return;
    const t = this.now();
    const chord = [196, 293.66, 392, 493.88, 587.33, 783.99];
    chord.forEach((f, k) => this.bell(f, t + k * 0.11, 0.16, 4.5));
  }

  private bell(freq: number, t: number, level: number, decay: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    this.out(g);
    for (const [mult, amp] of [
      [1, 1],
      [2.76, 0.35],
      [5.4, 0.12],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
  }

  /** A quiet room tone under the session. */
  startDrone() {
    this.log('startDrone', []);
    const ctx = this.ensure();
    if (!ctx || this.drone) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, this.now());
    g.gain.linearRampToValueAtTime(0.035, this.now() + 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    lp.connect(g);
    this.out(g);
    const oscs = [98, 146.83, 196.5].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(lp);
      o.start(this.now());
      return o;
    });
    this.drone = {
      stop: () => {
        g.gain.linearRampToValueAtTime(0, this.now() + 1);
        oscs.forEach((o) => o.stop(this.now() + 1.1));
      },
    };
  }

  stopDrone() {
    this.drone?.stop();
    this.drone = null;
  }
}
