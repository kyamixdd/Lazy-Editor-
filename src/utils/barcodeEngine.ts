import { BarcodeFormat, DocumentElement } from '../types/pdfStudio';

export interface BarcodeEncodeResult {
  ok: boolean;
  format: BarcodeFormat;
  normalizedValue: string;
  displayValue: string;
  checkDigitComputed?: string;
  error?: string;
  matrix?: {
    size: number;
    rows: number[][];
  };
  linearModules?: number[];
  totalModules?: number;
}

export interface BarcodeValidationReport {
  valid: boolean;
  warnings: string[];
  errors: string[];
  moduleSizePt: number;
  quietZonePt: number;
  encoded: BarcodeEncodeResult;
}

// ============================================================================
// 1. CODE 128 (Set B — Printable ASCII 32..126 + Mod-103 Checksum)
// ============================================================================
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function appendBarPattern(out: number[], pattern: string) {
  for (let i = 0; i < pattern.length; i++) {
    const width = Number(pattern[i]);
    const isBar = i % 2 === 0 ? 1 : 0;
    for (let k = 0; k < width; k++) {
      out.push(isBar);
    }
  }
}

function encodeCode128(rawValue: string): BarcodeEncodeResult {
  const value = rawValue.trim();
  if (!value) {
    return {
      ok: false,
      format: 'code128',
      normalizedValue: '',
      displayValue: '',
      error: 'Code 128 payload cannot be empty.',
    };
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) {
      return {
        ok: false,
        format: 'code128',
        normalizedValue: value,
        displayValue: value,
        error: `Unsupported character "${value[i]}" in Code 128B (ASCII 32–126 only).`,
      };
    }
  }

  const symbols: number[] = [104]; // Start Code B
  let checksum = 104;
  for (let i = 0; i < value.length; i++) {
    const val = value.charCodeAt(i) - 32;
    symbols.push(val);
    checksum += val * (i + 1);
  }
  const checkIdx = checksum % 103;
  symbols.push(checkIdx);
  symbols.push(106); // Stop

  const modules: number[] = [];
  for (const sym of symbols) {
    appendBarPattern(modules, CODE128_PATTERNS[sym]);
  }

  return {
    ok: true,
    format: 'code128',
    normalizedValue: value,
    displayValue: value,
    linearModules: modules,
    totalModules: modules.length,
  };
}

// ============================================================================
// 2. CODE 39 (0-9, A-Z, - . space $ / + %, wrapped in * Start/Stop)
// ============================================================================
const CODE39_MAP: Record<string, string> = {
  '0': '111221211', '1': '211211112', '2': '112211112', '3': '212211111',
  '4': '111221112', '5': '211221111', '6': '112221111', '7': '111211212',
  '8': '211211211', '9': '112211211',
  'A': '211112112', 'B': '112112112', 'C': '212112111', 'D': '111122112',
  'E': '211122111', 'F': '112122111', 'G': '111112212', 'H': '211112211',
  'I': '112112211', 'J': '111122211', 'K': '211111122', 'L': '112111122',
  'M': '212111121', 'N': '111121122', 'O': '211121121', 'P': '112121121',
  'Q': '111111222', 'R': '211111221', 'S': '112111221', 'T': '111121221',
  'U': '221111112', 'V': '122111112', 'W': '222111111', 'X': '121121112',
  'Y': '221121111', 'Z': '122121111',
  '-': '121111212', '.': '221111211', ' ': '122111211', '$': '121212111',
  '/': '121211121', '+': '121112121', '%': '111212121', '*': '121121211',
};

function encodeCode39(rawValue: string): BarcodeEncodeResult {
  const upper = rawValue.trim().toUpperCase().replace(/^\*+|\*+$/g, '');
  if (!upper) {
    return {
      ok: false,
      format: 'code39',
      normalizedValue: '',
      displayValue: '',
      error: 'Code 39 payload cannot be empty.',
    };
  }
  for (const ch of upper) {
    if (!CODE39_MAP[ch] || ch === '*') {
      return {
        ok: false,
        format: 'code39',
        normalizedValue: upper,
        displayValue: upper,
        error: `Unsupported character "${ch}" in Code 39 (allowed: 0-9, A-Z, -.$/+% and space).`,
      };
    }
  }

  const full = `*${upper}*`;
  const modules: number[] = [];
  for (let idx = 0; idx < full.length; idx++) {
    appendBarPattern(modules, CODE39_MAP[full[idx]]);
    if (idx < full.length - 1) {
      modules.push(0); // inter-character narrow gap
    }
  }

  return {
    ok: true,
    format: 'code39',
    normalizedValue: upper,
    displayValue: `*${upper}*`,
    linearModules: modules,
    totalModules: modules.length,
  };
}

// ============================================================================
// 3. EAN-13 & UPC-A (Strict Numeric + GS1 Mod-10 Check Digit Verification)
// ============================================================================
const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const EAN_R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const EAN13_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

function computeEan13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(first12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function computeUpcaCheckDigit(first11: string): number {
  let oddSum = 0;
  let evenSum = 0;
  for (let i = 0; i < 11; i++) {
    const d = Number(first11[i]);
    if (i % 2 === 0) oddSum += d;
    else evenSum += d;
  }
  return (10 - ((oddSum * 3 + evenSum) % 10)) % 10;
}

function encodeEan13(rawValue: string): BarcodeEncodeResult {
  const digits = rawValue.replace(/\s+/g, '');
  if (!/^\d+$/.test(digits)) {
    return {
      ok: false,
      format: 'ean13',
      normalizedValue: digits,
      displayValue: digits,
      error: 'EAN-13 must contain digits only.',
    };
  }
  if (digits.length !== 12 && digits.length !== 13) {
    return {
      ok: false,
      format: 'ean13',
      normalizedValue: digits,
      displayValue: digits,
      error: `EAN-13 requires 12 or 13 digits (got ${digits.length}).`,
    };
  }
  const base12 = digits.slice(0, 12);
  const expected = computeEan13CheckDigit(base12);
  if (digits.length === 13 && Number(digits[12]) !== expected) {
    return {
      ok: false,
      format: 'ean13',
      normalizedValue: digits,
      displayValue: digits,
      checkDigitComputed: String(expected),
      error: `Invalid EAN-13 check digit: expected ${expected}, got ${digits[12]}.`,
    };
  }
  const full13 = `${base12}${expected}`;
  const firstDigit = Number(full13[0]);
  const parityPattern = EAN13_PARITY[firstDigit];
  let bits = '101'; // Left guard
  for (let i = 1; i <= 6; i++) {
    const d = Number(full13[i]);
    bits += parityPattern[i - 1] === 'L' ? EAN_L[d] : EAN_G[d];
  }
  bits += '01010'; // Center guard
  for (let i = 7; i <= 12; i++) {
    bits += EAN_R[Number(full13[i])];
  }
  bits += '101'; // Right guard
  const modules = Array.from(bits, (ch) => (ch === '1' ? 1 : 0));
  return {
    ok: true,
    format: 'ean13',
    normalizedValue: full13,
    displayValue: full13,
    checkDigitComputed: String(expected),
    linearModules: modules,
    totalModules: modules.length,
  };
}

function encodeUpca(rawValue: string): BarcodeEncodeResult {
  const digits = rawValue.replace(/\s+/g, '');
  if (!/^\d+$/.test(digits)) {
    return {
      ok: false,
      format: 'upca',
      normalizedValue: digits,
      displayValue: digits,
      error: 'UPC-A must contain digits only.',
    };
  }
  if (digits.length !== 11 && digits.length !== 12) {
    return {
      ok: false,
      format: 'upca',
      normalizedValue: digits,
      displayValue: digits,
      error: `UPC-A requires 11 or 12 digits (got ${digits.length}).`,
    };
  }
  const base11 = digits.slice(0, 11);
  const expected = computeUpcaCheckDigit(base11);
  if (digits.length === 12 && Number(digits[11]) !== expected) {
    return {
      ok: false,
      format: 'upca',
      normalizedValue: digits,
      displayValue: digits,
      checkDigitComputed: String(expected),
      error: `Invalid UPC-A check digit: expected ${expected}, got ${digits[11]}.`,
    };
  }
  const full12 = `${base11}${expected}`;
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += EAN_L[Number(full12[i])];
  bits += '01010';
  for (let i = 6; i < 12; i++) bits += EAN_R[Number(full12[i])];
  bits += '101';
  const modules = Array.from(bits, (ch) => (ch === '1' ? 1 : 0));
  return {
    ok: true,
    format: 'upca',
    normalizedValue: full12,
    displayValue: full12,
    checkDigitComputed: String(expected),
    linearModules: modules,
    totalModules: modules.length,
  };
}

// ============================================================================
// 4. QR CODE (ISO/IEC 18004 Byte Mode, Versions 1..10, EC Levels L/M/Q/H)
// ============================================================================
type QrEcLevel = 'L' | 'M' | 'Q' | 'H';

interface QrVersionSpec {
  // [ecBytesPerBlock, g1Blocks, g1DataBytes, g2Blocks, g2DataBytes]
  L: [number, number, number, number, number];
  M: [number, number, number, number, number];
  Q: [number, number, number, number, number];
  H: [number, number, number, number, number];
}

// Verified ISO/IEC 18004 Table 9 specs for Versions 1..10
const QR_SPECS: Record<number, QrVersionSpec> = {
  1: { L: [7, 1, 19, 0, 0], M: [10, 1, 16, 0, 0], Q: [13, 1, 13, 0, 0], H: [17, 1, 9, 0, 0] },
  2: { L: [10, 1, 34, 0, 0], M: [16, 1, 28, 0, 0], Q: [22, 1, 22, 0, 0], H: [28, 1, 16, 0, 0] },
  3: { L: [15, 1, 55, 0, 0], M: [26, 1, 44, 0, 0], Q: [18, 2, 17, 0, 0], H: [22, 2, 13, 0, 0] },
  4: { L: [20, 1, 80, 0, 0], M: [18, 2, 32, 0, 0], Q: [26, 2, 24, 0, 0], H: [16, 4, 9, 0, 0] },
  5: { L: [26, 1, 108, 0, 0], M: [24, 2, 43, 0, 0], Q: [18, 2, 15, 2, 16], H: [22, 2, 11, 2, 12] },
  6: { L: [18, 2, 68, 0, 0], M: [16, 4, 27, 0, 0], Q: [24, 4, 19, 0, 0], H: [28, 4, 15, 0, 0] },
  7: { L: [20, 2, 78, 0, 0], M: [18, 4, 31, 0, 0], Q: [18, 2, 14, 4, 15], H: [26, 4, 13, 1, 14] },
  8: { L: [24, 2, 97, 0, 0], M: [22, 2, 38, 2, 39], Q: [22, 4, 18, 2, 19], H: [26, 4, 14, 2, 15] },
  9: { L: [30, 2, 116, 0, 0], M: [22, 3, 36, 2, 37], Q: [20, 4, 16, 4, 17], H: [24, 4, 12, 4, 13] },
  10: { L: [18, 2, 68, 2, 69], M: [26, 4, 43, 1, 44], Q: [24, 6, 19, 2, 20], H: [28, 6, 15, 2, 16] },
};

const QR_ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// GF(256) with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly: number[] = [1];
  for (let i = 0; i < degree; i++) {
    const factor = [1, GF_EXP[i]];
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      for (let k = 0; k < factor.length; k++) {
        next[j + k] ^= gfMul(poly[j], factor[k]);
      }
    }
    poly = next;
  }
  return Uint8Array.from(poly);
}

function rsComputeEc(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const work = new Uint8Array(data.length + ecCount);
  work.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = work[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        work[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return work.slice(data.length);
}

function computeFormatBits(ecLevel: QrEcLevel, mask: number): number {
  const ecBits = ecLevel === 'L' ? 1 : ecLevel === 'M' ? 0 : ecLevel === 'Q' ? 3 : 2;
  const data = (ecBits << 3) | mask;
  let rem = data << 10;
  const poly = 0x537;
  for (let bit = 14; bit >= 10; bit--) {
    if ((rem >> bit) & 1) {
      rem ^= poly << (bit - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version: number): number {
  let rem = version << 12;
  const poly = 0x1f25;
  for (let bit = 17; bit >= 12; bit--) {
    if ((rem >> bit) & 1) {
      rem ^= poly << (bit - 12);
    }
  }
  return (version << 12) | rem;
}

function scoreQrPenalty(grid: number[][]): number {
  const n = grid.length;
  let penalty = 0;

  // N1: 5+ consecutive same color in row or col
  for (let r = 0; r < n; r++) {
    let runColor = grid[r][0];
    let runLen = 1;
    for (let c = 1; c < n; c++) {
      if (grid[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = grid[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < n; c++) {
    let runColor = grid[0][c];
    let runLen = 1;
    for (let r = 1; r < n; r++) {
      if (grid[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = grid[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // N2: 2x2 blocks of same color
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  // N3: finder-like 1:1:3:1:1 patterns
  const matchPattern = (arr: number[], start: number, pat: number[]) => {
    for (let i = 0; i < pat.length; i++) {
      if (arr[start + i] !== pat[i]) return false;
    }
    return true;
  };
  const patA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c <= n - 11; c++) {
      if (matchPattern(grid[r], c, patA) || matchPattern(grid[r], c, patB)) {
        penalty += 40;
      }
    }
  }
  for (let c = 0; c < n; c++) {
    const col = grid.map((row) => row[c]);
    for (let r = 0; r <= n - 11; r++) {
      if (matchPattern(col, r, patA) || matchPattern(col, r, patB)) {
        penalty += 40;
      }
    }
  }

  // N4: dark module ratio deviation from 50%
  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] === 1) dark++;
    }
  }
  const pct = (dark * 100) / (n * n);
  const k = Math.floor(Math.abs(pct - 50) / 5);
  penalty += k * 10;

  return penalty;
}

function maskCondition(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

export function encodeQrCode(
  rawValue: string,
  ecLevel: QrEcLevel = 'M'
): BarcodeEncodeResult {
  const value = rawValue.trim();
  if (!value) {
    return {
      ok: false,
      format: 'qr',
      normalizedValue: '',
      displayValue: '',
      error: 'QR Code payload cannot be empty.',
    };
  }

  const utf8Bytes = new TextEncoder().encode(value);
  let chosenVersion = -1;
  for (let v = 1; v <= 10; v++) {
    const [, g1B, g1D, g2B, g2D] = QR_SPECS[v][ecLevel];
    const totalDataCodewords = g1B * g1D + g2B * g2D;
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    const maxBytes = Math.floor((totalDataCodewords * 8 - headerBits) / 8);
    if (utf8Bytes.length <= maxBytes) {
      chosenVersion = v;
      break;
    }
  }

  if (chosenVersion === -1) {
    return {
      ok: false,
      format: 'qr',
      normalizedValue: value,
      displayValue: value,
      error: `QR payload (${utf8Bytes.length} bytes) exceeds Version 10 capacity at EC-${ecLevel}. Shorten text or lower EC level.`,
    };
  }

  const v = chosenVersion;
  const [ecPerBlock, g1B, g1D, g2B, g2D] = QR_SPECS[v][ecLevel];
  const totalDataCodewords = g1B * g1D + g2B * g2D;

  // Build bit buffer: 0100 (byte mode) + char count + bytes + terminator + padding
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };
  pushBits(0b0100, 4);
  pushBits(utf8Bytes.length, v <= 9 ? 8 : 16);
  for (const b of utf8Bytes) pushBits(b, 8);
  const maxDataBits = totalDataCodewords * 8;
  const terminatorLen = Math.min(4, maxDataBits - bits.length);
  pushBits(0, terminatorLen);
  while (bits.length % 8 !== 0) bits.push(0);
  let padToggle = 0;
  while (bits.length < maxDataBits) {
    pushBits(padToggle === 0 ? 0xec : 0x11, 8);
    padToggle ^= 1;
  }

  const dataCodewords = new Uint8Array(totalDataCodewords);
  for (let i = 0; i < totalDataCodewords; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    dataCodewords[i] = byte;
  }

  // Split into blocks & compute Reed-Solomon EC codewords
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < g1B; i++) {
    const blk = dataCodewords.slice(offset, offset + g1D);
    dataBlocks.push(blk);
    ecBlocks.push(rsComputeEc(blk, ecPerBlock));
    offset += g1D;
  }
  for (let i = 0; i < g2B; i++) {
    const blk = dataCodewords.slice(offset, offset + g2D);
    dataBlocks.push(blk);
    ecBlocks.push(rsComputeEc(blk, ecPerBlock));
    offset += g2D;
  }

  // Interleave codewords
  const finalBytes: number[] = [];
  const maxDataLen = Math.max(g1D, g2D);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalBytes.push(blk[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ecBlk of ecBlocks) {
      finalBytes.push(ecBlk[i]);
    }
  }

  const finalBits: number[] = [];
  for (const b of finalBytes) {
    for (let bit = 7; bit >= 0; bit--) finalBits.push((b >> bit) & 1);
  }

  // Construct matrix template with function modules marked
  const size = v * 4 + 17;
  const baseGrid: number[][] = Array.from({ length: size }, () =>
    Array(size).fill(0)
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  const setFunc = (r: number, c: number, val: number) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    baseGrid[r][c] = val;
    isFunction[r][c] = true;
  };

  const placeFinder = (topR: number, leftC: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        const inSep = dr === -1 || dr === 7 || dc === -1 || dc === 7;
        setFunc(r, c, !inSep && (inOuter || inInner) ? 1 : 0);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns
  const centers = QR_ALIGNMENT_CENTERS[v] || [];
  for (const cr of centers) {
    for (const cc of centers) {
      // Skip corners colliding with finder patterns
      if (
        (cr <= 8 && cc <= 8) ||
        (cr <= 8 && cc >= size - 9) ||
        (cr >= size - 9 && cc <= 8)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark =
            Math.max(Math.abs(dr), Math.abs(dc)) === 2 || (dr === 0 && dc === 0);
          setFunc(cr + dr, cc + dc, dark ? 1 : 0);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0 ? 1 : 0);
    setFunc(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Dark module
  setFunc(4 * v + 9, 8, 1);

  // Reserve Format Info positions
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunc(8, i, 0);
      setFunc(i, 8, 0);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunc(8, size - 1 - i, 0);
  }
  for (let i = 0; i < 7; i++) {
    setFunc(size - 1 - i, 8, 0);
  }

  // Version Info (v >= 7)
  if (v >= 7) {
    const vBits = computeVersionBits(v);
    for (let i = 0; i < 18; i++) {
      const bit = (vBits >> i) & 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setFunc(r, c, bit);
      setFunc(c, r, bit);
    }
  }

  // Place data bits in zig-zag order
  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = rightCol - dx;
        if (!isFunction[r][c]) {
          baseGrid[r][c] = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
        }
      }
    }
    upward = !upward;
  }

  // Try all 8 masks & pick minimum penalty
  let bestGrid = baseGrid;
  let bestPenalty = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseGrid.map((row, r) =>
      row.map((val, c) =>
        isFunction[r][c] ? val : maskCondition(mask, r, c) ? val ^ 1 : val
      )
    );

    const fmt = computeFormatBits(ecLevel, mask);
    // Write format info
    for (let i = 0; i <= 5; i++) candidate[8][i] = (fmt >> (14 - i)) & 1;
    candidate[8][7] = (fmt >> 8) & 1;
    candidate[8][8] = (fmt >> 7) & 1;
    candidate[7][8] = (fmt >> 6) & 1;
    for (let i = 9; i <= 14; i++) candidate[14 - i][8] = (fmt >> (14 - i)) & 1;

    for (let i = 0; i <= 6; i++) candidate[size - 1 - i][8] = (fmt >> (14 - i)) & 1;
    for (let i = 7; i <= 14; i++) {
      candidate[8][size - 15 + i] = (fmt >> (14 - i)) & 1;
    }

    const penalty = scoreQrPenalty(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestGrid = candidate;
    }
  }

  return {
    ok: true,
    format: 'qr',
    normalizedValue: value,
    displayValue: value,
    matrix: {
      size,
      rows: bestGrid,
    },
  };
}

// ============================================================================
// 5. UNIFIED ENTRYPOINT + SCANNABILITY VALIDATOR
// ============================================================================
export function encodeBarcode(
  format: BarcodeFormat,
  rawValue: string,
  qrErrorCorrection: QrEcLevel = 'M'
): BarcodeEncodeResult {
  switch (format) {
    case 'qr':
      return encodeQrCode(rawValue, qrErrorCorrection);
    case 'code128':
      return encodeCode128(rawValue);
    case 'code39':
      return encodeCode39(rawValue);
    case 'ean13':
      return encodeEan13(rawValue);
    case 'upca':
      return encodeUpca(rawValue);
    default:
      return encodeCode128(rawValue);
  }
}

export function validateBarcodeSpec(
  el: DocumentElement,
  overrideValue?: string | null
): BarcodeValidationReport {
  const format: BarcodeFormat =
    el.barcodeFormat || (el.type === 'qr_code' ? 'qr' : 'code128');
  const rawVal =
    overrideValue !== undefined && overrideValue !== null
      ? overrideValue
      : el.barcodeValue || el.text || '';
  const ec = el.qrErrorCorrection || 'M';
  const quietZonePt = el.barcodeQuietZonePt ?? 6;
  const encoded = encodeBarcode(format, rawVal, ec);

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!encoded.ok) {
    errors.push(encoded.error || 'Invalid barcode payload.');
  }

  if (quietZonePt < 2) {
    errors.push(`Quiet zone (${quietZonePt}pt) is too small; minimum 2pt required (6pt recommended).`);
  } else if (quietZonePt < 6) {
    warnings.push(`Quiet zone (${quietZonePt}pt) is below recommended 6pt scanner margin.`);
  }

  const innerW = el.width - quietZonePt * 2;
  const innerH = el.height - quietZonePt * 2;
  let moduleSizePt = 0;

  if (innerW < 10 || innerH < 10) {
    errors.push('Barcode box is too small after quiet zones.');
  } else if (encoded.matrix) {
    const dim = Math.min(innerW, innerH);
    moduleSizePt = dim / encoded.matrix.size;
    if (moduleSizePt < 0.5) {
      errors.push(
        `QR module size (${moduleSizePt.toFixed(2)}pt) is below 0.5pt print scan floor. Enlarge box or shorten payload.`
      );
    } else if (moduleSizePt < 0.85) {
      warnings.push(
        `QR module size (${moduleSizePt.toFixed(2)}pt) is dense; 0.85pt+ recommended for reliable smartphone/scanner reads.`
      );
    }
  } else if (encoded.totalModules) {
    moduleSizePt = innerW / encoded.totalModules;
    if (moduleSizePt < 0.45) {
      errors.push(
        `Barcode narrow bar width (${moduleSizePt.toFixed(2)}pt) is too thin to scan. Widen box or shorten payload.`
      );
    } else if (moduleSizePt < 0.72) {
      warnings.push(
        `Barcode narrow bar width (${moduleSizePt.toFixed(2)}pt) may blur on low-DPI thermal/office printers (0.72pt+ recommended).`
      );
    }
    if (el.height < 22) {
      warnings.push('1D barcode height under 22pt can reduce handheld laser scan reliability.');
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    moduleSizePt: Number(moduleSizePt.toFixed(3)),
    quietZonePt,
    encoded,
  };
}
