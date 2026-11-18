import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRadioGroup,
  PDFRef,
  PDFString,
  PDFTextField,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { DataColumn, DataRow } from '../types/pdfStudio';

export interface PdfMetadataValues {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  pageCount: number;
}

export interface PdfBookmarkItem {
  id: string;
  title: string;
  pageNumber: number;
}

export interface AcroFormFieldSpec {
  name: string;
  kind: 'text' | 'checkbox' | 'dropdown';
  pageNumber: number;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  defaultValue?: string;
  options?: string[];
}

export interface AcroFormReadValue {
  name: string;
  kind: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'unknown';
  value: string;
}

export async function readPdfMetadata(
  bytes: Uint8Array
): Promise<PdfMetadataValues> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return {
    title: doc.getTitle() || '',
    author: doc.getAuthor() || '',
    subject: doc.getSubject() || '',
    keywords: doc.getKeywords() || '',
    creator: doc.getCreator() || '',
    producer: doc.getProducer() || '',
    pageCount: doc.getPageCount(),
  };
}

export async function writeOrScrubPdfMetadata(
  bytes: Uint8Array,
  meta: Partial<PdfMetadataValues>,
  scrubAll = false
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (scrubAll) {
    doc.setTitle('');
    doc.setAuthor('');
    doc.setSubject('');
    doc.setKeywords([]);
    doc.setCreator('');
    doc.setProducer('');
    try {
      doc.catalog.delete(PDFName.of('Metadata'));
      const infoRef = doc.context.trailerInfo.Info;
      if (infoRef instanceof PDFRef) {
        const infoDict = doc.context.lookup(infoRef);
        if (infoDict instanceof PDFDict) {
          for (const k of infoDict.keys()) {
            infoDict.delete(k);
          }
        }
      }
    } catch {
      // Safe fallback
    }
  } else {
    if (meta.title !== undefined) doc.setTitle(meta.title);
    if (meta.author !== undefined) doc.setAuthor(meta.author);
    if (meta.subject !== undefined) doc.setSubject(meta.subject);
    if (meta.keywords !== undefined) {
      doc.setKeywords(
        meta.keywords
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      );
    }
    if (meta.creator !== undefined) doc.setCreator(meta.creator);
    if (meta.producer !== undefined) doc.setProducer(meta.producer);
  }
  return await doc.save({ useObjectStreams: true });
}

export async function readPdfBookmarks(
  bytes: Uint8Array
): Promise<PdfBookmarkItem[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  const pageRefToNum = new Map<string, number>();
  pages.forEach((p, idx) => {
    pageRefToNum.set(p.ref.toString(), idx + 1);
  });

  const outlinesRef = doc.catalog.get(PDFName.of('Outlines'));
  if (!outlinesRef) return [];
  const outlinesDict = doc.context.lookup(outlinesRef);
  if (!(outlinesDict instanceof PDFDict)) return [];

  const result: PdfBookmarkItem[] = [];
  const firstRef = outlinesDict.get(PDFName.of('First'));
  let cursor: PDFRef | undefined =
    firstRef instanceof PDFRef ? firstRef : undefined;
  let guard = 0;

  while (cursor && guard < 500) {
    guard++;
    const item = doc.context.lookup(cursor);
    if (!(item instanceof PDFDict)) break;
    const rawTitle = item.get(PDFName.of('Title'));
    let title = 'Bookmark';
    if (rawTitle instanceof PDFString || rawTitle instanceof PDFHexString) {
      title = rawTitle.decodeText();
    }
    let pageNumber = 1;
    const dest = item.get(PDFName.of('Dest'));
    if (dest instanceof PDFArray && dest.size() > 0) {
      const target = dest.get(0);
      if (target instanceof PDFRef && pageRefToNum.has(target.toString())) {
        pageNumber = pageRefToNum.get(target.toString())!;
      }
    }
    result.push({
      id: `bm-${guard}`,
      title,
      pageNumber,
    });
    const nextRef = item.get(PDFName.of('Next'));
    cursor = nextRef instanceof PDFRef ? nextRef : undefined;
  }

  return result;
}

export async function writePdfBookmarks(
  bytes: Uint8Array,
  bookmarks: PdfBookmarkItem[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();

  if (bookmarks.length === 0) {
    doc.catalog.delete(PDFName.of('Outlines'));
    return await doc.save({ useObjectStreams: true });
  }

  const context = doc.context;
  const outlinesDict = context.obj({
    Type: PDFName.of('Outlines'),
    Count: PDFNumber.of(bookmarks.length),
  });
  const outlinesRef = context.register(outlinesDict);

  const itemRefs: PDFRef[] = [];
  const itemDicts: PDFDict[] = [];

  for (const bm of bookmarks) {
    const safePageIdx = Math.max(
      0,
      Math.min(pages.length - 1, Math.round(bm.pageNumber) - 1)
    );
    const pageRef = pages[safePageIdx].ref;
    const itemDict = context.obj({
      Title: PDFString.of(bm.title || `Page ${safePageIdx + 1}`),
      Parent: outlinesRef,
      Dest: context.obj([pageRef, PDFName.of('Fit')]),
    });
    const ref = context.register(itemDict);
    itemRefs.push(ref);
    itemDicts.push(itemDict);
  }

  for (let i = 0; i < itemDicts.length; i++) {
    if (i > 0) itemDicts[i].set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < itemDicts.length - 1) itemDicts[i].set(PDFName.of('Next'), itemRefs[i + 1]);
  }

  outlinesDict.set(PDFName.of('First'), itemRefs[0]);
  outlinesDict.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]);
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);

  return await doc.save({ useObjectStreams: true });
}

export async function splitOrExtractPdfPages(
  bytes: Uint8Array,
  pageNumbers1Based: number[]
): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const total = src.getPageCount();
  const validIndices = pageNumbers1Based
    .map((n) => Math.trunc(n) - 1)
    .filter((i) => i >= 0 && i < total);
  if (validIndices.length === 0) {
    throw new Error('No valid page indices selected for extraction.');
  }
  const copied = await out.copyPages(src, validIndices);
  copied.forEach((p) => out.addPage(p));
  return await out.save({ useObjectStreams: true });
}

export async function mergePdfByteArrays(
  buffers: Uint8Array[]
): Promise<Uint8Array> {
  if (buffers.length === 0) {
    throw new Error('Provide at least one PDF to merge.');
  }
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return await out.save({ useObjectStreams: true });
}

export async function repairAndOptimizePdf(
  bytes: Uint8Array,
  useObjectStreams = true
): Promise<{
  bytes: Uint8Array;
  originalSize: number;
  optimizedSize: number;
  pageCount: number;
}> {
  const src = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, src.getPageIndices());
  copied.forEach((p) => out.addPage(p));
  const saved = await out.save({ useObjectStreams });
  return {
    bytes: saved,
    originalSize: bytes.byteLength,
    optimizedSize: saved.byteLength,
    pageCount: out.getPageCount(),
  };
}

export async function addAcroFormFieldsToPdf(
  bytes: Uint8Array,
  fields: AcroFormFieldSpec[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const pages = doc.getPages();

  for (const f of fields) {
    const pageIdx = Math.max(0, Math.min(pages.length - 1, f.pageNumber - 1));
    const page = pages[pageIdx];
    const { height } = page.getSize();
    const yBottom = Math.max(0, height - f.yPt - f.heightPt);

    if (f.kind === 'checkbox') {
      const cb = form.createCheckBox(f.name);
      cb.addToPage(page, {
        x: f.xPt,
        y: yBottom,
        width: Math.max(10, f.widthPt),
        height: Math.max(10, f.heightPt),
      });
      if (f.defaultValue === 'true' || f.defaultValue === 'checked') {
        cb.check();
      }
    } else if (f.kind === 'dropdown') {
      const dd = form.createDropdown(f.name);
      const opts = f.options && f.options.length > 0 ? f.options : ['Option A', 'Option B'];
      dd.addOptions(opts);
      if (f.defaultValue && opts.includes(f.defaultValue)) {
        dd.select(f.defaultValue);
      }
      dd.addToPage(page, {
        x: f.xPt,
        y: yBottom,
        width: Math.max(40, f.widthPt),
        height: Math.max(14, f.heightPt),
      });
    } else {
      const tf = form.createTextField(f.name);
      if (f.defaultValue) tf.setText(f.defaultValue);
      tf.addToPage(page, {
        x: f.xPt,
        y: yBottom,
        width: Math.max(40, f.widthPt),
        height: Math.max(14, f.heightPt),
      });
    }
  }

  return await doc.save({ useObjectStreams: true });
}

export async function readAcroFormValues(
  bytes: Uint8Array
): Promise<AcroFormReadValue[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const fields = form.getFields();

  return fields.map((f) => {
    const name = f.getName();
    if (f instanceof PDFTextField) {
      return { name, kind: 'text', value: f.getText() || '' };
    }
    if (f instanceof PDFCheckBox) {
      return { name, kind: 'checkbox', value: f.isChecked() ? 'checked' : 'unchecked' };
    }
    if (f instanceof PDFDropdown) {
      return { name, kind: 'dropdown', value: f.getSelected().join(', ') };
    }
    if (f instanceof PDFRadioGroup) {
      return { name, kind: 'radio', value: f.getSelected() || '' };
    }
    return { name, kind: 'unknown', value: '' };
  });
}

export async function applyPdfA1bXmpMetadata(
  bytes: Uint8Array,
  info: { title?: string; author?: string } = {}
): Promise<{
  bytes: Uint8Array;
  unembeddedFonts: string[];
  hasXmpStream: boolean;
  complianceNote: string;
}> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const unembeddedFonts: string[] = [];

  for (const page of doc.getPages()) {
    const resources = page.node.lookupMaybe(PDFName.of('Resources'), PDFDict);
    const fontDict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
    if (!fontDict) continue;
    for (const key of fontDict.keys()) {
      const fontObj = fontDict.lookupMaybe(key, PDFDict);
      if (!fontObj) continue;
      const baseFont = fontObj.get(PDFName.of('BaseFont'));
      const baseName = baseFont ? String(baseFont).replace(/^\//, '') : String(key);
      const descriptor = fontObj.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      const hasEmbeddedStream =
        descriptor &&
        (descriptor.has(PDFName.of('FontFile')) ||
          descriptor.has(PDFName.of('FontFile2')) ||
          descriptor.has(PDFName.of('FontFile3')));
      if (!hasEmbeddedStream && !unembeddedFonts.includes(baseName)) {
        unembeddedFonts.push(baseName);
      }
    }
  }

  const title = (info.title || doc.getTitle() || 'PDF Studio Document').replace(/[<>&]/g, '');
  const author = (info.author || doc.getAuthor() || 'PDF Studio AI').replace(/[<>&]/g, '');
  const xmp = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>1</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${author}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

  const xmpBytes = new TextEncoder().encode(xmp);
  const metadataStream = doc.context.stream(xmpBytes, {
    Type: PDFName.of('Metadata'),
    Subtype: PDFName.of('XML'),
  });
  const metaRef = doc.context.register(metadataStream);
  doc.catalog.set(PDFName.of('Metadata'), metaRef);

  const saved = await doc.save({ useObjectStreams: false });
  const complianceNote =
    unembeddedFonts.length > 0
      ? `PDF/A-1b XMP metadata embedded, but ${unembeddedFonts.length} standard/unembedded font(s) (${unembeddedFonts.join(', ')}) remain unembedded. Embed custom TTF/OTF fonts for strict archival validation.`
      : 'PDF/A-1b XMP metadata stream attached and all page fonts are embedded.';

  return {
    bytes: saved,
    unembeddedFonts,
    hasXmpStream: true,
    complianceNote,
  };
}

export async function buildSearchableOcrPdfFromPages(
  pages: Array<{
    imageDataUrl: string;
    widthPt: number;
    heightPt: number;
    ocrWords: Array<{ text: string; x: number; y: number; width: number; height: number }>;
  }>
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const pg of pages) {
    const page = doc.addPage([pg.widthPt, pg.heightPt]);
    const cleanB64 = pg.imageDataUrl.replace(/^data:image\/[\w+.-]+;base64,/i, '');
    const rawBytes =
      typeof globalThis.Buffer !== 'undefined'
        ? new Uint8Array(globalThis.Buffer.from(cleanB64, 'base64'))
        : Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0));
    const isPng = /^data:image\/png/i.test(pg.imageDataUrl);
    const embeddedImg = isPng ? await doc.embedPng(rawBytes) : await doc.embedJpg(rawBytes);

    page.drawImage(embeddedImg, {
      x: 0,
      y: 0,
      width: pg.widthPt,
      height: pg.heightPt,
    });

    for (const word of pg.ocrWords) {
      if (!word.text.trim()) continue;
      const fontSize = Math.max(5, Math.min(48, word.height * 0.85));
      const yBottom = Math.max(0, pg.heightPt - word.y - fontSize);
      try {
        page.drawText(word.text, {
          x: Math.max(0, word.x),
          y: yBottom,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
          opacity: 0,
        });
      } catch {
        // Skip unsupported OCR glyphs safely
      }
    }
  }

  return await doc.save({ useObjectStreams: true });
}

export async function convertStructuredRowsToPdf(
  title: string,
  columns: DataColumn[],
  rows: DataRow[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 36;
  const colNames = columns.map((c) => c.name);
  const colCount = Math.max(1, colNames.length);
  const colW = (pageW - margin * 2) / colCount;

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  page.drawText(title || 'Structured Dataset Export', {
    x: margin,
    y: y - 14,
    size: 14,
    font: bold,
    color: rgb(0.06, 0.06, 0.06),
  });
  y -= 32;

  const drawHeader = () => {
    page.drawRectangle({
      x: margin,
      y: y - 18,
      width: pageW - margin * 2,
      height: 18,
      color: rgb(0.93, 0.93, 0.95),
    });
    colNames.forEach((name, idx) => {
      page.drawText(name.slice(0, 18), {
        x: margin + idx * colW + 4,
        y: y - 13,
        size: 8.5,
        font: bold,
        color: rgb(0.08, 0.08, 0.08),
      });
    });
    y -= 20;
  };

  drawHeader();

  for (const row of rows) {
    if (y < margin + 24) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
      drawHeader();
    }
    colNames.forEach((name, idx) => {
      const cell = String(row[name] ?? '').slice(0, 22);
      page.drawText(cell, {
        x: margin + idx * colW + 4,
        y: y - 12,
        size: 8,
        font: regular,
        color: rgb(0.15, 0.15, 0.15),
      });
    });
    page.drawLine({
      start: { x: margin, y: y - 16 },
      end: { x: pageW - margin, y: y - 16 },
      thickness: 0.4,
      color: rgb(0.84, 0.84, 0.88),
    });
    y -= 17;
  }

  return await doc.save({ useObjectStreams: true });
}

export async function convertMarkdownToPdf(
  title: string,
  markdownText: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 48;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  page.drawText(title || 'Document Conversion', {
    x: margin,
    y: y - 16,
    size: 16,
    font: bold,
    color: rgb(0.05, 0.05, 0.05),
  });
  y -= 34;

  const lines = markdownText.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd();
    const isH1 = trimmed.startsWith('# ');
    const isH2 = trimmed.startsWith('## ');
    const clean = trimmed.replace(/^#{1,3}\s+/, '').replace(/\*\*/g, '');
    const fontSize = isH1 ? 13 : isH2 ? 11 : 9.5;
    const usedFont = isH1 || isH2 ? bold : regular;
    const step = fontSize * 1.45;

    if (y - step < margin) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }

    if (clean) {
      page.drawText(clean.slice(0, 95), {
        x: margin,
        y: y - fontSize,
        size: fontSize,
        font: usedFont,
        color: rgb(0.1, 0.1, 0.1),
      });
    }
    y -= clean ? step : 8;
  }

  return await doc.save({ useObjectStreams: true });
}
