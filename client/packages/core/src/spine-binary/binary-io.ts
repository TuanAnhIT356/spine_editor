/**
 * Primitive binary encodings of the Spine .skel format, per the public
 * binary-format documentation: varint (LEB128, MSB continuation; zigzag for
 * signed), length-prefixed UTF-8 strings (0 = null, 1 = empty), big-endian
 * int32/float32, RGBA8888 colors packed into an int32.
 */

export class DataWriter {
  private buf = new Uint8Array(1024);
  private len = 0;

  private ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf);
    this.buf = next;
  }

  byte(v: number): void {
    this.ensure(1);
    this.buf[this.len++] = v & 0xff;
  }

  boolean(b: boolean): void {
    this.byte(b ? 1 : 0);
  }

  int32(v: number): void {
    this.ensure(4);
    this.buf[this.len++] = (v >>> 24) & 0xff;
    this.buf[this.len++] = (v >>> 16) & 0xff;
    this.buf[this.len++] = (v >>> 8) & 0xff;
    this.buf[this.len++] = v & 0xff;
  }

  float32(v: number): void {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v, false); // big-endian
    this.ensure(4);
    for (let i = 0; i < 4; i++) this.buf[this.len++] = dv.getUint8(i);
  }

  varint(value: number, optimizePositive = true): void {
    let v = optimizePositive ? value >>> 0 : ((value << 1) ^ (value >> 31)) >>> 0;
    do {
      let b = v & 0x7f;
      v >>>= 7;
      if (v !== 0) b |= 0x80;
      this.byte(b);
    } while (v !== 0);
  }

  utf8String(s: string | null): void {
    if (s === null) {
      this.varint(0);
      return;
    }
    const encoded = new TextEncoder().encode(s);
    this.varint(encoded.length + 1);
    this.ensure(encoded.length);
    this.buf.set(encoded, this.len);
    this.len += encoded.length;
  }

  /** 8-hex rgba → packed int32 (R in the high byte). */
  color8888(hex8: string): void {
    this.int32(parseInt(hex8, 16) | 0);
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

export class DataReader {
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {}

  get eof(): boolean {
    return this.pos >= this.buf.length;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error(`Unexpected end of .skel data at offset ${this.pos}.`);
    }
  }

  byte(): number {
    this.need(1);
    return this.buf[this.pos++]!;
  }

  boolean(): boolean {
    return this.byte() !== 0;
  }

  int32(): number {
    this.need(4);
    const v =
      (this.buf[this.pos]! << 24) |
      (this.buf[this.pos + 1]! << 16) |
      (this.buf[this.pos + 2]! << 8) |
      this.buf[this.pos + 3]!;
    this.pos += 4;
    return v | 0;
  }

  float32(): number {
    this.need(4);
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4);
    this.pos += 4;
    return dv.getFloat32(0, false);
  }

  varint(optimizePositive = true): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.byte();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error(`Varint too long at offset ${this.pos}.`);
    }
    result >>>= 0;
    if (optimizePositive) return result;
    return (result >>> 1) ^ -(result & 1);
  }

  utf8String(): string | null {
    const len = this.varint();
    if (len === 0) return null;
    if (len === 1) return '';
    this.need(len - 1);
    const s = new TextDecoder().decode(this.buf.subarray(this.pos, this.pos + len - 1));
    this.pos += len - 1;
    return s;
  }

  color8888(): string {
    return (this.int32() >>> 0).toString(16).padStart(8, '0');
  }
}
