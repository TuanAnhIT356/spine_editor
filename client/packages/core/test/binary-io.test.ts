import { describe, expect, it } from 'vitest';
import { DataReader, DataWriter } from '../src/spine-binary/binary-io.js';

function roundTrip(write: (w: DataWriter) => void): DataReader {
  const w = new DataWriter();
  write(w);
  return new DataReader(w.bytes());
}

describe('DataWriter/DataReader', () => {
  it('round-trips varint+ boundary values', () => {
    const values = [0, 1, 127, 128, 255, 16383, 16384, 2097151, 268435455, 2147483647];
    const r = roundTrip((w) => values.forEach((v) => w.varint(v)));
    for (const v of values) expect(r.varint()).toBe(v);
    expect(r.eof).toBe(true);
  });

  it('round-trips varint- (zigzag) negatives', () => {
    const values = [0, -1, 1, -64, 64, -8191, 8192, -2147483648, 2147483647];
    const r = roundTrip((w) => values.forEach((v) => w.varint(v, false)));
    for (const v of values) expect(r.varint(false)).toBe(v);
  });

  it('round-trips strings: null, empty, unicode', () => {
    const values = [null, '', 'bone', 'xương-🦴', 'a'.repeat(300)];
    const r = roundTrip((w) => values.forEach((v) => w.utf8String(v)));
    for (const v of values) expect(r.utf8String()).toBe(v);
  });

  it('round-trips float32 big-endian and int32', () => {
    const r = roundTrip((w) => {
      w.float32(1.5);
      w.float32(-123.25);
      w.int32(-1);
      w.int32(0x01020304);
    });
    expect(r.float32()).toBeCloseTo(1.5, 5);
    expect(r.float32()).toBeCloseTo(-123.25, 5);
    expect(r.int32()).toBe(-1);
    expect(r.int32()).toBe(0x01020304);
  });

  it('float32 is big-endian on the wire', () => {
    const w = new DataWriter();
    w.float32(1); // IEEE754 BE: 3f 80 00 00
    expect([...w.bytes()]).toEqual([0x3f, 0x80, 0x00, 0x00]);
  });

  it('round-trips rgba8888 colors', () => {
    const r = roundTrip((w) => {
      w.color8888('ff8800cc');
      w.color8888('00000000');
    });
    expect(r.color8888()).toBe('ff8800cc');
    expect(r.color8888()).toBe('00000000');
  });

  it('throws with offset on truncated input', () => {
    const r = new DataReader(new Uint8Array([0x3f, 0x80]));
    expect(() => r.float32()).toThrow(/offset/);
  });
});
