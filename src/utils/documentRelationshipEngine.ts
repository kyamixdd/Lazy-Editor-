import {
  DocumentElement,
  DocumentHierarchyNode,
  ElementType,
  ObjectClassification,
  RectPt,
  ScanCorrectionRule,
  ScanQualityReport,
  ScanUncertainTarget,
} from '../types/pdfStudio';
import {
  analyzeVectorPrimitives,
  buildFormAndAnnotationElements,
  buildImageElementsFromPlacements,
  buildTextElementsFromRuns,
  detectFourLineRectangles,
  finalizeUnclaimedLines,
  scoreToConfidenceLevel,
} from './geometryClassifier';
import { RawPageScanInput } from './scanPrimitives';
import { rectIou, SpatialBBoxIndex } from './spatialIndex';
import { reconstructTablesOnPage } from './tableReconstructionEngine';

export interface ProcessedPageResult {
  pageNumber: number;
  elements: DocumentElement[];
  hierarchy: DocumentHierarchyNode;
  contentBBox: RectPt;
  blockBoxes: Array<{ blockId: string; rect: RectPt }>;
}

/**
 * Applies previously saved manual template correction rules on re-scan so user
 * reclassifications (e.g. Line->Rectangle, Image->Background, etc.) persist deterministically.
 */
export function applyCorrectionRulesToElements(
  elements: DocumentElement[],
  rules: ScanCorrectionRule[] = []
): DocumentElement[] {
  if (!rules || rules.length === 0) return elements;

  return elements.map((el) => {
    const matchingRule = rules.find((rule) => {
      if (rule.pageNumber !== el.pageNumber) return false;
      const iou = rectIou(rule.matchBBox, {
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
      });
      if (iou >= 0.65) return true;
      if (
        rule.matchTextPrefix &&
        el.text &&
        el.text.toLowerCase().startsWith(rule.matchTextPrefix.toLowerCase()) &&
        Math.hypot(rule.matchBBox.x - el.x, rule.matchBBox.y - el.y) <= 24
      ) {
        return true;
      }
      return false;
    });

    if (!matchingRule) return el;

    if (matchingRule.action === 'mark_background') {
      return {
        ...el,
        objectSubtype: 'background_image',
        isBackgroundImage: true,
        locked: true,
        needsReview: false,
        confidence: 1,
        confidenceLevel: 'high',
        relationshipNote: 'Reclassified as background image via saved template rule',
      };
    }

    if (matchingRule.action === 'reclassify') {
      const cat =
        matchingRule.targetType === 'image' || matchingRule.targetType === 'signature'
          ? 'image'
          : matchingRule.targetType === 'table' || matchingRule.targetType === 'repeated_block'
          ? 'structural'
          : matchingRule.targetType === 'form_field'
          ? 'form'
          : matchingRule.targetType === 'line' ||
            matchingRule.targetType === 'shape' ||
            matchingRule.targetType === 'border'
          ? 'vector'
          : 'text';
      return {
        ...el,
        type: matchingRule.targetType,
        objectCategory: cat,
        objectSubtype: matchingRule.targetSubtype,
        needsReview: false,
        confidence: 1,
        confidenceLevel: 'high',
        relationshipNote: 'Reclassified via saved template correction rule',
      };
    }

    return el;
  });
}

function elementInsideContainer(el: DocumentElement, box: RectPt, tol = 4): boolean {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return (
    cx >= box.x - tol &&
    cx <= box.x + box.width + tol &&
    cy >= box.y - tol &&
    cy <= box.y + box.height + tol
  );
}

/**
 * Part 5: Document Relationship Reconstruction
 * - Groups repeated vertical or horizontal receipt/invoice blocks (if clearly separated)
 * - Links text, tables, and images inside container rectangles (`parentId` / `childIds`)
 * - Builds an actual hierarchical `DocumentHierarchyNode` tree per page
 */
export function reconstructPageRelationshipsAndHierarchy(
  elements: DocumentElement[],
  pageNumber: number,
  pageWidthPt: number,
  pageHeightPt: number
): {
  pageNumber: number;
  elements: DocumentElement[];
  hierarchy: DocumentHierarchyNode;
  contentBBox: RectPt;
  blockBoxes: Array<{ blockId: string; rect: RectPt }>;
} {
  const updated = elements.map((e) => ({ ...e }));

  // 1. Identify container rectangles / borders (non-tiny rects >= 80x40pt that hold >= 2 child items)
  const containers = updated.filter(
    (e) =>
      (e.type === 'border' || e.type === 'shape') &&
      e.width >= 80 &&
      e.height >= 40 &&
      e.objectSubtype !== 'circle' &&
      e.objectSubtype !== 'ellipse'
  );

  // Assign smallest enclosing container as parentId for inner text/images/tables
  const sortedContainers = [...containers].sort(
    (a, b) => a.width * a.height - b.width * b.height
  );
  for (const el of updated) {
    if (el.type === 'repeated_block') continue;
    const owner = sortedContainers.find(
      (c) =>
        c.id !== el.id &&
        c.width * c.height > el.width * el.height * 1.15 &&
        elementInsideContainer(el, { x: c.x, y: c.y, width: c.width, height: c.height }, 3)
    );
    if (owner) {
      el.parentId = owner.id;
      if (!owner.childIds) owner.childIds = [];
      if (!owner.childIds.includes(el.id)) owner.childIds.push(el.id);
    }
  }

  // 2. Detect repeated receipt / invoice blocks (2+ sibling large containers of similar dimensions,
  // or clear top/bottom or left/right duplicated identifier regions)
  const blockBoxes: Array<{ blockId: string; rect: RectPt }> = [];
  const blockElements: DocumentElement[] = [];

  // Check if containers form sibling repeated blocks (similar W & H within 15%)
  const largeContainers = sortedContainers.filter(
    (c) => c.width >= pageWidthPt * 0.3 && c.height >= pageHeightPt * 0.22
  );
  const repeatedGroups: DocumentElement[][] = [];
  for (const c of largeContainers) {
    const existingGroup = repeatedGroups.find(
      (g) =>
        Math.abs(g[0].width - c.width) <= Math.max(20, g[0].width * 0.15) &&
        Math.abs(g[0].height - c.height) <= Math.max(20, g[0].height * 0.15) &&
        !g.some((m) => rectIou(m, c) > 0.35)
    );
    if (existingGroup) existingGroup.push(c);
    else repeatedGroups.push([c]);
  }

  const bestRepeatedGroup = repeatedGroups.find((g) => g.length >= 2);
  if (bestRepeatedGroup) {
    bestRepeatedGroup
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .forEach((box, idx) => {
        const blockId = `block-${String.fromCharCode(65 + idx)}`;
        const hasReceiptWord = updated.some(
          (e) =>
            elementInsideContainer(e, box, 4) &&
            /\b(receipt|slip|voucher)\b/i.test(e.text)
        );
        const blockSubtype: ObjectClassification = hasReceiptWord
          ? 'receipt_block'
          : 'invoice_block';
        const blockRect: RectPt = {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
        blockBoxes.push({ blockId, rect: blockRect });

        const blockChildren: string[] = [];
        for (const el of updated) {
          if (elementInsideContainer(el, blockRect, 4)) {
            el.blockId = blockId;
            blockChildren.push(el.id);
          }
        }
        blockElements.push({
          id: `el-p${pageNumber}-${blockId}`,
          type: 'repeated_block',
          pageNumber,
          x: blockRect.x,
          y: blockRect.y,
          width: blockRect.width,
          height: blockRect.height,
          rotation: 0,
          text: `${hasReceiptWord ? 'Receipt' : 'Document'} Block ${String.fromCharCode(65 + idx)}`,
          fontFamily: 'Helvetica',
          fontSize: 10,
          fontWeight: 'bold',
          fontStyle: 'normal',
          color: '#111827',
          backgroundColor: 'transparent',
          borderColor: '#4B5563',
          borderWidth: 0.75,
          align: 'left',
          opacity: 0.9,
          editable: false,
          locked: false,
          visible: true,
          blockId,
          childIds: blockChildren,
          confidence: 0.92,
          confidenceLevel: 'high',
          needsReview: false,
          sourceOrigin: 'original_pdf',
          objectCategory: 'structural',
          objectSubtype: blockSubtype,
          detectionMethod: 'geometric_inference',
          relationshipNote: `Repeated ${blockSubtype.replace('_', ' ')} containing ${blockChildren.length} objects`,
          originalBBox: { ...blockRect },
        });
      });
  } else {
    // Fallback: detect vertical split by repeated receipt/invoice numbers if >= 2 identifier fields exist
    const idFields = updated.filter(
      (e) =>
        e.type === 'invoice_number' ||
        e.type === 'receipt_number' ||
        e.objectSubtype === 'identifier_field'
    );
    if (idFields.length >= 2) {
      const sortedIds = [...idFields].sort((a, b) => a.y - b.y || a.x - b.x);
      const splitVertical =
        Math.abs(sortedIds[0].y - sortedIds[1].y) > pageHeightPt * 0.25;
      const splitHorizontal =
        !splitVertical &&
        Math.abs(sortedIds[0].x - sortedIds[1].x) > pageWidthPt * 0.25;

      if (splitVertical || splitHorizontal) {
        sortedIds.forEach((_, idx) => {
          const blockId = `block-${String.fromCharCode(65 + idx)}`;
          const blockRect: RectPt = splitVertical
            ? {
                x: 16,
                y: Number(((idx * pageHeightPt) / sortedIds.length + 12).toFixed(2)),
                width: Number((pageWidthPt - 32).toFixed(2)),
                height: Number((pageHeightPt / sortedIds.length - 24).toFixed(2)),
              }
            : {
                x: Number(((idx * pageWidthPt) / sortedIds.length + 12).toFixed(2)),
                y: 16,
                width: Number((pageWidthPt / sortedIds.length - 24).toFixed(2)),
                height: Number((pageHeightPt - 32).toFixed(2)),
              };
          blockBoxes.push({ blockId, rect: blockRect });
          const blockChildren: string[] = [];
          for (const el of updated) {
            if (elementInsideContainer(el, blockRect, 4)) {
              el.blockId = blockId;
              blockChildren.push(el.id);
            }
          }
          blockElements.push({
            id: `el-p${pageNumber}-${blockId}`,
            type: 'repeated_block',
            pageNumber,
            x: blockRect.x,
            y: blockRect.y,
            width: blockRect.width,
            height: blockRect.height,
            rotation: 0,
            text: `Document Block ${String.fromCharCode(65 + idx)}`,
            fontFamily: 'Helvetica',
            fontSize: 10,
            fontWeight: 'bold',
            fontStyle: 'normal',
            color: '#111827',
            backgroundColor: 'transparent',
            borderColor: '#4B5563',
            borderWidth: 0.75,
            align: 'left',
            opacity: 0.9,
            editable: false,
            locked: false,
            visible: true,
            blockId,
            childIds: blockChildren,
            confidence: 0.82,
            confidenceLevel: 'medium',
            needsReview: false,
            sourceOrigin: 'original_pdf',
            objectCategory: 'structural',
            objectSubtype: 'document_block',
            detectionMethod: 'geometric_inference',
            relationshipNote: `Inferred block region (${blockChildren.length} objects)`,
            originalBBox: { ...blockRect },
          });
        });
      }
    }
  }

  const allElements = [...updated, ...blockElements];

  // Compute overall page content bounding box
  const nonBlock = allElements.filter((e) => e.type !== 'repeated_block');
  const contentBBox: RectPt =
    nonBlock.length > 0
      ? (() => {
          const minX = Math.max(0, Math.min(...nonBlock.map((e) => e.x)));
          const minY = Math.max(0, Math.min(...nonBlock.map((e) => e.y)));
          const maxX = Math.min(pageWidthPt, Math.max(...nonBlock.map((e) => e.x + e.width)));
          const maxY = Math.min(pageHeightPt, Math.max(...nonBlock.map((e) => e.y + e.height)));
          return {
            x: Number(minX.toFixed(2)),
            y: Number(minY.toFixed(2)),
            width: Number(Math.max(12, maxX - minX).toFixed(2)),
            height: Number(Math.max(12, maxY - minY).toFixed(2)),
          };
        })()
      : { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt };

  // Build hierarchical tree: Page -> Header / Blocks / Body / Footer -> Container / Table -> Rows -> Cells / Elements
  const makeLeafNode = (el: DocumentElement): DocumentHierarchyNode => {
    const labelText = (el.text || '').trim();
    const label = labelText
      ? `${el.objectSubtype || el.type}: ${labelText.slice(0, 32)}`
      : `${el.objectSubtype || el.type} (${Math.round(el.width)}×${Math.round(el.height)}pt)`;
    const node: DocumentHierarchyNode = {
      id: `node-${el.id}`,
      kind: el.type === 'table' ? 'table' : el.parentId ? 'element' : 'element',
      label,
      pageNumber,
      bbox: { x: el.x, y: el.y, width: el.width, height: el.height },
      elementId: el.id,
      confidence: el.confidence,
      needsReview: el.needsReview,
      children: [],
    };
    if (el.type === 'table' && el.tableData) {
      node.kind = 'table';
      node.children = el.tableData.rows.map((rowVals, rIdx) => ({
        id: `node-${el.id}-r${rIdx}`,
        kind: 'table_row',
        label: `Row ${rIdx + 1}`,
        pageNumber,
        children: rowVals.map((cellVal, cIdx) => ({
          id: `node-${el.id}-r${rIdx}-c${cIdx}`,
          kind: 'table_cell',
          label: cellVal ? cellVal.slice(0, 28) : `(empty ${rIdx + 1},${cIdx + 1})`,
          pageNumber,
          elementId: el.id,
          children: [],
        })),
      }));
    }
    return node;
  };

  const pageChildren: DocumentHierarchyNode[] = [];
  const attachedIds = new Set<string>();

  if (blockElements.length > 0) {
    for (const blk of blockElements) {
      attachedIds.add(blk.id);
      const blkChildren = updated.filter((e) => e.blockId === blk.blockId);
      const topLevelInBlock = blkChildren.filter(
        (e) => !e.parentId || !blkChildren.some((p) => p.id === e.parentId)
      );
      const blkNodes: DocumentHierarchyNode[] = topLevelInBlock.map((el) => {
        attachedIds.add(el.id);
        const n = makeLeafNode(el);
        if (el.childIds && el.childIds.length > 0) {
          const kids = blkChildren.filter((c) => c.parentId === el.id);
          if (kids.length > 0) {
            n.kind = 'container_rect';
            n.children = kids.map((k) => {
              attachedIds.add(k.id);
              return makeLeafNode(k);
            });
          }
        }
        return n;
      });
      pageChildren.push({
        id: `node-${blk.id}`,
        kind:
          blk.objectSubtype === 'receipt_block'
            ? 'receipt_block'
            : blk.objectSubtype === 'invoice_block'
            ? 'invoice_block'
            : 'document_block',
        label: blk.text,
        pageNumber,
        bbox: { x: blk.x, y: blk.y, width: blk.width, height: blk.height },
        elementId: blk.id,
        confidence: blk.confidence,
        children: blkNodes,
      });
    }
  }

  // Remaining elements not in repeated blocks -> group into Header, Body, Footer
  const remaining = updated.filter((e) => !attachedIds.has(e.id));
  const headerEls = remaining.filter(
    (e) => !e.parentId && e.y + e.height <= pageHeightPt * 0.16 && e.type !== 'border'
  );
  const footerEls = remaining.filter(
    (e) => !e.parentId && e.y >= pageHeightPt * 0.86 && e.type !== 'border'
  );
  const headerSet = new Set(headerEls.map((e) => e.id));
  const footerSet = new Set(footerEls.map((e) => e.id));
  const bodyEls = remaining.filter(
    (e) => !headerSet.has(e.id) && !footerSet.has(e.id) && !e.parentId
  );

  const buildNodeWithChildren = (el: DocumentElement): DocumentHierarchyNode => {
    const n = makeLeafNode(el);
    if (el.type !== 'table' && el.childIds && el.childIds.length > 0) {
      const kids = remaining.filter((c) => c.parentId === el.id);
      if (kids.length > 0) {
        n.kind = 'container_rect';
        n.children = kids.map(buildNodeWithChildren);
      }
    }
    return n;
  };

  if (headerEls.length > 0) {
    pageChildren.push({
      id: `node-p${pageNumber}-header`,
      kind: 'header',
      label: `Header (${headerEls.length})`,
      pageNumber,
      children: headerEls.map(buildNodeWithChildren),
    });
  }
  if (bodyEls.length > 0) {
    pageChildren.push({
      id: `node-p${pageNumber}-body`,
      kind: 'section',
      label: `Document Body (${bodyEls.length})`,
      pageNumber,
      children: bodyEls.map(buildNodeWithChildren),
    });
  }
  if (footerEls.length > 0) {
    pageChildren.push({
      id: `node-p${pageNumber}-footer`,
      kind: 'footer',
      label: `Footer (${footerEls.length})`,
      pageNumber,
      children: footerEls.map(buildNodeWithChildren),
    });
  }

  const hierarchy: DocumentHierarchyNode = {
    id: `node-page-${pageNumber}`,
    kind: 'page',
    label: `Page ${pageNumber} (${Math.round(pageWidthPt)}×${Math.round(pageHeightPt)}pt)`,
    pageNumber,
    bbox: { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt },
    children: pageChildren,
  };

  return {
    pageNumber,
    elements: allElements,
    hierarchy,
    contentBBox,
    blockBoxes,
  };
}

/**
 * Full pure-TypeScript Multi-Pass Structural Reconstruction for a single page.
 * Runs identically in Web Worker, Browser main thread, or Node.js regression tests.
 */
export function processRawPageScan(
  input: RawPageScanInput,
  correctionRules: ScanCorrectionRule[] = []
): ProcessedPageResult {
  // Pass 2 reconstruction: individual text runs -> tight phrase elements (without over-merging)
  const rawTextElements = buildTextElementsFromRuns(
    input.textRuns,
    input.pageNumber,
    input.heightPt
  );

  // Pass 3 reconstruction: vector paths -> line segments + classified closed/curved shapes
  const { lineSegments, vectorElements } = analyzeVectorPrimitives(
    input.vectorPaths,
    input.widthPt,
    input.heightPt
  );

  // Part 4 reconstruction: bordered, partially bordered, and borderless tables
  const { tables, consumedTextIds } = reconstructTablesOnPage(
    lineSegments,
    rawTextElements,
    vectorElements,
    input.pageNumber
  );

  // Filter loose text elements that are now owned cleanly inside structured table cells
  const looseTextElements = rawTextElements.filter((t) => !consumedTextIds.has(t.id));

  // Part 3 reconstruction: 4-line connected rectangles from remaining lines
  const fourLineRects = detectFourLineRectangles(
    lineSegments,
    input.pageNumber,
    input.widthPt,
    input.heightPt
  );

  // Finalize remaining unclaimed independent/separator/underline lines
  const lineElements = finalizeUnclaimedLines(
    lineSegments,
    looseTextElements,
    input.pageNumber,
    input.widthPt
  );

  // Pass 4 reconstruction: classify extracted image placements
  const imageElements = buildImageElementsFromPlacements(
    input.imagePlacements,
    input,
    looseTextElements
  );

  // Pass 1 annotations & AcroForm widgets
  const formAndAnnotElements = buildFormAndAnnotationElements(input);

  // Merge all reconstructed objects ordered by zOrder (background images -> vector fills/borders -> lines -> tables -> images -> text -> forms)
  const combined = [
    ...imageElements.filter((i) => i.isBackgroundImage),
    ...vectorElements,
    ...fourLineRects,
    ...lineElements,
    ...tables,
    ...imageElements.filter((i) => !i.isBackgroundImage),
    ...looseTextElements,
    ...formAndAnnotElements,
  ];

  // Apply user's saved manual correction rules (if re-scanning a template)
  const corrected = applyCorrectionRulesToElements(combined, correctionRules);

  // Part 5 reconstruction: containers, repeated blocks, hierarchy tree
  return reconstructPageRelationshipsAndHierarchy(
    corrected,
    input.pageNumber,
    input.widthPt,
    input.heightPt
  );
}

/**
 * Part 12: Computes an exact, verifiable ScanQualityReport from actual scanned elements.
 */
export function computeScanQualityReport(
  elements: DocumentElement[],
  totalPages: number,
  ocrRegionsCount = 0
): ScanQualityReport {
  let textObjects = 0;
  let imageObjects = 0;
  let vectorPaths = 0;
  let lines = 0;
  let rectangles = 0;
  let tables = 0;
  let tableCells = 0;
  let formFields = 0;
  let ocrTextCount = 0;
  let unclassifiedObjects = 0;
  let lowConfidenceObjects = 0;
  let needsReviewObjects = 0;

  const pagesNeedingReviewSet = new Set<number>();
  const uncertainTargets: ScanUncertainTarget[] = [];

  for (const el of elements) {
    if (el.type === 'repeated_block') continue;

    if (el.sourceOrigin === 'scanned_ocr') {
      ocrTextCount++;
    }

    if (
      el.type === 'heading' ||
      el.type === 'text' ||
      el.type === 'invoice_number' ||
      el.type === 'receipt_number'
    ) {
      textObjects++;
    } else if (el.type === 'image' || el.type === 'signature') {
      imageObjects++;
    } else if (el.type === 'line') {
      lines++;
      vectorPaths++;
    } else if (el.type === 'shape' || el.type === 'border') {
      vectorPaths++;
      if (
        el.objectSubtype === 'rect' ||
        el.objectSubtype === 'rounded_rect' ||
        el.objectSubtype === 'border' ||
        el.objectSubtype === 'filled_shape' ||
        el.shapeKind === 'rect'
      ) {
        rectangles++;
      }
    } else if (el.type === 'table') {
      tables++;
      if (el.tableData?.rows) {
        tableCells += el.tableData.rows.reduce((sum, r) => sum + r.length, 0);
      }
    } else if (el.type === 'form_field') {
      formFields++;
    }

    if (!el.objectSubtype) {
      unclassifiedObjects++;
    }

    const level = el.confidenceLevel || scoreToConfidenceLevel(el.confidence, el.needsReview);
    if (level === 'low' || el.confidence < 0.65) {
      lowConfidenceObjects++;
    }
    if (el.needsReview || level === 'needs_review' || level === 'low') {
      if (el.needsReview) needsReviewObjects++;
      pagesNeedingReviewSet.add(el.pageNumber);
      uncertainTargets.push({
        elementId: el.id,
        pageNumber: el.pageNumber,
        label: (el.text || el.objectSubtype || el.type).slice(0, 40),
        objectSubtype: el.objectSubtype,
        reason:
          el.reviewReason ||
          (el.confidence < 0.65
            ? `Low detection confidence (${Math.round(el.confidence * 100)}%)`
            : 'Flagged for manual verification'),
        confidence: el.confidence,
        confidenceLevel: level,
      });
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    engineVersion: '2.0.0',
    totalPages,
    totalElements: elements.filter((e) => e.type !== 'repeated_block').length,
    textObjects,
    imageObjects,
    vectorPaths,
    lines,
    rectangles,
    tables,
    tableCells,
    formFields,
    ocrRegions: Math.max(ocrRegionsCount, ocrTextCount > 0 ? 1 : 0),
    unclassifiedObjects,
    lowConfidenceObjects,
    needsReviewObjects,
    pagesNeedingReview: Array.from(pagesNeedingReviewSet).sort((a, b) => a - b),
    uncertainTargets,
  };
}

/**
 * Helper to create a manual correction rule from an element edit so template re-scans
 * remember user structural adjustments.
 */
export function buildCorrectionRuleFromElement(
  el: DocumentElement,
  targetType: ElementType,
  targetSubtype: ObjectClassification,
  action: ScanCorrectionRule['action']
): ScanCorrectionRule {
  return {
    id: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    pageNumber: el.pageNumber,
    matchBBox: {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    },
    matchTextPrefix: el.text ? el.text.slice(0, 20) : undefined,
    originalType: el.type,
    originalSubtype: el.objectSubtype,
    targetType,
    targetSubtype,
    action,
  };
}

// Re-export SpatialBBoxIndex helper for callers
export { SpatialBBoxIndex };
