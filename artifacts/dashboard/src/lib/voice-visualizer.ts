/**
 * Canvas renderer for the voice agent: a pulsing core orb ringed by radial
 * frequency petals, drawn additively so overlapping bars bloom into light.
 *
 * Two very different data sources feed the same renderer:
 *   • listening — real FFT magnitudes from an AnalyserNode on the mic stream.
 *   • speaking  — a SYNTHESIZED envelope. `speechSynthesis` exposes no audio
 *     stream, so there is nothing real to analyse; the shape below is layered
 *     noise shaped like speech, not a measurement of the agent's voice.
 */

export type VoicePhase = "idle" | "speaking" | "listening" | "thinking";

/** Hue ramp + energy per phase, so who is talking is readable at a glance. */
const PALETTE: Record<VoicePhase, { hue: number; spread: number; drift: number; gain: number }> = {
  // Cyan → violet while the caller speaks.
  listening: { hue: 186, spread: 108, drift: 14, gain: 1 },
  // Violet → magenta → amber while the agent speaks.
  speaking: { hue: 264, spread: 132, drift: -20, gain: 0.92 },
  // Cool indigo shimmer while waiting on the model.
  thinking: { hue: 232, spread: 56, drift: 34, gain: 0.34 },
  // Barely-there breathing when nothing is happening.
  idle: { hue: 214, spread: 44, drift: 6, gain: 0.16 },
};

const BAR_COUNT = 132;
/** Frames blend toward new magnitudes at this rate — stops the ring twitching. */
const SMOOTHING = 0.28;
/** Keeps the radial ring visibly moving without making the voice response feel frantic. */
const ROTATION_SPEED = 1.8;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * Sum of detuned sines — cheap, deterministic, and free of the periodic
 * "pumping" a single sine would give. Returns roughly 0..1.
 */
function pseudoNoise(seed: number, t: number) {
  const a = Math.sin(seed * 12.9898 + t * 2.1);
  const b = Math.sin(seed * 78.233 + t * 3.7);
  const c = Math.sin(seed * 39.425 + t * 1.3);
  return (a * 0.5 + b * 0.3 + c * 0.2) * 0.5 + 0.5;
}

export interface VisualizerHandle {
  /** Swap the active phase; the renderer eases between palettes. */
  setPhase(phase: VoicePhase): void;
  /** Supply the mic analyser while listening; pass null to drop it. */
  setAnalyser(analyser: AnalyserNode | null): void;
  /** Tear down the rAF loop and resize observer. */
  destroy(): void;
}

export function createVisualizer(canvas: HTMLCanvasElement): VisualizerHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { setPhase() {}, setAnalyser() {}, destroy() {} };
  }

  let phase: VoicePhase = "idle";
  let analyser: AnalyserNode | null = null;
  let freqData: Uint8Array<ArrayBuffer> | null = null;
  let raf = 0;
  let width = 0;
  let height = 0;

  /** Per-bar smoothed magnitudes, and an eased overall level for the orb. */
  const bars = new Float32Array(BAR_COUNT);
  let level = 0;
  // Palette values are eased too, so a phase change is a colour sweep.
  let hue = PALETTE.idle.hue;
  let spread = PALETTE.idle.spread;
  let gain = PALETTE.idle.gain;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  /** Scratch buffer for per-frame targets — reused to keep the loop allocation-free. */
  const target = new Float32Array(BAR_COUNT);

  /** Fill `target` with this frame's magnitudes (0..1). */
  const sampleMagnitudes = (t: number) => {
    target.fill(0);

    if (phase === "listening" && analyser) {
      if (!freqData || freqData.length !== analyser.frequencyBinCount) {
        freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
      analyser.getByteFrequencyData(freqData);
      // Voice energy sits low in the spectrum, so read the bottom ~45% of bins
      // and mirror it around the circle for symmetry.
      const usable = Math.floor(freqData.length * 0.45);
      const half = BAR_COUNT / 2;
      for (let i = 0; i < half; i++) {
        const v = freqData[Math.floor((i / half) * usable)] / 255;
        target[i] = v;
        target[BAR_COUNT - 1 - i] = v;
      }
    } else if (phase === "speaking") {
      // Synthesized speech-like envelope (see file header).
      const syllable = 0.55 + 0.45 * Math.sin(t * 7.5);
      for (let i = 0; i < BAR_COUNT; i++) {
        const n = pseudoNoise(i, t * 1.6);
        // Tilt energy toward the low end, the way a voice spectrum sits.
        const tilt = 1 - Math.abs(i / BAR_COUNT - 0.5) * 1.5;
        target[i] = Math.max(0, n * tilt * syllable);
      }
    } else {
      // idle / thinking: a slow travelling swell.
      for (let i = 0; i < BAR_COUNT; i++) {
        const wave = Math.sin((i / BAR_COUNT) * Math.PI * 4 + t * 1.4);
        target[i] = 0.18 + 0.14 * wave + 0.08 * pseudoNoise(i, t * 0.5);
      }
    }
  };

  const draw = (now: number) => {
    raf = requestAnimationFrame(draw);
    const t = now / 1000;

    const p = PALETTE[phase];
    hue = lerp(hue, p.hue, 0.05);
    spread = lerp(spread, p.spread, 0.05);
    gain = lerp(gain, p.gain, 0.07);

    sampleMagnitudes(t);
    let sum = 0;
    for (let i = 0; i < BAR_COUNT; i++) {
      bars[i] = lerp(bars[i], target[i], SMOOTHING);
      sum += bars[i];
    }
    level = lerp(level, (sum / BAR_COUNT) * gain, 0.12);

    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height);
    const coreR = base * 0.095 * (1 + level * 0.5);
    const ringR = base * 0.185;
    const maxBar = base * 0.32;
    const rotation = t * (p.drift / 180) * Math.PI * ROTATION_SPEED;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    // ── Ambient bloom behind everything ──────────────────────────────────
    const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 0.5);
    bloom.addColorStop(0, `hsla(${hue}, 95%, 64%, ${0.2 + level * 0.4})`);
    bloom.addColorStop(0.5, `hsla(${hue + spread * 0.5}, 92%, 58%, ${0.09 + level * 0.18})`);
    bloom.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    // ── Radial frequency petals ──────────────────────────────────────────
    ctx.lineCap = "round";
    const crisp = Math.max(1.6, base * 0.006);
    for (let i = 0; i < BAR_COUNT; i++) {
      const mag = bars[i] * gain;
      const angle = (i / BAR_COUNT) * Math.PI * 2 + rotation;
      const len = 3 + mag * maxBar;
      const h = hue + (i / BAR_COUNT) * spread + mag * 52;
      const light = 52 + mag * 30;
      const alpha = 0.32 + mag * 0.68;

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x0 = cx + cos * ringR;
      const y0 = cy + sin * ringR;
      const x1 = cx + cos * (ringR + len);
      const y1 = cy + sin * (ringR + len);

      // Wide, faint underlay — the bloom.
      ctx.strokeStyle = `hsla(${h}, 100%, ${light}%, ${alpha * 0.18})`;
      ctx.lineWidth = crisp * 4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      // Crisp core on top.
      ctx.strokeStyle = `hsla(${h}, 95%, ${light}%, ${alpha})`;
      ctx.lineWidth = crisp;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      // Short inward echo — gives the ring visual weight without noise.
      const x2 = cx + cos * (ringR - len * 0.32);
      const y2 = cy + sin * (ringR - len * 0.32);
      ctx.strokeStyle = `hsla(${h}, 95%, ${light}%, ${alpha * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // ── Core orb ─────────────────────────────────────────────────────────
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    core.addColorStop(0, `hsla(${hue + spread * 0.35}, 100%, 88%, ${0.85 + level * 0.15})`);
    core.addColorStop(0.35, `hsla(${hue}, 98%, 66%, 0.7)`);
    core.addColorStop(1, `hsla(${hue + spread * 0.6}, 96%, 52%, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // ── Containing ring, brightening with level ──────────────────────────
    ctx.strokeStyle = `hsla(${hue + spread * 0.5}, 95%, 70%, ${0.14 + level * 0.35})`;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR - 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalCompositeOperation = "source-over";
  };

  raf = requestAnimationFrame(draw);

  return {
    setPhase(next) {
      phase = next;
    },
    setAnalyser(next) {
      analyser = next;
      freqData = null;
    },
    destroy() {
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
  };
}
