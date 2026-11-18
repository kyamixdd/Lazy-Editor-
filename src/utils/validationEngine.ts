import { AssetFontItem, PDFProject, ValidationIssue } from '../types/pdfStudio';
import { validateBarcodeSpec } from './barcodeEngine';
import { computeSheetLayout } from './geometryEngine';
import { getMinTemplateFontPt } from './printOptimizerEngine';
import { generateSerialPreview } from './serialEngine';
import { computeTypographyLayout } from './typographyEngine';
import { validatePageConfigDimensions } from './units';

const STANDARD_PDF_FONTS = new Set([
  'Helvetica',
  'Helvetica-Bold',
  'Times-Roman',
  'Times',
  'Courier',
]);

const WEB_FALLBACK_FONTS = new Set([
  'Plus Jakarta Sans',
  'DM Sans',
  'JetBrains Mono',
]);

export function validateProject(
  project: PDFProject,
  customFonts: AssetFontItem[] = []
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const {
    pageConfig,
    elements,
    copiesConfig,
    serialRules,
    bulkConfig,
    dataColumns,
    dataRows,
  } = project;

  const fontMap = new Map(
    customFonts.map((f) => [f.fontFamily.toLowerCase(), f])
  );

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
      pageNumber: 1,
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
      pageNumber: 1,
      message: warn,
    });
  }

  // 2. Per-element checks (in source template coordinate space)
  const visibleElements = elements.filter((e) => e.visible);

  for (const el of visibleElements) {
    const elPageMeta =
      project.originalPages.find((p) => p.pageNumber === el.pageNumber) ||
      project.originalPages[0];
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

    // Text overflow & clipping telemetry via shared typographyEngine
    if (
      (el.type === 'text' ||
        el.type === 'heading' ||
        el.type === 'invoice_number' ||
        el.type === 'receipt_number' ||
        el.type === 'callout') &&
      el.text.trim().length > 0
    ) {
      const typo = computeTypographyLayout(el);
      if (typo.isOverflowingY || typo.isOverflowingX) {
        issues.push({
          id: `qc-overflow-${el.id}`,
          severity: typo.isOverflowingY && el.height < typo.effectiveFontSize * 1.1 ? 'error' : 'warning',
          category: typo.isClipped ? 'clipping' : 'text_overflow',
          elementId: el.id,
          pageNumber: el.pageNumber,
          message: `Text overflow/clipping in "${el.text.slice(0, 24)}" (box ${Math.round(el.width)}×${Math.round(el.height)}pt vs content ${Math.round(typo.totalTextWidthPt)}×${Math.round(typo.totalTextHeightPt)}pt).`,
          autoFixLabel: 'Expand Box Height',
        });
      }
    }

    // Missing images, Effective DPI & Aspect Ratio Distortion Check
    if (el.type === 'image' || el.type === 'signature') {
      if (el.isUserAdded && !el.imageDataUrl) {
        issues.push({
          id: `qc-img-${el.id}`,
          severity: 'error',
          category: 'missing_image',
          elementId: el.id,
          pageNumber: el.pageNumber,
          message: `Image element on Page ${el.pageNumber} has no image source attached.`,
        });
      } else if (el.imageNaturalWidth && el.imageNaturalHeight && el.width > 1 && el.height > 1) {
        const srcW = el.imageCropRect ? Math.max(1, el.imageCropRect.width) : el.imageNaturalWidth;
        const srcH = el.imageCropRect ? Math.max(1, el.imageCropRect.height) : el.imageNaturalHeight;
        const naturalRatio = srcW / srcH;
        const boxRatio = el.width / el.height;
        const distortion = Math.abs(boxRatio - naturalRatio) / Math.max(0.01, naturalRatio);
        if (distortion > 0.22) {
          issues.push({
            id: `qc-img-ratio-${el.id}`,
            severity: 'warning',
            category: 'aspect_ratio',
            elementId: el.id,
            pageNumber: el.pageNumber,
            message: `Distorted aspect ratio (${Math.round(distortion * 100)}% stretch) on "${el.text || 'Image'}" (Page ${el.pageNumber}).`,
          });
        }

        const dpiX = el.imageNaturalWidth / (el.width / 72);
        const dpiY = el.imageNaturalHeight / (el.height / 72);
        const effDpi = Math.round(Math.min(dpiX, dpiY));
        if (effDpi < 72) {
          issues.push({
            id: `qc-img-dpi-${el.id}`,
            severity: 'error',
            category: 'image_resolution',
            elementId: el.id,
            pageNumber: el.pageNumber,
            effectiveDpi: effDpi,
            message: `Critically low image resolution (${effDpi} DPI) on Page ${el.pageNumber} ("${el.text || 'Image'}"). Minimum 150 DPI recommended for print.`,
          });
        } else if (effDpi < 150) {
          issues.push({
            id: `qc-img-dpi-${el.id}`,
            severity: 'warning',
            category: 'image_resolution',
            elementId: el.id,
            pageNumber: el.pageNumber,
            effectiveDpi: effDpi,
            message: `Low image resolution (${effDpi} DPI) on Page ${el.pageNumber} ("${el.text || 'Image'}"). May appear pixelated in 300 DPI print.`,
          });
        }
      }
    }

    // Custom Font Availability, License Embedding Restriction & Font Substitution Check (Module 5 & 8)
    const famLower = (el.fontFamily || '').toLowerCase();
    const matchedCustom = fontMap.get(famLower);
    const isStandard = STANDARD_PDF_FONTS.has(el.fontFamily);
    if (!isStandard) {
      if (matchedCustom) {
        if (!matchedCustom.canEmbedInPdf) {
          issues.push({
            id: `qc-font-lic-${el.id}`,
            severity: 'warning',
            category: 'font_license',
            elementId: el.id,
            pageNumber: el.pageNumber,
            message: `Font "${el.fontFamily}" has restricted embedding license (${matchedCustom.embeddingPermission}). Export will fall back to Helvetica.`,
            detail: matchedCustom.licenseNote,
          });
        }
      } else if (WEB_FALLBACK_FONTS.has(el.fontFamily)) {
        if (!project.exportConfig.embedFonts) {
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
      } else {
        issues.push({
          id: `qc-font-missing-${el.id}`,
          severity: 'warning',
          category: 'missing_font',
          elementId: el.id,
          pageNumber: el.pageNumber,
          message: `Font "${el.fontFamily}" on Page ${el.pageNumber} is not embedded or present in Asset Library; PDF export substitutes Helvetica.`,
        });
      }
    }

    // Unexpected Layout Drift Check vs original detected geometry (Module 5)
    if (!el.isUserAdded && el.sourceOriginalRect) {
      const dx = Math.abs(el.x - el.sourceOriginalRect.x);
      const dy = Math.abs(el.y - el.sourceOriginalRect.y);
      const wRatio =
        el.sourceOriginalRect.width > 6
          ? Math.abs(el.width - el.sourceOriginalRect.width) /
            el.sourceOriginalRect.width
          : 0;
      if (dx > 30 || dy > 30 || wRatio > 0.65) {
        issues.push({
          id: `qc-drift-${el.id}`,
          severity: 'warning',
          category: 'layout_drift',
          elementId: el.id,
          pageNumber: el.pageNumber,
          message: `Large layout shift on "${el.text.slice(0, 20) || el.type}" (moved ${Math.round(dx)}×${Math.round(dy)}pt from original PDF coordinate).`,
          autoFixLabel: 'Revert Position',
        });
      }
    }

    // Barcode & QR scannability check (Module 8)
    if (el.type === 'barcode' || el.type === 'qr_code') {
      const bReport = validateBarcodeSpec(el);
      for (const bErr of bReport.errors) {
        issues.push({
          id: `qc-barcode-err-${el.id}-${issues.length}`,
          severity: 'error',
          category: 'missing_field',
          elementId: el.id,
          pageNumber: el.pageNumber,
          message: `Barcode/QR on Page ${el.pageNumber}: ${bErr}`,
        });
      }
      for (const bWarn of bReport.warnings) {
        issues.push({
          id: `qc-barcode-warn-${el.id}-${issues.length}`,
          severity: 'warning',
          category: 'missing_field',
          elementId: el.id,
          pageNumber: el.pageNumber,
          message: `Barcode/QR on Page ${el.pageNumber}: ${bWarn}`,
        });
      }
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
  const blockMap = new Map<string, { minX: number; minY: number; width: number; pageNumber: number; firstId: string }>();
  for (const el of visibleElements) {
    if (!el.blockId) continue;
    const prev = blockMap.get(el.blockId);
    if (!prev) {
      blockMap.set(el.blockId, {
        minX: el.x,
        minY: el.y,
        width: el.width,
        pageNumber: el.pageNumber,
        firstId: el.id,
      });
    } else {
      blockMap.set(el.blockId, {
        minX: Math.min(prev.minX, el.x),
        minY: Math.min(prev.minY, el.y),
        width: Math.max(prev.width, el.width),
        pageNumber: prev.pageNumber,
        firstId: prev.firstId,
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
          elementId: box.firstId,
          pageNumber: box.pageNumber,
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
      pageNumber: 1,
      message: 'Selected source crop region is smaller than 12×12pt.',
      autoFixLabel: 'Reset Crop',
    });
  }

  if (layout.availableWidthPt <= 10 || layout.availableHeightPt <= 10) {
    issues.push({
      id: 'qc-imposition-bounds',
      severity: 'error',
      category: 'out_of_bounds',
      pageNumber: 1,
      message: 'Margins and grid spacing exceed available output page dimensions.',
      autoFixLabel: 'Enable Fit-to-Page',
    });
  } else if (!copiesConfig.allowOverlapOrOverflow) {
    if (layout.hasOverlap) {
      issues.push({
        id: 'qc-imposition-overlap',
        severity: 'error',
        category: 'overlap',
        pageNumber: 1,
        message: `${layout.overlapPairs.length} copy slot pair(s) overlap on the output sheet. Reduce scale or increase spacing.`,
        autoFixLabel: 'Enable Fit-to-Page',
      });
    }
      if (layout.hasClipping && layout.scalingMode !== 'fill_cell') {
      issues.push({
        id: 'qc-imposition-overflow',
        severity: 'error',
        category: 'clipping',
        pageNumber: 1,
        message: `Placed content (${Math.round(layout.slots[0]?.placedWidthPt || 0)}×${Math.round(layout.slots[0]?.placedHeightPt || 0)}pt) clips or extends beyond cell/page boundaries.`,
        autoFixLabel: 'Enable Fit-to-Page',
      });
    }
  }

  // Scaled readability floor check (Module 5)
  if (layout.slots.length > 0) {
    const minScale = Math.min(...layout.slots.map((s) => s.scale));
    const minOrigFontPt = getMinTemplateFontPt(project);
    const minScaledFontPt = Number((minOrigFontPt * minScale).toFixed(2));
    const minThreshold = project.printOptimization?.minReadableFontPt ?? 4.5;
    if (minScaledFontPt < minThreshold) {
      issues.push({
        id: 'qc-scaled-readability',
        severity: project.printOptimization?.minReadableFontPt ? 'error' : 'warning',
        category: 'text_overflow',
        pageNumber: 1,
        message: `Smallest font (${minOrigFontPt.toFixed(1)}pt) scales to ${minScaledFontPt}pt under ${layout.columns}×${layout.rows} imposition, below ${minThreshold}pt readability minimum.`,
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
        pageNumber: 1,
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

  // 8. Unexpected blank page/region check
  for (let p = 1; p <= Math.max(1, project.pageCount); p++) {
    const pageMeta = project.originalPages.find((pg) => pg.pageNumber === p);
    const visibleOnPage = visibleElements.filter((e) => e.pageNumber === p);
    const hasOriginalContent = Boolean(
      project.sourcePdfBase64 && pageMeta && !pageMeta.isBlankInserted
    );
    if (!hasOriginalContent && visibleOnPage.length === 0) {
      issues.push({
        id: `qc-blank-p${p}`,
        severity: 'warning',
        category: 'blank_region',
        pageNumber: p,
        message: `Page ${p} has no visible elements or source PDF content (blank page).`,
      });
    }
  }

  // 9. Inconsistent styling across repeated/mapped fields
  const fieldStyleGroups = new Map<string, typeof visibleElements>();
  for (const el of visibleElements) {
    if (!el.fieldKey) continue;
    const arr = fieldStyleGroups.get(el.fieldKey) || [];
    arr.push(el);
    fieldStyleGroups.set(el.fieldKey, arr);
  }
  for (const [fKey, group] of fieldStyleGroups.entries()) {
    if (group.length < 2) continue;
    const base = group[0];
    const mismatch = group.find(
      (other) =>
        other.fontFamily !== base.fontFamily ||
        Math.abs(other.fontSize - base.fontSize) > 1.5 ||
        other.fontWeight !== base.fontWeight
    );
    if (mismatch) {
      issues.push({
        id: `qc-inconsistent-${fKey}`,
        severity: 'warning',
        category: 'inconsistent_repeated',
        elementId: mismatch.id,
        pageNumber: mismatch.pageNumber,
        message: `Repeated field "${fKey}" has inconsistent typography (${mismatch.fontFamily} ${mismatch.fontSize}pt vs ${base.fontFamily} ${base.fontSize}pt).`,
      });
    }
  }

  // 10. Pending (un-applied) visual redactions check
  const pendingRedactions = visibleElements.filter(
    (e) => e.type === 'redaction' && !e.redactionApplied
  );
  if (pendingRedactions.length > 0) {
    issues.push({
      id: 'qc-pending-redactions',
      severity: 'warning',
      category: 'pending_redaction',
      pageNumber: pendingRedactions[0].pageNumber,
      elementId: pendingRedactions[0].id,
      message: `${pendingRedactions.length} marked redaction zone(s) have not been permanently sanitized. Underlying PDF text remains extractable until True Redaction is applied.`,
      detail: 'Click "Apply True Redactions" to strip underlying objects and burn opaque masks into the output.',
      autoFixLabel: 'Apply True Redactions',
    });
  }

  return issues;
}
