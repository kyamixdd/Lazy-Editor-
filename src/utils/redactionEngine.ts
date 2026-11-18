import * as pdfjsLib from 'pdfjs-dist';
import { DocumentElement, PDFProject, RectPt } from '../types/pdfStudio';

function rectsIntersect(a: RectPt, b: RectPt, pad = 1): boolean {
  return !(
    a.x + a.width < b.x - pad ||
    a.x > b.x + b.width + pad ||
    a.y + a.height < b.y - pad ||
    a.y > b.y + b.height + pad
  );
}

export interface RedactionSummary {
  pendingCount: number;
  appliedZoneCount: number;
  affectedPages: number[];
  overlappingTextStrings: string[];
}

export function inspectPendingRedactions(
  project: PDFProject,
  pageNumber?: number
): RedactionSummary {
  const redactionEls = project.elements.filter(
    (e) =>
      e.type === 'redaction' &&
      e.visible &&
      !e.redactionApplied &&
      (pageNumber === undefined || e.pageNumber === pageNumber)
  );

  const affectedPages = Array.from(new Set(redactionEls.map((r) => r.pageNumber))).sort(
    (a, b) => a - b
  );

  const overlappingTextStrings: string[] = [];
  for (const r of redactionEls) {
    const rRect: RectPt = { x: r.x, y: r.y, width: r.width, height: r.height };
    for (const el of project.elements) {
      if (el.id === r.id || el.pageNumber !== r.pageNumber || el.type === 'redaction') {
        continue;
      }
      if (rectsIntersect(rRect, el, 2) && el.text?.trim()) {
        overlappingTextStrings.push(el.text.trim());
      }
    }
  }

  const appliedZoneCount = project.originalPages.reduce(
    (sum, p) => sum + (p.appliedRedactions?.length || 0),
    0
  );

  return {
    pendingCount: redactionEls.length,
    appliedZoneCount,
    affectedPages,
    overlappingTextStrings: Array.from(new Set(overlappingTextStrings)),
  };
}

/**
 * Permanently applies marked redactions to project metadata:
 * 1. Records applied redaction rectangles onto OriginalPageMeta.appliedRedactions so exporter sanitizes background PDF pages.
 * 2. Strips/deletes overlapping DocumentElements from project.elements so redacted text does not remain in layout JSON or overlay exports.
 * 3. Marks the redaction overlay itself as `redactionApplied: true, redactionMode: 'true_redaction', locked: true`.
 */
export function applyTrueRedactionsToProject(
  project: PDFProject,
  targetPageNumber?: number
): {
  updatedProject: PDFProject;
  removedElementCount: number;
  appliedRedactionCount: number;
} {
  const pendingRedactions = project.elements.filter(
    (e) =>
      e.type === 'redaction' &&
      e.visible &&
      !e.redactionApplied &&
      (targetPageNumber === undefined || e.pageNumber === targetPageNumber)
  );

  if (pendingRedactions.length === 0) {
    return {
      updatedProject: project,
      removedElementCount: 0,
      appliedRedactionCount: 0,
    };
  }

  const redactionsByPage = new Map<number, RectPt[]>();
  for (const r of pendingRedactions) {
    const list = redactionsByPage.get(r.pageNumber) || [];
    list.push({ x: r.x, y: r.y, width: r.width, height: r.height });
    redactionsByPage.set(r.pageNumber, list);
  }

  const updatedOriginalPages = project.originalPages.map((pg) => {
    const newRects = redactionsByPage.get(pg.pageNumber);
    if (!newRects || newRects.length === 0) return pg;
    return {
      ...pg,
      appliedRedactions: [...(pg.appliedRedactions || []), ...newRects],
    };
  });

  let removedElementCount = 0;
  const nextElements: DocumentElement[] = [];

  for (const el of project.elements) {
    if (el.type === 'redaction') {
      const wasPending = pendingRedactions.some((p) => p.id === el.id);
      if (wasPending) {
        nextElements.push({
          ...el,
          redactionMode: 'true_redaction',
          redactionApplied: true,
          locked: true,
          backgroundColor: '#000000',
          color: '#FFFFFF',
          text: el.text || 'REDACTED',
        });
      } else {
        nextElements.push(el);
      }
      continue;
    }

    const pageRects = redactionsByPage.get(el.pageNumber);
    if (pageRects && pageRects.some((rr) => rectsIntersect(rr, el, 1))) {
      removedElementCount++;
      continue; // Strip overlapping editable element permanently
    }
    nextElements.push(el);
  }

  return {
    updatedProject: {
      ...project,
      originalPages: updatedOriginalPages,
      elements: nextElements,
      updatedAt: new Date().toISOString(),
    },
    removedElementCount,
    appliedRedactionCount: pendingRedactions.length,
  };
}

/**
 * Renders a sanitized background PNG byte buffer for a page with true redactions baked in.
 * Painting opaque black over redacted zones on a rasterized print-DPI image ensures zero underlying
 * PDF text glyphs or vector paths survive under redacted boxes in the exported PDF.
 */
export async function renderSanitizedRedactedPagePng(
  sourceDataUrlOrBase64Pdf: {
    pdfBase64?: string;
    pageImageDataUrl?: string;
    pageNumber: number;
    pageWidthPt: number;
    pageHeightPt: number;
    redactions: RectPt[];
    scale?: number;
  }
): Promise<Uint8Array | null> {
  const {
    pdfBase64,
    pageImageDataUrl,
    pageNumber,
    pageWidthPt,
    pageHeightPt,
    redactions,
    scale = 2.4,
  } = sourceDataUrlOrBase64Pdf;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(pageWidthPt * scale));
  canvas.height = Math.max(4, Math.round(pageHeightPt * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let rendered = false;
  if (pageImageDataUrl) {
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = pageImageDataUrl;
      });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      rendered = true;
    } catch {
      rendered = false;
    }
  }

  if (!rendered && pdfBase64) {
    try {
      const bin = atob(pdfBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const clamped = Math.max(1, Math.min(pageNumber, pdf.numPages));
      const page = await pdf.getPage(clamped);
      const vp = page.getViewport({ scale });
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      rendered = true;
    } catch {
      rendered = false;
    }
  }

  const sx = canvas.width / Math.max(1, pageWidthPt);
  const sy = canvas.height / Math.max(1, pageHeightPt);
  ctx.fillStyle = '#000000';
  for (const r of redactions) {
    ctx.fillRect(
      Math.max(0, r.x * sx - 1),
      Math.max(0, r.y * sy - 1),
      r.width * sx + 2,
      r.height * sy + 2
    );
  }

  const dataUrl = canvas.toDataURL('image/png');
  canvas.width = 0;
  canvas.height = 0;
  const raw = atob(dataUrl.replace(/^data:image\/png;base64,/, ''));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Verifies exported PDF bytes using PDF.js text extraction to ensure redacted strings
 * cannot be extracted or copied from the generated document.
 */
export async function verifyPdfBytesRedactionClean(
  pdfBytes: Uint8Array,
  redactedStrings: string[]
): Promise<{
  clean: boolean;
  foundLeaks: string[];
  extractedCharCount: number;
}> {
  const cleanTerms = redactedStrings
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
  let allText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageStr = tc.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    allText += ` ${pageStr}`;
  }
  const normalized = allText.toLowerCase();
  const foundLeaks = cleanTerms.filter((term) =>
    normalized.includes(term.toLowerCase())
  );

  return {
    clean: foundLeaks.length === 0,
    foundLeaks,
    extractedCharCount: allText.trim().length,
  };
}
