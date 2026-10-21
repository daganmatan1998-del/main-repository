// EAN-13 helpers for the barcode tests: the module pattern of a code and a
// PPM picture of it.

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
export const withCheck = (d12) => d12 + String((10 - ([...d12].reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10);
export function ean13Modules(code) {
  const d = [...code].map(Number);
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (PARITY[d[0]][i] === 'L' ? L : G)[d[i + 1]];
  bits += '01010';
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]];
  return bits + '101';
}
// A PPM of the barcode on white (quiet zones included), width x height.
export function ppm(code, w = 640, h = 480) {
  const bits = ean13Modules(code);
  const unit = Math.floor((w * 0.6) / bits.length);
  const bw = unit * bits.length;
  const x0 = Math.floor((w - bw) / 2);
  const y0 = Math.floor(h * 0.3);
  const y1 = Math.floor(h * 0.7);
  const px = Buffer.alloc(w * h * 3, 255);
  for (let y = y0; y < y1; y++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') for (let k = 0; k < unit; k++) { const o = (y * w + x0 + i * unit + k) * 3; px[o] = px[o + 1] = px[o + 2] = 0; }
  return Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), px]);
}

