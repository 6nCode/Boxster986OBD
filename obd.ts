/**
 * ELM327 / OBD2 response parsing utilities.
 * Pure functions — no side-effects, fully unit-testable.
 */

/**
 * Returns true if the raw ELM327 response contains at least `minBytes`
 * usable hex data bytes (header bytes 41+PID excluded).
 */
export function isValid(raw: string, minBytes: number = 1): boolean {
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (upper.includes('NO DATA')) return false;
  if (upper.includes('UNABLE'))  return false;
  if (upper.includes('ERROR'))   return false;
  if (upper.includes('STOPPED')) return false;
  if (upper.includes('BUS'))     return false;
  if (upper.includes('?'))       return false;
  const bytes = upper.replace(/[^0-9A-F]/g, '');
  return bytes.length >= (minBytes + 2) * 2; // +2 for mode+PID header bytes
}

/**
 * Strips the 2-byte ELM327 header (mode + PID) and returns the remaining
 * data as an array of integers.
 */
export function dataBytes(raw: string): number[] {
  const hex = raw.toUpperCase().replace(/[^0-9A-F]/g, '');
  const result: number[] = [];
  for (let i = 4; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16);
    if (!isNaN(b)) result.push(b);
  }
  return result;
}

// ── PID parsers ────────────────────────────────────────────────────────────

/** PID 0x0C — RPM = ((A*256)+B)/4 */
export function parseRpm(raw: string): number {
  if (!isValid(raw, 2)) return 0;
  const b = dataBytes(raw);
  return b.length >= 2 ? Math.round(((b[0] * 256) + b[1]) / 4) : 0;
}

/** PID 0x0D — Speed (km/h) = A */
export function parseSpeed(raw: string): number {
  if (!isValid(raw, 1)) return 0;
  const b = dataBytes(raw);
  return b.length >= 1 ? b[0] : 0;
}

/** PID 0x05 — Coolant temp (°C) = A-40; null if unavailable */
export function parseCoolant(raw: string): number | null {
  if (!isValid(raw, 1)) return null;
  const b = dataBytes(raw);
  return b.length >= 1 && b[0] > 0 ? b[0] - 40 : null;
}

/** PID 0x04 — Engine load (%) = A*100/255 */
export function parseLoad(raw: string): number {
  if (!isValid(raw, 1)) return 0;
  const b = dataBytes(raw);
  return b.length >= 1 ? Math.round(b[0] * 100 / 255) : 0;
}

/** PID 0x11 — Throttle position (%) = A*100/255 */
export function parseThrottle(raw: string): number {
  if (!isValid(raw, 1)) return 0;
  const b = dataBytes(raw);
  return b.length >= 1 ? Math.round(b[0] * 100 / 255) : 0;
}

/** PID 0x0B — MAP (kPa) = A */
export function parseMap(raw: string): number {
  if (!isValid(raw, 1)) return 0;
  const b = dataBytes(raw);
  return b.length >= 1 ? b[0] : 0;
}

/** PID 0x0F — Intake air temp (°C) = A-40; null if unavailable */
export function parseIntake(raw: string): number | null {
  if (!isValid(raw, 1)) return null;
  const b = dataBytes(raw);
  return b.length >= 1 && b[0] > 0 ? b[0] - 40 : null;
}

/** PID 0x14 — O2 sensor B1S1 (V) = A*0.005 */
export function parseO2(raw: string): number {
  if (!isValid(raw, 1)) return 0;
  const b = dataBytes(raw);
  return b.length >= 1 ? b[0] * 0.005 : 0;
}

/** PID 0x42 — Battery voltage (V) = ((A*256)+B)/1000 */
export function parseBattVolt(raw: string): number {
  if (!isValid(raw, 2)) return 0;
  const b = dataBytes(raw);
  if (b.length < 2) return 0;
  const v = ((b[0] * 256) + b[1]) / 1000;
  return v > 6 && v < 20 ? v : 0; // sanity check
}

/** PID 0x5C — Oil temp (°C) = A-40; null if unavailable */
export function parseOil(raw: string): number | null {
  if (!isValid(raw, 1)) return null;
  const b = dataBytes(raw);
  return b.length >= 1 && b[0] > 0 ? b[0] - 40 : null;
}
