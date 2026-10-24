export const OVERLAY_BARS = 20;

/**
 * RMS of the analyser's byte time-domain data, scaled and clamped to 0..1 so
 * ordinary speech fills most of the bar height.
 */
export function levelFromSamples(samples: Uint8Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let squares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = (samples[index] - 128) / 128;
    squares += sample * sample;
  }

  const rms = Math.sqrt(squares / samples.length);
  return Math.max(0, Math.min(1, rms * 6));
}

/** Append a level, dropping the oldest so the list stays a fixed width. */
export function pushLevel(levels: number[], level: number): number[] {
  return [...levels.slice(-(OVERLAY_BARS - 1)), level];
}
