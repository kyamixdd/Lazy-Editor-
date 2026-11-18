import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  AssetFontItem,
  DocumentIntegrityPassport,
  PDFProject,
} from '../types/pdfStudio';
import {
  analyzeSerialIntelligence,
  formatSerialNumber,
} from './serialEngine';
import { computeTemplateDna } from './templateProfileEngine';
import { validateProject } from './validationEngine';

// Deterministic pure-JS SHA-256 fallback for environments without crypto.subtle
function sha256FallbackHex(bytes: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const rotr = (v: number, n: number) => (v >>> n) | (v << (32 - n));
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H)
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
      const copy = new Uint8Array(bytes);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback below
  }
  return sha256FallbackHex(bytes);
}

export async function createDocumentIntegrityPassport(
  project: PDFProject,
  meta: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    verifiedPageCount?: number;
    verifiedWidthPt?: number;
    verifiedHeightPt?: number;
    customFonts?: AssetFontItem[];
  }
): Promise<DocumentIntegrityPassport> {
  const sha256Hex = await computeSha256Hex(meta.bytes);
  const dna = computeTemplateDna(project);
  const issues = validateProject(project, meta.customFonts || []);
  const errorsCount = issues.filter((i) => i.severity === 'error').length;
  const warningsCount = issues.filter((i) => i.severity === 'warning').length;

  const isBpMode = Boolean(project.useBlueprintLayout && project.activeBlueprint);
  const copiesPerPage = isBpMode && project.activeBlueprint
    ? Math.max(1, project.activeBlueprint.blocks.filter((b) => b.visible).length)
    : project.copiesConfig.enabled
    ? Math.max(1, project.copiesConfig.columns * project.copiesConfig.rows)
    : 1;

  const totalOutputPages =
    meta.verifiedPageCount ??
    (project.bulkConfig.enabled || project.copiesConfig.enabled || isBpMode
      ? Math.max(1, project.bulkConfig.totalOutputPages)
      : Math.max(1, project.pageCount));

  const serialIntel = analyzeSerialIntelligence(
    project.serialRules,
    totalOutputPages,
    copiesPerPage,
    project.dataRows,
    []
  );
  const serialSpans = serialIntel.ruleSpans.map((span) => {
    const matchedRule = project.serialRules.find((r) => r.id === span.ruleId);
    const firstValue =
      span.firstNumber !== null && matchedRule
        ? formatSerialNumber(span.firstNumber, matchedRule)
        : String(span.firstNumber ?? '-');
    const lastValue =
      span.lastNumber !== null && matchedRule
        ? formatSerialNumber(span.lastNumber, matchedRule)
        : String(span.lastNumber ?? '-');
    return {
      ruleName: span.ruleName,
      fieldKey: span.fieldKey,
      firstValue,
      lastValue,
      count: span.generatedCount,
    };
  });

  const embeddedFonts = Array.from(
    new Set(project.elements.map((e) => e.fontFamily).filter(Boolean))
  );

  const numberingConflictsCount = serialIntel.conflicts.length;
  const validationStatus: DocumentIntegrityPassport['validationStatus'] =
    errorsCount > 0 || serialIntel.hasCriticalConflicts
      ? 'failed'
      : warningsCount > 0 || numberingConflictsCount > 0
      ? 'warnings'
      : 'verified';

  return {
    id: `pass-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: project.id,
    projectName: project.name,
    createdAt: new Date().toISOString(),
    fileName: meta.fileName,
    mimeType: meta.mimeType,
    sha256Hex,
    fileSizeBytes: meta.bytes.byteLength,
    templateDnaHash: dna.fingerprintHash,
    totalOutputPages,
    copiesPerPage,
    totalRecords: totalOutputPages * copiesPerPage,
    documentBlocksCount: isBpMode && project.activeBlueprint
      ? project.activeBlueprint.blocks.filter((b) => b.visible).length
      : Math.max(1, project.bulkConfig.documentBlocksCount),
    serialSpans,
    numberingConflictsCount,
    preflightErrorsCount: errorsCount,
    preflightWarningsCount: warningsCount,
    outputWidthPt:
      meta.verifiedWidthPt ??
      (isBpMode && project.activeBlueprint
        ? project.activeBlueprint.sheetWidthPt
        : project.pageConfig.widthPt),
    outputHeightPt:
      meta.verifiedHeightPt ??
      (isBpMode && project.activeBlueprint
        ? project.activeBlueprint.sheetHeightPt
        : project.pageConfig.heightPt),
    dpi: project.exportConfig.dpi,
    bleedPt: project.exportConfig.bleedPt || project.pageConfig.bleedPt || 0,
    cropMarks: Boolean(project.exportConfig.cropMarks || project.pageConfig.cropMarks),
    duplexEnabled: Boolean(project.printOptimization?.duplexEnabled),
    validationStatus,
    embeddedFonts,
  };
}

export function buildPassportCsv(passport: DocumentIntegrityPassport): string {
  const esc = (v: string | number | boolean) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`;

  const lines: string[] = [
    ['Field', 'Value'].map(esc).join(','),
    ['Passport ID', passport.id].map(esc).join(','),
    ['Project Name', passport.projectName].map(esc).join(','),
    ['Generated File', passport.fileName].map(esc).join(','),
    ['Timestamp', passport.createdAt].map(esc).join(','),
    ['Validation Status', passport.validationStatus.toUpperCase()].map(esc).join(','),
    ['SHA-256 Digest', passport.sha256Hex].map(esc).join(','),
    ['Template DNA Hash', passport.templateDnaHash].map(esc).join(','),
    ['File Size (Bytes)', passport.fileSizeBytes].map(esc).join(','),
    ['Total Output Pages', passport.totalOutputPages].map(esc).join(','),
    ['Copies Per Page', passport.copiesPerPage].map(esc).join(','),
    ['Total Records', passport.totalRecords].map(esc).join(','),
    ['Output Dimensions (pt)', `${passport.outputWidthPt} x ${passport.outputHeightPt}`].map(esc).join(','),
    ['DPI', passport.dpi].map(esc).join(','),
    ['Bleed (pt)', passport.bleedPt].map(esc).join(','),
    ['Crop Marks', passport.cropMarks].map(esc).join(','),
    ['Duplex Mode', passport.duplexEnabled].map(esc).join(','),
    ['Preflight Errors', passport.preflightErrorsCount].map(esc).join(','),
    ['Preflight Warnings', passport.preflightWarningsCount].map(esc).join(','),
    ['Numbering Conflicts', passport.numberingConflictsCount].map(esc).join(','),
    ['Fonts Used', passport.embeddedFonts.join('; ')].map(esc).join(','),
    '',
    ['Rule Name', 'Field Key', 'First Serial', 'Last Serial', 'Count'].map(esc).join(','),
    ...passport.serialSpans.map((s) =>
      [s.ruleName, s.fieldKey, s.firstValue, s.lastValue, s.count].map(esc).join(',')
    ),
  ];

  return lines.join('\n');
}

export async function generatePassportPdfBytes(
  passport: DocumentIntegrityPassport
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 Portrait
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  let y = 795;
  page.drawText('DOCUMENT INTEGRITY PASSPORT', {
    x: 44,
    y,
    size: 16,
    font: bold,
    color: rgb(0.06, 0.06, 0.06),
  });
  y -= 16;
  page.drawText(`Certificate ${passport.id} · Issued ${new Date(passport.createdAt).toLocaleString()}`, {
    x: 44,
    y,
    size: 8.5,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });
  y -= 14;
  page.drawLine({
    start: { x: 44, y },
    end: { x: 551, y },
    thickness: 1,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 22;

  const drawRow = (label: string, val: string, isMono = false) => {
    page.drawText(label, {
      x: 44,
      y,
      size: 9,
      font: bold,
      color: rgb(0.25, 0.25, 0.25),
    });
    page.drawText(val.slice(0, 74), {
      x: 195,
      y,
      size: 9,
      font: isMono ? mono : font,
      color: rgb(0.08, 0.08, 0.08),
    });
    y -= 16;
  };

  drawRow('Verification Status', passport.validationStatus.toUpperCase());
  drawRow('Project Name', passport.projectName);
  drawRow('Output Filename', passport.fileName);
  drawRow('File Size', `${(passport.fileSizeBytes / 1024).toFixed(1)} KB (${passport.fileSizeBytes} bytes)`);
  drawRow('SHA-256 Digest', passport.sha256Hex, true);
  drawRow('Template DNA Hash', passport.templateDnaHash, true);
  drawRow(
    'Production Sheet',
    `${passport.outputWidthPt.toFixed(1)} × ${passport.outputHeightPt.toFixed(1)} pt · ${passport.dpi} DPI · Bleed ${passport.bleedPt}pt`
  );
  drawRow(
    'Volume',
    `${passport.totalOutputPages} pages · ${passport.copiesPerPage} copies/sheet · ${passport.totalRecords} total records`
  );
  drawRow(
    'Pre-Flight Audit',
    `${passport.preflightErrorsCount} errors · ${passport.preflightWarningsCount} warnings · ${passport.numberingConflictsCount} numbering conflicts`
  );
  drawRow(
    'Print Options',
    `Crop marks: ${passport.cropMarks ? 'Yes' : 'No'} · Duplex: ${passport.duplexEnabled ? 'Enabled' : 'Simplex'}`
  );
  drawRow('Typography', passport.embeddedFonts.join(', ') || 'Helvetica');

  y -= 10;
  page.drawText('SERIAL NUMBERING RANGES', {
    x: 44,
    y,
    size: 11,
    font: bold,
    color: rgb(0.06, 0.06, 0.06),
  });
  y -= 14;

  if (passport.serialSpans.length === 0) {
    page.drawText('No dynamic serial sequences attached to this export.', {
      x: 44,
      y,
      size: 8.5,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
  } else {
    for (const s of passport.serialSpans.slice(0, 18)) {
      page.drawText(`${s.ruleName} (${s.fieldKey})`, {
        x: 44,
        y,
        size: 8.5,
        font: bold,
        color: rgb(0.15, 0.15, 0.15),
      });
      page.drawText(`${s.firstValue} -> ${s.lastValue}  (${s.count} slots)`, {
        x: 245,
        y,
        size: 8.5,
        font: mono,
        color: rgb(0.08, 0.08, 0.08),
      });
      y -= 14;
    }
  }

  return doc.save();
}
