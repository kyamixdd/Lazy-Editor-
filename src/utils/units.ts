import {
  BulkConfig,
  CopiesPerPageConfig,
  ExportConfig,
  MeasurementUnit,
  PageConfig,
  PageOrientation,
  PageSizePreset,
  SourceFitConfig,
} from '../types/pdfStudio';

export const PAGE_PRESETS_PT: Record<
  Exclude<PageSizePreset, 'Custom'>,
  { widthPt: number; heightPt: number; label: string }
> = {
  A0: { widthPt: 2383.94, heightPt: 3370.39, label: 'A0 (841 × 1189 mm)' },
  A1: { widthPt: 1683.78, heightPt: 2383.94, label: 'A1 (594 × 841 mm)' },
  A2: { widthPt: 1190.55, heightPt: 1683.78, label: 'A2 (420 × 594 mm)' },
  A3: { widthPt: 841.89, heightPt: 1190.55, label: 'A3 (297 × 420 mm)' },
  A4: { widthPt: 595.28, heightPt: 841.89, label: 'A4 (210 × 297 mm)' },
  A5: { widthPt: 419.53, heightPt: 595.28, label: 'A5 (148 × 210 mm)' },
  A6: { widthPt: 297.64, heightPt: 419.53, label: 'A6 (105 × 148 mm)' },
  Letter: { widthPt: 612, heightPt: 792, label: 'Letter (8.5 × 11 in)' },
  Legal: { widthPt: 612, heightPt: 1008, label: 'Legal (8.5 × 14 in)' },
  Tabloid: { widthPt: 792, heightPt: 1224, label: 'Tabloid (11 × 17 in)' },
  Executive: { widthPt: 522, heightPt: 756, label: 'Executive (7.25 × 10.5 in)' },
};

export const PT_PER_INCH = 72;
export const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;

export const MIN_PAGE_DIM_PT = 14; // ~5 mm
export const MAX_PAGE_DIM_PT = 14400; // 200 in PDF specification limit

export function ptToUnit(pt: number, unit: MeasurementUnit): number {
  if (!Number.isFinite(pt)) return 0;
  switch (unit) {
    case 'pt':
      return Number(pt.toFixed(2));
    case 'in':
      return Number((pt / PT_PER_INCH).toFixed(3));
    case 'mm':
      return Number(((pt / PT_PER_INCH) * MM_PER_INCH).toFixed(2));
    case 'cm':
      return Number((((pt / PT_PER_INCH) * MM_PER_INCH) / 10).toFixed(2));
    case 'px':
      return Number(((pt / PT_PER_INCH) * PX_PER_INCH).toFixed(1));
  }
}

export function unitToPt(value: number, unit: MeasurementUnit): number {
  if (!Number.isFinite(value)) return 0;
  switch (unit) {
    case 'pt':
      return value;
    case 'in':
      return value * PT_PER_INCH;
    case 'mm':
      return (value / MM_PER_INCH) * PT_PER_INCH;
    case 'cm':
      return ((value * 10) / MM_PER_INCH) * PT_PER_INCH;
    case 'px':
      return (value / PX_PER_INCH) * PT_PER_INCH;
  }
}

export function formatMeasurement(pt: number, unit: MeasurementUnit): string {
  const converted = ptToUnit(pt, unit);
  return `${converted} ${unit}`;
}

export function getPresetDimensions(
  preset: PageSizePreset,
  orientation: PageOrientation,
  customWidthPt = 595.28,
  customHeightPt = 841.89
): { widthPt: number; heightPt: number } {
  const base =
    preset === 'Custom'
      ? { widthPt: customWidthPt, heightPt: customHeightPt }
      : PAGE_PRESETS_PT[preset];
  if (orientation === 'custom') {
    return {
      widthPt: Number(base.widthPt.toFixed(2)),
      heightPt: Number(base.heightPt.toFixed(2)),
    };
  }
  const minSide = Math.min(base.widthPt, base.heightPt);
  const maxSide = Math.max(base.widthPt, base.heightPt);
  return orientation === 'portrait'
    ? { widthPt: Number(minSide.toFixed(2)), heightPt: Number(maxSide.toFixed(2)) }
    : { widthPt: Number(maxSide.toFixed(2)), heightPt: Number(minSide.toFixed(2)) };
}

/**
 * Intelligently updates orientation without losing custom dimensions.
 * Portrait enforces width <= height by swapping if needed;
 * Landscape enforces width >= height by swapping if needed;
 * Custom preserves exact user width & height freely.
 */
export function applyOrientationChange(
  current: Pick<PageConfig, 'widthPt' | 'heightPt' | 'orientation'>,
  nextOrientation: PageOrientation
): { widthPt: number; heightPt: number; orientation: PageOrientation } {
  const w = current.widthPt;
  const h = current.heightPt;
  if (nextOrientation === 'custom') {
    return { widthPt: w, heightPt: h, orientation: 'custom' };
  }
  if (nextOrientation === 'portrait') {
    return w > h
      ? { widthPt: h, heightPt: w, orientation: 'portrait' }
      : { widthPt: w, heightPt: h, orientation: 'portrait' };
  }
  // landscape
  return h > w
    ? { widthPt: h, heightPt: w, orientation: 'landscape' }
    : { widthPt: w, heightPt: h, orientation: 'landscape' };
}

export function validatePageConfigDimensions(config: {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  marginRightPt: number;
  bleedPt?: number;
}): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(config.widthPt) || !Number.isFinite(config.heightPt)) {
    errors.push('Page width and height must be valid numbers.');
  } else {
    if (config.widthPt < MIN_PAGE_DIM_PT || config.heightPt < MIN_PAGE_DIM_PT) {
      errors.push(
        `Page dimensions must be at least ${MIN_PAGE_DIM_PT} pt (~5 mm).`
      );
    }
    if (config.widthPt > MAX_PAGE_DIM_PT || config.heightPt > MAX_PAGE_DIM_PT) {
      errors.push(
        `Page dimensions cannot exceed ${MAX_PAGE_DIM_PT} pt (200 in PDF specification limit).`
      );
    }
  }

  if (
    config.marginLeftPt < 0 ||
    config.marginRightPt < 0 ||
    config.marginTopPt < 0 ||
    config.marginBottomPt < 0
  ) {
    errors.push('Margins cannot be negative.');
  }

  if (
    Number.isFinite(config.widthPt) &&
    config.marginLeftPt + config.marginRightPt >= config.widthPt
  ) {
    errors.push('Left + Right margins exceed or equal the page width.');
  }
  if (
    Number.isFinite(config.heightPt) &&
    config.marginTopPt + config.marginBottomPt >= config.heightPt
  ) {
    errors.push('Top + Bottom margins exceed or equal the page height.');
  }

  if ((config.bleedPt || 0) < 0) {
    errors.push('Bleed cannot be negative.');
  } else if ((config.bleedPt || 0) > 144) {
    warnings.push('Bleed exceeds 2 in (144 pt); verify press specification.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function detectPagePreset(widthPt: number, heightPt: number): PageSizePreset {
  const minS = Math.min(widthPt, heightPt);
  const maxS = Math.max(widthPt, heightPt);
  for (const [key, dims] of Object.entries(PAGE_PRESETS_PT)) {
    const pMin = Math.min(dims.widthPt, dims.heightPt);
    const pMax = Math.max(dims.widthPt, dims.heightPt);
    if (Math.abs(minS - pMin) < 4 && Math.abs(maxS - pMax) < 4) {
      return key as PageSizePreset;
    }
  }
  return 'Custom';
}

export function createDefaultPageConfig(
  widthPt = 595.28,
  heightPt = 841.89,
  unit: MeasurementUnit = 'mm'
): PageConfig {
  const orientation: PageOrientation = widthPt > heightPt ? 'landscape' : 'portrait';
  return {
    sizePreset: detectPagePreset(widthPt, heightPt),
    orientation,
    widthPt,
    heightPt,
    unit,
    marginTopPt: 18,
    marginBottomPt: 18,
    marginLeftPt: 18,
    marginRightPt: 18,
    bleedPt: 0,
    cropMarks: false,
    backgroundColor: '#FFFFFF',
    rotation: 0,
  };
}

export function createDefaultFitConfig(
  widthPt = 595.28,
  heightPt = 841.89
): SourceFitConfig {
  return {
    boundaryMode: 'original_page',
    scalingMode: 'auto_fit_aspect',
    customPercent: 100,
    customCropRect: { x: 0, y: 0, width: widthPt, height: heightPt },
    manualBoundsRect: { x: 0, y: 0, width: widthPt, height: heightPt },
    cropPaddingPt: 2,
    preserveIntentionalWhitespace: true,
  };
}

export function createDefaultCopiesConfig(): CopiesPerPageConfig {
  return {
    enabled: false,
    copiesPreset: 2,
    columns: 1,
    rows: 2,
    horizontalSpacingPt: 14,
    verticalSpacingPt: 14,
    outerMarginTopPt: 18,
    outerMarginRightPt: 18,
    outerMarginBottomPt: 18,
    outerMarginLeftPt: 18,
    copyScale: 1,
    copyRotation: 0,
    fitToPage: true,
    positioningMode: 'auto',
    manualOffsets: [],
    cropMarks: true,
    cuttingGuides: true,
    showBorders: false,
    allowOverlapOrOverflow: false,
    sourceScope: 'full_page',
  };
}

export function createDefaultBulkConfig(): BulkConfig {
  return {
    enabled: false,
    totalOutputPages: 1,
    copiesPerPage: 1,
    totalRecords: 1,
    startPageNumber: 1,
    endPageNumber: 1,
    documentBlocksCount: 1,
    copiesPerDocument: 1,
    dataSourceMode: 'hybrid',
  };
}

export function createDefaultExportConfig(): ExportConfig {
  return {
    mode: 'standard',
    dpi: 300,
    imageCompression: 'medium',
    embedFonts: true,
    addPageNumbers: false,
    pageNumberFormat: 'Page {page} of {total}',
    watermarkText: '',
    watermarkOpacity: 0.12,
    passwordProtect: false,
    userPassword: '',
    cropMarks: false,
    bleedPt: 0,
    selectedPagesRange: '1-10',
  };
}

export function presetToGrid(preset: CopiesPerPageConfig['copiesPreset']): {
  columns: number;
  rows: number;
} {
  switch (preset) {
    case 1:
      return { columns: 1, rows: 1 };
    case 2:
      return { columns: 1, rows: 2 };
    case 3:
      return { columns: 1, rows: 3 };
    case 4:
      return { columns: 2, rows: 2 };
    case 6:
      return { columns: 2, rows: 3 };
    case 8:
      return { columns: 2, rows: 4 };
    case 9:
      return { columns: 3, rows: 3 };
    case 12:
      return { columns: 3, rows: 4 };
    case 'custom':
      return { columns: 2, rows: 2 };
  }
}
