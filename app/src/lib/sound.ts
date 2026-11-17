/** Tiny synthesized sounds (no audio files). Off by default; toggled in Stats → Settings. */
let ctx: AudioContext | null = null

function tone(freq: number, ms: number, type: OscillatorType = 'square', gain = 0.04, at = 0) {
  ctx ??= new AudioContext()
  const t = ctx.currentTime + at
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000)
  o.connect(g).connect(ctx.destination)
  o.start(t)
  o.stop(t + ms / 1000)
}

export type Sound = 'move' | 'capture' | 'good' | 'bad' | 'levelup'

export function play(s: Sound, enabled: boolean) {
  if (!enabled || typeof window === 'undefined') return
  try {
    if (s === 'move') tone(520, 60, 'triangle', 0.05)
    else if (s === 'capture') { tone(330, 70, 'square', 0.04); tone(220, 90, 'triangle', 0.04, 0.05) }
    else if (s === 'good') { tone(660, 80, 'square', 0.035); tone(990, 120, 'square', 0.035, 0.08) }
    else if (s === 'bad') tone(140, 180, 'sawtooth', 0.03)
    else if (s === 'levelup') [523, 659, 784, 1046].forEach((f, i) => tone(f, 120, 'square', 0.035, i * 0.09))
  } catch { /* audio unavailable: silently skip */ }
}
