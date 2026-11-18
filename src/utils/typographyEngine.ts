import { DocumentElement } from '../types/pdfStudio';

export interface WrappedTextLine {
  text: string;
  paragraphIndex: number;
  widthPt: number;
}

export interface TypographyLayoutResult {
  effectiveFontSize: number;
  lines: WrappedTextLine[];
  lineHeightPt: number;
  paragraphSpacingPt: number;
  totalTextWidthPt: number;
  totalTextHeightPt: number;
  contentBoxWidthPt: number;
  contentBoxHeightPt: number;
  verticalOffsetPt: number;
  isOverflowingX: boolean;
  isOverflowingY: boolean;
  isClipped: boolean;
}

let cachedMeasureCtx: CanvasRenderingContext2D | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!cachedMeasureCtx) {
    const canvas = document.createElement('canvas');
    cachedMeasureCtx = canvas.getContext('2d');
  }
  return cachedMeasureCtx;
}

export function resolveCanvasFontString(
  el: Pick<DocumentElement, 'fontFamily' | 'fontWeight' | 'fontStyle'>,
  fontSizePt: number
): string {
  const weight = el.fontWeight === 'bold' ? '700' : '400';
  const style = el.fontStyle === 'italic' ? 'italic' : 'normal';
  const fam = el.fontFamily || 'Helvetica';
  const mappedFam =
    fam === 'Times-Roman' || fam === 'Times'
      ? 'Georgia, "Times New Roman", serif'
      : fam === 'Courier'
      ? '"JetBrains Mono", "Courier New", monospace'
      : fam === 'Helvetica' || fam === 'Helvetica-Bold'
      ? '"DM Sans", Arial, Helvetica, sans-serif'
      : `"${fam}", "DM Sans", sans-serif`;
  return `${style} ${weight} ${fontSizePt}px ${mappedFam}`;
}

export function measureLineWidthPt(
  line: string,
  el: Pick<DocumentElement, 'fontFamily' | 'fontWeight' | 'fontStyle' | 'letterSpacing'>,
  fontSizePt: number
): number {
  if (!line) return 0;
  const letterSpacing = el.letterSpacing ?? 0;
  const extraTracking = Math.max(0, line.length - 1) * letterSpacing;
  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = resolveCanvasFontString(el, fontSizePt);
    return ctx.measureText(line).width + extraTracking;
  }
  const avgFactor = el.fontWeight === 'bold' ? 0.58 : 0.54;
  return line.length * fontSizePt * avgFactor + extraTracking;
}

export function wrapTextToWidth(
  text: string,
  el: Pick<
    DocumentElement,
    'fontFamily' | 'fontWeight' | 'fontStyle' | 'letterSpacing' | 'textWrap'
  >,
  fontSizePt: number,
  maxWidthPt: number
): WrappedTextLine[] {
  const paragraphs = (text || '').split(/\r?\n/);
  const shouldWrap = el.textWrap !== false && maxWidthPt > 4;
  const result: WrappedTextLine[] = [];

  paragraphs.forEach((para, pIdx) => {
    if (!para) {
      result.push({ text: '', paragraphIndex: pIdx, widthPt: 0 });
      return;
    }

    if (!shouldWrap) {
      result.push({
        text: para,
        paragraphIndex: pIdx,
        widthPt: measureLineWidthPt(para, el, fontSizePt),
      });
      return;
    }

    const words = para.split(/(\s+)/).filter((w) => w.length > 0);
    let currentLine = '';

    for (const token of words) {
      const candidate = currentLine ? `${currentLine}${token}` : token.trimStart();
      const candWidth = measureLineWidthPt(candidate, el, fontSizePt);
      if (candWidth <= maxWidthPt + 0.5 || !currentLine.trim()) {
        currentLine = candidate;
      } else {
        const trimmed = currentLine.trimEnd();
        result.push({
          text: trimmed,
          paragraphIndex: pIdx,
          widthPt: measureLineWidthPt(trimmed, el, fontSizePt),
        });
        currentLine = token.trimStart();
      }
    }

    if (currentLine.length > 0) {
      const trimmed = currentLine.trimEnd();
      result.push({
        text: trimmed,
        paragraphIndex: pIdx,
        widthPt: measureLineWidthPt(trimmed, el, fontSizePt),
      });
    }
  });

  if (result.length === 0) {
    result.push({ text: '', paragraphIndex: 0, widthPt: 0 });
  }
  return result;
}

export function computeTypographyLayout(
  el: Pick<
    DocumentElement,
    | 'text'
    | 'width'
    | 'height'
    | 'fontFamily'
    | 'fontSize'
    | 'fontWeight'
    | 'fontStyle'
    | 'letterSpacing'
    | 'lineHeight'
    | 'paragraphSpacing'
    | 'verticalAlign'
    | 'paddingPt'
    | 'textWrap'
    | 'autofit'
  >,
  overrideText?: string
): TypographyLayoutResult {
  const text = overrideText !== undefined ? overrideText : el.text;
  const paddingPt = Math.max(0, el.paddingPt ?? 1);
  const contentBoxWidthPt = Math.max(4, (el.width || 20) - paddingPt * 2);
  const contentBoxHeightPt = Math.max(4, (el.height || 14) - paddingPt * 2);
  const lineHeightRatio = Math.max(0.8, el.lineHeight ?? 1.2);
  const paragraphSpacingPt = Math.max(0, el.paragraphSpacing ?? 0);

  let effectiveFontSize = Math.max(4, el.fontSize || 11);

  const measureAtSize = (size: number) => {
    const lines = wrapTextToWidth(text, el, size, contentBoxWidthPt);
    const lineHeightPt = size * lineHeightRatio;
    let paraBreaks = 0;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].paragraphIndex !== lines[i - 1].paragraphIndex) {
        paraBreaks++;
      }
    }
    const totalTextHeightPt =
      lines.length * lineHeightPt + paraBreaks * paragraphSpacingPt;
    const totalTextWidthPt = Math.max(0, ...lines.map((l) => l.widthPt));
    return { lines, lineHeightPt, totalTextHeightPt, totalTextWidthPt };
  };

  let measured = measureAtSize(effectiveFontSize);

  if (el.autofit && (measured.totalTextHeightPt > contentBoxHeightPt || (el.textWrap === false && measured.totalTextWidthPt > contentBoxWidthPt))) {
    let low = 4;
    let high = effectiveFontSize;
    for (let iter = 0; iter < 12; iter++) {
      const mid = (low + high) / 2;
      const attempt = measureAtSize(mid);
      const fitsH = attempt.totalTextHeightPt <= contentBoxHeightPt + 0.5;
      const fitsW =
        el.textWrap !== false || attempt.totalTextWidthPt <= contentBoxWidthPt + 0.5;
      if (fitsH && fitsW) {
        low = mid;
      } else {
        high = mid;
      }
    }
    effectiveFontSize = Number(Math.max(4, low).toFixed(2));
    measured = measureAtSize(effectiveFontSize);
  }

  const isOverflowingX = measured.totalTextWidthPt > contentBoxWidthPt + 1.5;
  const isOverflowingY = measured.totalTextHeightPt > contentBoxHeightPt + 2;
  const isClipped = isOverflowingX || isOverflowingY;

  let verticalOffsetPt = paddingPt;
  const remainingH = Math.max(0, contentBoxHeightPt - measured.totalTextHeightPt);
  if (el.verticalAlign === 'middle') {
    verticalOffsetPt = paddingPt + remainingH / 2;
  } else if (el.verticalAlign === 'bottom') {
    verticalOffsetPt = paddingPt + remainingH;
  }

  return {
    effectiveFontSize,
    lines: measured.lines,
    lineHeightPt: measured.lineHeightPt,
    paragraphSpacingPt,
    totalTextWidthPt: measured.totalTextWidthPt,
    totalTextHeightPt: measured.totalTextHeightPt,
    contentBoxWidthPt,
    contentBoxHeightPt,
    verticalOffsetPt,
    isOverflowingX,
    isOverflowingY,
    isClipped,
  };
}

export function extractStylePainterPatch(
  source: DocumentElement,
  mode: 'appearance' | 'appearance_and_geometry'
): Partial<DocumentElement> {
  const appearance: Partial<DocumentElement> = {
    fontFamily: source.fontFamily,
    fontSize: source.fontSize,
    fontWeight: source.fontWeight,
    fontStyle: source.fontStyle,
    underline: source.underline,
    strikethrough: source.strikethrough,
    color: source.color,
    backgroundColor: source.backgroundColor,
    borderColor: source.borderColor,
    borderWidth: source.borderWidth,
    opacity: source.opacity,
    align: source.align,
    verticalAlign: source.verticalAlign,
    letterSpacing: source.letterSpacing,
    lineHeight: source.lineHeight,
    paragraphSpacing: source.paragraphSpacing,
    baselineOffset: source.baselineOffset,
    paddingPt: source.paddingPt,
    textWrap: source.textWrap,
    autofit: source.autofit,
  };

  if (mode === 'appearance_and_geometry') {
    return {
      ...appearance,
      width: source.width,
      height: source.height,
      rotation: source.rotation,
      lockAspectRatio: source.lockAspectRatio,
      maskShape: source.maskShape,
    };
  }

  return appearance;
}
