import { PDFProject, ValidationIssue } from '../types/pdfStudio';
import { computeSheetLayout } from './geometryEngine';
import { generateSerialPreview } from './serialEngine';
import { validatePageConfigDimensions } from './units';

const STANDARD_PDF_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Times-Roman',
  'Times',
  'Courier',
]);

export function validateProject(project: PDFProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { pageConfig, elements, copiesConfig, serialRules, bulkConfig, dataColumns, dataRows } = project;

  // 1. Page dimensions & margins check (prevents invalid PDF MediaBox & negative printable area)
  const dimCheck = validatePageConfigDimensions({
    widthPt: pageConfig.widthPt,
    heightPt: pageConfig.heightPt,
    marginTopPt: pageConfig.marginTopPt,
    marginBottomPt: pageConfig.marginBottomPt,
    marginLeftPt: pageConfig.marginLeftPt,
    marginRightPt: pageConfig.marginRightPt,
    bleedPt: pageConfig.bleedPt ?? project.exportConfig.bleedPt,
  });
  if (!dimCheck.valid) {
    issues.push({
      id: 'qc-page-dims',
      severity: 'error',
      category: 'page_dimensions',
      message: dimCheck.errors.join(' '),
      autoFixLabel:
        pageConfig.widthPt >= 36 && pageConfig.heightPt >= 36
          ? 'Reset Margins'
          : undefined,
    });
  }
  for (const warn of dimCheck.warnings) {
    issues.push({
      id: `qc-page-warn-${issues.length}`,
      severity: 'warning',
      category: 'page_dimensions',
      message: warn,
    });
  }

  // 2. Per-element checks (in source template coordinate space)
  const visibleElements = elements.filter((e) => e.visible);

  for (const el of visibleElements) {
    const elPageMeta = project.originalPages.find((p) => p.pageNumber === el.pageNumber) || project.originalPages[0];
    const spaceW = elPageMeta?.widthPt || pageConfig.widthPt;
    const spaceH = elPageMeta?.heightPt || pageConfig.heightPt;
    // Out of template boundaries
    if (
      el.x < 0 ||
      el.y < 0 ||
      el.x + el.width > spaceW + 2 ||
      el.y + el.height > spaceH + 2
    ) {
      issues.push({
        id: `qc-bounds-${el.id}`,
        severity: 'error',
        category: 'out_of_bounds',
        elementId: el.id,
        pageNumber: el.pageNumber,
        message: `Element "${el.text.slice(0, 24) || el.type}" on Page ${el.pageNumber} extends outside template page boundaries.`,
        autoFixLabel: 'Clamp Inside Page',
      });
    }

    // Text overflow estimate
    if (
      (el.type === 'text' ||
        el.type === 'heading' ||
        el.type === 'invoice_number' ||
        el.type === 'receipt_number') &&
      el.text.trim().length > 0
    ) {
      const avgCharWidth = el.fontSize * 0.56;
      const lines = el.text.split('\n');
      const longestLine = Math.max(...lines.map((l) => l.length));
      const estimatedRequiredWidth = longestLine * avgCharWidth;
      const estimatedLines = Math.max(
        lines.length,
        Math.ceil(estimatedRequiredWidth / Math.max(20, el.width))
      );
      const estimatedRequiredHeight = estimatedLines * el.fontSize * 1.25;

      if (estimatedRequiredHeight > el.height + 6) {
        issues.push({
          id: `qc-overflow-${el.id}`,
          severity: 'warning',
          category: 'text_overflow',
          elementId: el.id,
          pageNumber: el.pageNumber,
          message: `Potential text overflow in "${el.text.slice(0, 24)}" (box height ${Math.round(el.height)}pt vs est. ${Math.round(estimatedRequiredHeight)}pt).`,
          autoFixLabel: 'Expand Box Height',
        });
      }
    }

    // Missing images
    if (el.type === 'image' && el.isUserAdded && !el.imageDataUrl) {
      issues.push({
        id: `qc-img-${el.id}`,
        severity: 'error',
        category: 'missing_image',
        elementId: el.id,
        pageNumber: el.pageNumber,
        message: `Image element on Page ${el.pageNumber} has no image source attached.`,
      });
    }

    // Unexpected font substitution
    if (!STANDARD_PDF_FONTS.has(el.fontFamily) && !project.exportConfig.embedFonts) {
      issues.push({
        id: `qc-font-${el.id}`,
        severity: 'warning',
        category: 'font_substitution',
        elementId: el.id,
        pageNumber: el.pageNumber,
        message: `Font "${el.fontFamily}" on "${el.text.slice(0, 20)}" will substitute to Helvetica during PDF export.`,
        autoFixLabel: 'Enable Font Fallback',
      });
    }

    // Flagged for manual AI review
    if (el.needsReview) {
      issues.push({
        id: `qc-review-${el.id}`,
        severity: 'warning',
        category: 'missing_field',
        elementId: el.id,
        pageNumber: el.pageNumber,
        message: `Low AI confidence (${Math.round(el.confidence * 100)}%) on "${el.text.slice(0, 24)}": ${el.reviewReason || 'Verify position and text.'}`,
      });
    }
  }

  // 3. Overlapping text elements check (ignore borders/shapes/repeated_block containers)
  const textEls = visibleElements.filter(
    (e) =>
      e.type !== 'border' &&
      e.type !== 'shape' &&
      e.type !== 'line' &&
      e.type !== 'repeated_block'
  );
  for (let i = 0; i < textEls.length; i++) {
    for (let j = i + 1; j < textEls.length; j++) {
      const a = textEls[i];
      const b = textEls[j];
      if (a.pageNumber !== b.pageNumber) continue;
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 4 && overlapY > 4) {
        issues.push({
          id: `qc-overlap-${a.id}-${b.id}`,
          severity: 'warning',
          category: 'overlap',
          elementId: a.id,
          pageNumber: a.pageNumber,
          message: `Elements "${a.text.slice(0, 16)}" and "${b.text.slice(0, 16)}" overlap on Page ${a.pageNumber}.`,
        });
      }
    }
  }

  // 4. Misaligned receipt blocks check
  const blockMap = new Map<string, { minX: number; minY: number; width: number }>();
  for (const el of visibleElements) {
    if (!el.blockId) continue;
    const prev = blockMap.get(el.blockId);
    if (!prev) {
      blockMap.set(el.blockId, { minX: el.x, minY: el.y, width: el.width });
    } else {
      blockMap.set(el.blockId, {
        minX: Math.min(prev.minX, el.x),
        minY: Math.min(prev.minY, el.y),
        width: Math.max(prev.width, el.width),
      });
    }
  }
  const blocks = Array.from(blockMap.entries());
  if (blocks.length >= 2) {
    const first = blocks[0][1];
    for (let i = 1; i < blocks.length; i++) {
      const [bId, box] = blocks[i];
      const deltaX = Math.abs(box.minX - first.minX);
      if (deltaX > 1.5 && deltaX < 14) {
        issues.push({
          id: `qc-align-${bId}`,
          severity: 'warning',
          category: 'misaligned_block',
          message: `Receipt/document block "${bId}" is horizontally misaligned by ${deltaX.toFixed(1)}pt relative to "${blocks[0][0]}".`,
          autoFixLabel: 'Align Blocks',
        });
      }
    }
  }

  // 5. Shared geometry & imposition validation (exact preview/export layout check)
  const layout = computeSheetLayout(project, 1);
  if (layout.sourceBox.width < 12 || layout.sourceBox.height < 12) {
    issues.push({
      id: 'qc-crop-invalid',
      severity: 'error',
      category: 'page_dimensions',
      message: 'Selected source crop region is smaller than 12×12pt.',
      autoFixLabel: 'Reset Crop',
    });
  }

  if (layout.availableWidthPt <= 10 || layout.availableHeightPt <= 10) {
    issues.push({
      id: 'qc-imposition-bounds',
      severity: 'error',
      category: 'out_of_bounds',
      message: 'Margins and grid spacing exceed available output page dimensions.',
      autoFixLabel: 'Enable Fit-to-Page',
    });
  } else if (!copiesConfig.allowOverlapOrOverflow) {
    if (layout.hasOverlap) {
      issues.push({
        id: 'qc-imposition-overlap',
        severity: 'error',
        category: 'overlap',
        message: `${layout.overlapPairs.length} copy slot pair(s) overlap on the output sheet. Reduce scale or increase spacing.`,
        autoFixLabel: 'Enable Fit-to-Page',
      });
    }
    if (layout.hasClipping && layout.scalingMode !== 'fill_cell') {
      issues.push({
        id: 'qc-imposition-overflow',
        severity: 'error',
        category: 'clipping',
        message: `Placed content (${Math.round(layout.slots[0]?.placedWidthPt || 0)}×${Math.round(layout.slots[0]?.placedHeightPt || 0)}pt) clips or extends beyond cell/page boundaries.`,
        autoFixLabel: 'Enable Fit-to-Page',
      });
    }
  }

  // Warn when placed content exceeds the configured printable margin area
  if (dimCheck.valid && layout.slots.length > 0 && !copiesConfig.enabled) {
    const printLeft = pageConfig.marginLeftPt;
    const printTop = pageConfig.marginTopPt;
    const printRight = pageConfig.widthPt - pageConfig.marginRightPt;
    const printBottom = pageConfig.heightPt - pageConfig.marginBottomPt;
    const s0 = layout.slots[0];
    const exceedsMargins =
      !layout.isPassThroughOriginal1to1 &&
      (s0.drawXPt < printLeft - 1 ||
        s0.drawTopPt < printTop - 1 ||
        s0.drawXPt + s0.placedWidthPt > printRight + 1 ||
        s0.drawTopPt + s0.placedHeightPt > printBottom + 1);
    const elementsExceedMargins =
      layout.isPassThroughOriginal1to1 &&
      visibleElements.some(
        (el) =>
          el.type !== 'border' &&
          el.type !== 'repeated_block' &&
          (el.x < printLeft - 1 ||
            el.y < printTop - 1 ||
            el.x + el.width > printRight + 1 ||
            el.y + el.height > printBottom + 1)
      );
    if (exceedsMargins || elementsExceedMargins) {
      issues.push({
        id: 'qc-printable-area-warn',
        severity: 'warning',
        category: 'out_of_bounds',
        message:
          'Content extends beyond the configured printable margin area. Consider switching to Auto-Fit or reducing margins.',
        autoFixLabel: exceedsMargins ? 'Enable Fit-to-Page' : undefined,
      });
    }
  }

  // 6. Serial numbering checks (duplicates & out-of-range)
  for (const rule of serialRules) {
    if (rule.mode === 'auto' && rule.increment > 0 && rule.startNumber > rule.endNumber) {
      issues.push({
        id: `qc-serial-range-${rule.id}`,
        severity: 'error',
        category: 'serial_error',
        message: `Serial rule "${rule.name}": start number (${rule.startNumber}) is greater than end number (${rule.endNumber}).`,
      });
    }
  }

  if (serialRules.length > 0) {
    const copiesPerPage = copiesConfig.enabled
      ? copiesConfig.columns * copiesConfig.rows
      : 1;
    const sim = generateSerialPreview(
      serialRules,
      bulkConfig.totalOutputPages,
      copiesPerPage,
      dataRows,
      1
    );
    if (sim.duplicates.length > 0) {
      issues.push({
        id: 'qc-serial-dup',
        severity: 'error',
        category: 'duplicate_serial',
        message: `Duplicate serial numbers detected across pages: ${sim.duplicates.slice(0, 3).join(', ')}`,
      });
    }
    if (sim.outOfRangeCount > 0) {
      issues.push({
        id: 'qc-serial-oor',
        severity: 'error',
        category: 'serial_error',
        message: `${sim.outOfRangeCount} generated copy slot(s) exceed configured serial numbering end range or CSV row count.`,
      });
    }
  }

  // 7. Missing required Data Manager fields
  const mappedFields = new Set(
    elements.map((e) => e.fieldKey).filter((k): k is string => Boolean(k))
  );
  for (const col of dataColumns) {
    if (col.required && mappedFields.has(col.name)) {
      const emptyCount = dataRows.filter(
        (r) => r[col.name] === undefined || String(r[col.name]).trim() === ''
      ).length;
      if (emptyCount > 0) {
        issues.push({
          id: `qc-missing-${col.id}`,
          severity: 'error',
          category: 'missing_field',
          message: `Required mapped field "${col.name}" has ${emptyCount} empty row(s) in Data Manager.`,
        });
      }
    }
  }

  return issues;
}
