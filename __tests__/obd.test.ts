import {
  isValid,
  dataBytes,
  parseRpm,
  parseSpeed,
  parseCoolant,
  parseLoad,
  parseThrottle,
  parseMap,
  parseIntake,
  parseO2,
  parseBattVolt,
  parseOil,
} from '../obd';

// ── isValid ────────────────────────────────────────────────────────────────

describe('isValid', () => {
  it('returns false for empty string', () => {
    expect(isValid('')).toBe(false);
  });

  it('rejects NO DATA', () => {
    expect(isValid('NO DATA')).toBe(false);
  });

  it('rejects UNABLE TO CONNECT', () => {
    expect(isValid('UNABLE TO CONNECT')).toBe(false);
  });

  it('rejects ERROR', () => {
    expect(isValid('ERROR')).toBe(false);
  });

  it('rejects STOPPED', () => {
    expect(isValid('STOPPED')).toBe(false);
  });

  it('rejects BUS BUSY', () => {
    expect(isValid('BUS BUSY')).toBe(false);
  });

  it('rejects ? (unknown command)', () => {
    expect(isValid('?')).toBe(false);
  });

  it('accepts spaced response with enough bytes (default minBytes=1)', () => {
    // "41 0C 1A F0" → hex "410C1AF0" → 4 bytes, header=2, data=2 ≥ 1
    expect(isValid('41 0C 1A F0')).toBe(true);
  });

  it('accepts compact response', () => {
    expect(isValid('410C1AF0')).toBe(true);
  });

  it('returns false when data bytes are fewer than minBytes', () => {
    // "41 0D 80" → header (41 0D) + 1 data byte — requires 2
    expect(isValid('41 0D 80', 2)).toBe(false);
  });

  it('accepts response with exactly minBytes data bytes', () => {
    expect(isValid('41 0D 80', 1)).toBe(true);
  });

  it('is case-insensitive for error keywords', () => {
    expect(isValid('no data')).toBe(false);
    expect(isValid('No Data')).toBe(false);
  });
});

// ── dataBytes ──────────────────────────────────────────────────────────────

describe('dataBytes', () => {
  it('strips the 2-byte header and returns data bytes', () => {
    // "41 0C 1A F0" → skip 410C → data: 1A=26, F0=240
    expect(dataBytes('41 0C 1A F0')).toEqual([26, 240]);
  });

  it('works with compact hex strings', () => {
    expect(dataBytes('410C1AF0')).toEqual([26, 240]);
  });

  it('returns empty array when there are no data bytes', () => {
    expect(dataBytes('410C')).toEqual([]);
  });

  it('ignores non-hex characters', () => {
    expect(dataBytes('41 0D 80\r\n>')).toEqual([128]);
  });
});

// ── parseRpm ───────────────────────────────────────────────────────────────

describe('parseRpm', () => {
  it('calculates RPM correctly: ((A*256)+B)/4', () => {
    // A=0x1A=26, B=0xF0=240 → (26*256+240)/4 = (6656+240)/4 = 6896/4 = 1724
    expect(parseRpm('41 0C 1A F0')).toBe(1724);
  });

  it('calculates low idle RPM correctly', () => {
    // A=0x03=3, B=0x20=32 → (768+32)/4 = 200 rpm
    expect(parseRpm('41 0C 03 20')).toBe(Math.round((3 * 256 + 0x20) / 4));
  });

  it('returns 0 for invalid response', () => {
    expect(parseRpm('NO DATA')).toBe(0);
    expect(parseRpm('')).toBe(0);
  });

  it('returns 0 when fewer than 2 data bytes', () => {
    expect(parseRpm('41 0C 1A')).toBe(0);
  });
});

// ── parseSpeed ─────────────────────────────────────────────────────────────

describe('parseSpeed', () => {
  it('returns speed as the first data byte', () => {
    // "41 0D 64" → 0x64 = 100 km/h
    expect(parseSpeed('41 0D 64')).toBe(100);
  });

  it('returns 0 for invalid response', () => {
    expect(parseSpeed('NO DATA')).toBe(0);
  });
});

// ── parseCoolant ───────────────────────────────────────────────────────────

describe('parseCoolant', () => {
  it('returns temp as A-40', () => {
    // 0x6E = 110 → 110-40 = 70°C
    expect(parseCoolant('41 05 6E')).toBe(70);
  });

  it('returns null when byte is 0 (sensor not ready)', () => {
    expect(parseCoolant('41 05 00')).toBeNull();
  });

  it('returns null for invalid response', () => {
    expect(parseCoolant('NO DATA')).toBeNull();
  });

  it('handles cold engine temperature', () => {
    // 0x28 = 40 → 40-40 = 0°C
    expect(parseCoolant('41 05 28')).toBe(0);
  });
});

// ── parseLoad ──────────────────────────────────────────────────────────────

describe('parseLoad', () => {
  it('calculates load percentage correctly', () => {
    // 0xFF = 255 → 100%
    expect(parseLoad('41 04 FF')).toBe(100);
  });

  it('returns 0 for zero load', () => {
    expect(parseLoad('41 04 00')).toBe(0);
  });

  it('calculates mid-range load', () => {
    // 0x80 = 128 → Math.round(128*100/255) = 50
    expect(parseLoad('41 04 80')).toBe(Math.round(128 * 100 / 255));
  });

  it('returns 0 for invalid response', () => {
    expect(parseLoad('NO DATA')).toBe(0);
  });
});

// ── parseThrottle ──────────────────────────────────────────────────────────

describe('parseThrottle', () => {
  it('calculates throttle percentage correctly', () => {
    expect(parseThrottle('41 11 FF')).toBe(100);
  });

  it('returns 0 for closed throttle', () => {
    expect(parseThrottle('41 11 00')).toBe(0);
  });

  it('returns 0 for invalid response', () => {
    expect(parseThrottle('NO DATA')).toBe(0);
  });
});

// ── parseMap ───────────────────────────────────────────────────────────────

describe('parseMap', () => {
  it('returns MAP value as first data byte (kPa)', () => {
    // 0x65 = 101 kPa (roughly atmospheric)
    expect(parseMap('41 0B 65')).toBe(101);
  });

  it('returns 0 for invalid response', () => {
    expect(parseMap('NO DATA')).toBe(0);
  });
});

// ── parseIntake ────────────────────────────────────────────────────────────

describe('parseIntake', () => {
  it('returns intake temp as A-40', () => {
    // 0x46 = 70 → 70-40 = 30°C
    expect(parseIntake('41 0F 46')).toBe(30);
  });

  it('returns null when byte is 0', () => {
    expect(parseIntake('41 0F 00')).toBeNull();
  });

  it('returns null for invalid response', () => {
    expect(parseIntake('NO DATA')).toBeNull();
  });
});

// ── parseO2 ────────────────────────────────────────────────────────────────

describe('parseO2', () => {
  it('calculates O2 voltage as A*0.005', () => {
    // 0x9A = 154 → 154 * 0.005 = 0.77V
    expect(parseO2('41 14 9A')).toBeCloseTo(0.77, 5);
  });

  it('returns 0 for invalid response', () => {
    expect(parseO2('NO DATA')).toBe(0);
  });
});

// ── parseBattVolt ──────────────────────────────────────────────────────────

describe('parseBattVolt', () => {
  it('calculates battery voltage as ((A*256)+B)/1000', () => {
    // 12V = 12000 → A=0x2E=46, B=0xE0=224 → (46*256+224)/1000 = 12.0
    const a = 46, b = 224;
    const expected = (a * 256 + b) / 1000;
    const hex = (x: number) => x.toString(16).padStart(2, '0').toUpperCase();
    expect(parseBattVolt(`41 42 ${hex(a)} ${hex(b)}`)).toBeCloseTo(expected, 3);
  });

  it('returns 0 for voltage below 6V (sanity check)', () => {
    // 1V = 1000 → A=0x03, B=0xE8
    expect(parseBattVolt('41 42 03 E8')).toBe(0);
  });

  it('returns 0 for voltage above 20V (sanity check)', () => {
    // 25V = 25000 → A=0x61, B=0xA8
    expect(parseBattVolt('41 42 61 A8')).toBe(0);
  });

  it('returns 0 for invalid response', () => {
    expect(parseBattVolt('NO DATA')).toBe(0);
  });

  it('returns 0 when fewer than 2 data bytes', () => {
    expect(parseBattVolt('41 42 2E')).toBe(0);
  });
});

// ── parseOil ───────────────────────────────────────────────────────────────

describe('parseOil', () => {
  it('returns oil temp as A-40', () => {
    // 0x82 = 130 → 130-40 = 90°C
    expect(parseOil('41 5C 82')).toBe(90);
  });

  it('returns null when byte is 0 (sensor absent)', () => {
    expect(parseOil('41 5C 00')).toBeNull();
  });

  it('returns null for invalid response', () => {
    expect(parseOil('NO DATA')).toBeNull();
  });
});
