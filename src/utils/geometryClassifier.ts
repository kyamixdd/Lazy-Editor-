import {
  ConfidenceLevel,
  DocumentElement,
  ElementType,
  LineSemanticRole,
  ObjectCategory,
  ObjectClassification,
  RectPt,
  VectorPathGeometry,
} from '../types/pdfStudio';
import {
  RawImagePlacement,
  RawPageScanInput,
  RawTextRun,
  RawVectorPath,
} from './scanPrimitives';
import { rectsOverlap, SpatialBBoxIndex } from './spatialIndex';

export interface AnalyzedLineSegment {
  id: string;
  orientation: 'horizontal' | 'vertical' | 'diagonal';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bbox: RectPt;
  strokeColor: string;
  strokeWidth: number;
  dashArray: number[];
  opacity: number;
  zOrder: number;
  rawPath: RawVectorPath;
  claimedByTableId?: string;
  claimedByRectId?: string;
  lineRole: LineSemanticRole;
}

export interface VectorAnalysisResult {
  lineSegments: AnalyzedLineSegment[];
  vectorElements: DocumentElement[];
}

export function scoreToConfidenceLevel(
  score: number,
  needsReview?: boolean
): ConfidenceLevel {
  if (needsReview || score < 0.45) return 'needs_review';
  if (score >= 0.85) return 'high';
  if (score >= 0.65) return 'medium';
  return 'low';
}

function approxEqual(a: number, b: number, tol = 2.2): boolean {
  return Math.abs(a - b) <= tol;
}

/**
 * Inspects raw PDF vector path commands and sampled points to accurately distinguish:
 * - Horizontal, vertical, diagonal, and dashed lines (including thin filled rule-rects)
 * - Axis-aligned closed rectangles (re / 4 orthogonal lines)
 * - Rounded rectangles (4 straight sides + 4 corner Bezier curves or chamfered arcs)
 * - Circles & ellipses (symmetric closed curve paths)
 * - Polygons & freeform vector paths
 */
export function classifyVectorPath(
  path: RawVectorPath
): {
  kind:
    | 'horizontal_line'
    | 'vertical_line'
    | 'diagonal_line'
    | 'rect'
    | 'rounded_rect'
    | 'circle'
    | 'ellipse'
    | 'polygon'
    | 'freeform_path';
  cornerRadiusPt?: number;
  lineSegment?: { x1: number; y1: number; x2: number; y2: number };
} {
  const { commands, points, bbox, isClosed: explicitClosed } = path;
  const w = bbox.width;
  const h = bbox.height;
  const curveOps = commands.filter((c) => c.op === 'C' || c.op === 'Q').length;
  const lineOps = commands.filter((c) => c.op === 'L').length;
  const vertexCount = Math.floor(points.length / 2);
  const endpointsMeet =
    vertexCount >= 3 &&
    Math.hypot(points[points.length - 2] - points[0], points[points.length - 1] - points[1]) <= 1.8;
  const isClosed = explicitClosed || endpointsMeet;

  // 1. Thin filled or stroked bar/rule (many PDF writers emit thin filled rects for horizontal/vertical lines)
  if (w >= 8 && h <= 3.2 && w / Math.max(0.2, h) >= 3.5 && curveOps === 0) {
    const midY = bbox.y + h / 2;
    return {
      kind: 'horizontal_line',
      lineSegment: { x1: bbox.x, y1: midY, x2: bbox.x + w, y2: midY },
    };
  }
  if (h >= 8 && w <= 3.2 && h / Math.max(0.2, w) >= 3.5 && curveOps === 0) {
    const midX = bbox.x + w / 2;
    return {
      kind: 'vertical_line',
      lineSegment: { x1: midX, y1: bbox.y, x2: midX, y2: bbox.y + h },
    };
  }

  // 2. Two-point straight line segment
  if (curveOps === 0 && vertexCount === 2 && !isClosed) {
    const x1 = points[0];
    const y1 = points[1];
    const x2 = points[2];
    const y2 = points[3];
    if (Math.abs(y2 - y1) <= 1.5 && Math.abs(x2 - x1) >= 2) {
      return {
        kind: 'horizontal_line',
        lineSegment: {
          x1: Math.min(x1, x2),
          y1: (y1 + y2) / 2,
          x2: Math.max(x1, x2),
          y2: (y1 + y2) / 2,
        },
      };
    }
    if (Math.abs(x2 - x1) <= 1.5 && Math.abs(y2 - y1) >= 2) {
      return {
        kind: 'vertical_line',
        lineSegment: {
          x1: (x1 + x2) / 2,
          y1: Math.min(y1, y2),
          x2: (x1 + x2) / 2,
          y2: Math.max(y1, y2),
        },
      };
    }
    return {
      kind: 'diagonal_line',
      lineSegment: { x1, y1, x2, y2 },
    };
  }

  // 3. Rounded rectangle detection (explicit curves: ~4 corners + ~4 edges)
  if (isClosed && curveOps >= 4 && curveOps <= 8 && lineOps >= 2 && lineOps <= 6 && w >= 8 && h >= 8) {
    // Estimate corner radius from first straight edge inset relative to bbox
    let estRadius = Math.min(w, h) * 0.12;
    for (let i = 0; i < points.length; i += 2) {
      const px = points[i];
      const py = points[i + 1];
      if (approxEqual(py, bbox.y, 0.8) && px > bbox.x + 1 && px < bbox.x + w - 1) {
        const inset = Math.min(px - bbox.x, bbox.x + w - px);
        if (inset > 0.5 && inset <= Math.min(w, h) / 2) {
          estRadius = inset;
          break;
        }
      }
    }
    return {
      kind: 'rounded_rect',
      cornerRadiusPt: Number(Math.max(1, Math.min(Math.min(w, h) / 2, estRadius)).toFixed(2)),
    };
  }

  // 4. Circle / Ellipse (closed curve path with 4+ curve segments and minimal/no straight edges)
  if (isClosed && curveOps >= 3 && lineOps <= 2 && w >= 4 && h >= 4) {
    // Check if vertices stay near ellipse perimeter rather than rectangular corners
    const cx = bbox.x + w / 2;
    const cy = bbox.y + h / 2;
    const rx = Math.max(1, w / 2);
    const ry = Math.max(1, h / 2);
    let cornerPoints = 0;
    for (let i = 0; i < points.length; i += 2) {
      const nx = Math.abs(points[i] - cx) / rx;
      const ny = Math.abs(points[i + 1] - cy) / ry;
      if (nx > 0.92 && ny > 0.92) cornerPoints++;
    }
    if (cornerPoints === 0) {
      return {
        kind: Math.abs(w - h) <= Math.max(1.5, Math.min(w, h) * 0.06) ? 'circle' : 'ellipse',
      };
    }
  }

  // 5. Axis-aligned Closed Rectangle (4 or 5 vertices at bbox corners)
  if (curveOps === 0 && (vertexCount === 4 || vertexCount === 5) && w >= 3 && h >= 3) {
    const distinctPts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < points.length; i += 2) {
      const pt = { x: points[i], y: points[i + 1] };
      if (
        !distinctPts.some(
          (p) => Math.abs(p.x - pt.x) <= 1.2 && Math.abs(p.y - pt.y) <= 1.2
        )
      ) {
        distinctPts.push(pt);
      }
    }
    if (distinctPts.length === 4) {
      const allAtCorners = distinctPts.every(
        (p) =>
          (approxEqual(p.x, bbox.x, 1.8) || approxEqual(p.x, bbox.x + w, 1.8)) &&
          (approxEqual(p.y, bbox.y, 1.8) || approxEqual(p.y, bbox.y + h, 1.8))
      );
      if (allAtCorners) {
        return { kind: 'rect' };
      }
    }
  }

  // 6. Polyline / multi-segment closed path -> Polygon or Rounded Rect if sampled curve
  if (isClosed && vertexCount >= 3 && curveOps === 0) {
    return { kind: 'polygon' };
  }

  // 7. Polyline open straight path that reduces to a single line
  if (!isClosed && curveOps === 0 && vertexCount >= 2) {
    const firstX = points[0];
    const firstY = points[1];
    const lastX = points[points.length - 2];
    const lastY = points[points.length - 1];
    const allHorizontal = points.every((v, idx) => idx % 2 === 0 || approxEqual(v, firstY, 1.2));
    if (allHorizontal && w >= 3) {
      return {
        kind: 'horizontal_line',
        lineSegment: { x1: bbox.x, y1: firstY, x2: bbox.x + w, y2: firstY },
      };
    }
    const allVertical = points.every((v, idx) => idx % 2 === 1 || approxEqual(v, firstX, 1.2));
    if (allVertical && h >= 3) {
      return {
        kind: 'vertical_line',
        lineSegment: { x1: firstX, y1: bbox.y, x2: firstX, y2: bbox.y + h },
      };
    }
    if (vertexCount === 2) {
      return {
        kind: 'diagonal_line',
        lineSegment: { x1: firstX, y1: firstY, x2: lastX, y2: lastY },
      };
    }
  }

  return { kind: 'freeform_path' };
}

/**
 * Splits raw vector paths into line segments (for 4-line rect & table grid intelligence)
 * and standalone classified shape elements (rects, rounded rects, circles, ellipses, polygons, paths).
 */
export function analyzeVectorPrimitives(
  rawPaths: RawVectorPath[],
  pageWidthPt: number,
  pageHeightPt: number
): VectorAnalysisResult {
  const lineSegments: AnalyzedLineSegment[] = [];
  const vectorElements: DocumentElement[] = [];

  for (const path of rawPaths) {
    if (path.isClippingPath && !path.isStroked && !path.isFilled) {
      continue;
    }
    // Skip full-page white background fill rects that match the sheet exactly
    if (
      path.isFilled &&
      !path.isStroked &&
      path.fillColor?.toLowerCase() === '#ffffff' &&
      path.bbox.width >= pageWidthPt * 0.96 &&
      path.bbox.height >= pageHeightPt * 0.96
    ) {
      continue;
    }

    const classified = classifyVectorPath(path);
    const strokeCol = path.strokeColor || path.fillColor || '#111827';
    const fillCol = path.isFilled ? path.fillColor || '#111827' : 'transparent';

    if (
      (classified.kind === 'horizontal_line' ||
        classified.kind === 'vertical_line' ||
        classified.kind === 'diagonal_line') &&
      classified.lineSegment
    ) {
      const seg = classified.lineSegment;
      const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
      if (len < 3) continue;
      const orient =
        classified.kind === 'horizontal_line'
          ? 'horizontal'
          : classified.kind === 'vertical_line'
          ? 'vertical'
          : 'diagonal';
      lineSegments.push({
        id: path.id,
        orientation: orient,
        x1: seg.x1,
        y1: seg.y1,
        x2: seg.x2,
        y2: seg.y2,
        bbox: {
          x: Number(Math.min(seg.x1, seg.x2).toFixed(2)),
          y: Number(Math.min(seg.y1, seg.y2).toFixed(2)),
          width: Number(Math.max(1, Math.abs(seg.x2 - seg.x1)).toFixed(2)),
          height: Number(Math.max(1, Math.abs(seg.y2 - seg.y1)).toFixed(2)),
        },
        strokeColor: strokeCol,
        strokeWidth: Math.max(0.5, path.strokeWidth || (orient === 'horizontal' ? path.bbox.height : path.bbox.width) || 1),
        dashArray: path.dashArray || [],
        opacity: path.opacity ?? 1,
        zOrder: path.zOrder,
        rawPath: path,
        lineRole: 'independent',
      });
      continue;
    }

    // Multi-segment closed/open shapes
    const w = Math.max(2, path.bbox.width);
    const h = Math.max(2, path.bbox.height);
    const isPageFrame = w > pageWidthPt * 0.72 && h > pageHeightPt * 0.72 && !path.isFilled;

    let elType: ElementType = 'shape';
    let shapeKind: DocumentElement['shapeKind'] = 'rect';
    let objectSubtype: ObjectClassification = 'rect';

    if (classified.kind === 'rounded_rect') {
      elType = isPageFrame ? 'border' : 'shape';
      shapeKind = 'rect';
      objectSubtype = 'rounded_rect';
    } else if (classified.kind === 'circle') {
      elType = 'shape';
      shapeKind = 'circle';
      objectSubtype = 'circle';
    } else if (classified.kind === 'ellipse') {
      elType = 'shape';
      shapeKind = 'circle';
      objectSubtype = 'ellipse';
    } else if (classified.kind === 'polygon') {
      elType = 'shape';
      shapeKind = 'polygon';
      objectSubtype = 'polygon';
    } else if (classified.kind === 'freeform_path') {
      elType = 'shape';
      shapeKind = 'polygon';
      objectSubtype = 'freeform_path';
    } else {
      elType = isPageFrame || (!path.isFilled && w >= 36 && h >= 18) ? 'border' : 'shape';
      shapeKind = 'rect';
      objectSubtype = path.isFilled && !path.isStroked ? 'filled_shape' : isPageFrame ? 'border' : 'rect';
    }

    // Relative points inside bbox for canvas & export rendering
    const relPoints: number[] = [];
    for (let i = 0; i < path.points.length; i += 2) {
      relPoints.push(
        Number((path.points[i] - path.bbox.x).toFixed(2)),
        Number((path.points[i + 1] - path.bbox.y).toFixed(2))
      );
    }

    const vectorPath: VectorPathGeometry = {
      commands: path.commands,
      points: path.points,
      isClosed: path.isClosed,
      isFilled: path.isFilled,
      isStroked: path.isStroked,
      isClippingPath: path.isClippingPath,
      cornerRadiusPt: classified.cornerRadiusPt,
      dashArray: path.dashArray,
      lineCap: path.lineCap,
      lineJoin: path.lineJoin,
      transformMatrix: path.transformMatrix,
    };

    const conf =
      objectSubtype === 'freeform_path' && path.commands.length < 3 ? 0.72 : 0.96;

    vectorElements.push({
      id: path.id,
      type: elType,
      pageNumber: path.pageNumber,
      x: Number(path.bbox.x.toFixed(2)),
      y: Number(path.bbox.y.toFixed(2)),
      width: Number(w.toFixed(2)),
      height: Number(h.toFixed(2)),
      rotation: 0,
      text: '',
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: strokeCol,
      backgroundColor: fillCol,
      borderColor: path.isStroked ? strokeCol : fillCol,
      borderWidth: path.isStroked ? Math.max(0.5, path.strokeWidth || 1) : 0,
      align: 'left',
      opacity: path.opacity ?? 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: conf,
      confidenceLevel: scoreToConfidenceLevel(conf),
      needsReview: false,
      shapeKind,
      points: relPoints.length >= 4 ? relPoints : undefined,
      sourceOriginalRect: {
        x: Number(path.bbox.x.toFixed(2)),
        y: Number(path.bbox.y.toFixed(2)),
        width: Number(w.toFixed(2)),
        height: Number(h.toFixed(2)),
      },
      sourceOrigin: 'original_pdf',
      objectCategory: 'vector',
      objectSubtype,
      detectionMethod: 'pdf_operator',
      originalObjectRef: path.originalObjectRef,
      originalBBox: { ...path.bbox },
      transformMatrix: path.transformMatrix,
      zOrder: path.zOrder,
      vectorPath,
      strokeColor: path.isStroked ? strokeCol : undefined,
      fillColor: path.isFilled ? fillCol : undefined,
      dashArray: path.dashArray?.length ? path.dashArray : undefined,
      cornerRadiusPt: classified.cornerRadiusPt,
    });
  }

  return { lineSegments, vectorElements };
}

/**
 * Part 3: 4-Line Connected Rectangle Intelligence.
 * Detects closed rectangular borders drawn from 2 horizontal + 2 vertical stroke segments
 * whose endpoints meet cleanly, promoting them to logical rectangles while keeping
 * constituent edge geometry references intact and NEVER merging unrelated nearby lines.
 */
export function detectFourLineRectangles(
  lineSegments: AnalyzedLineSegment[],
  pageNumber: number,
  pageWidthPt: number,
  pageHeightPt: number
): DocumentElement[] {
  const horiz = lineSegments.filter(
    (l) => !l.claimedByTableId && !l.claimedByRectId && l.orientation === 'horizontal'
  );
  const vert = lineSegments.filter(
    (l) => !l.claimedByTableId && !l.claimedByRectId && l.orientation === 'vertical'
  );

  const rects: DocumentElement[] = [];
  const tol = 3.2;

  for (let ti = 0; ti < horiz.length; ti++) {
    const top = horiz[ti];
    if (top.claimedByRectId) continue;
    const topW = top.x2 - top.x1;
    if (topW < 10) continue;

    for (let bi = ti + 1; bi < horiz.length; bi++) {
      const bot = horiz[bi];
      if (bot.claimedByRectId) continue;
      if (Math.abs(bot.y1 - top.y1) < 8) continue;
      if (!approxEqual(top.x1, bot.x1, tol) || !approxEqual(top.x2, bot.x2, tol)) continue;

      const upper = top.y1 < bot.y1 ? top : bot;
      const lower = top.y1 < bot.y1 ? bot : top;
      const boxLeftX = (upper.x1 + lower.x1) / 2;
      const boxRightX = (upper.x2 + lower.x2) / 2;
      const boxTopY = upper.y1;
      const boxBotY = lower.y1;

      const leftEdge = vert.find(
        (v) =>
          !v.claimedByRectId &&
          approxEqual(v.x1, boxLeftX, tol) &&
          approxEqual(v.y1, boxTopY, tol) &&
          approxEqual(v.y2, boxBotY, tol)
      );
      if (!leftEdge) continue;

      const rightEdge = vert.find(
        (v) =>
          !v.claimedByRectId &&
          v.id !== leftEdge.id &&
          approxEqual(v.x1, boxRightX, tol) &&
          approxEqual(v.y1, boxTopY, tol) &&
          approxEqual(v.y2, boxBotY, tol)
      );
      if (!rightEdge) continue;

      const w = boxRightX - boxLeftX;
      const h = boxBotY - boxTopY;
      const rectId = `el-p${pageNumber}-rect4-${rects.length + 1}`;

      upper.claimedByRectId = rectId;
      lower.claimedByRectId = rectId;
      leftEdge.claimedByRectId = rectId;
      rightEdge.claimedByRectId = rectId;
      upper.lineRole = 'rect_border';
      lower.lineRole = 'rect_border';
      leftEdge.lineRole = 'rect_border';
      rightEdge.lineRole = 'rect_border';

      const avgWidth =
        (upper.strokeWidth + lower.strokeWidth + leftEdge.strokeWidth + rightEdge.strokeWidth) /
        4;
      const isPageFrame = w > pageWidthPt * 0.72 && h > pageHeightPt * 0.72;
      const subtype: ObjectClassification = isPageFrame ? 'border' : 'rect';

      rects.push({
        id: rectId,
        type: isPageFrame ? 'border' : 'shape',
        pageNumber,
        x: Number(boxLeftX.toFixed(2)),
        y: Number(boxTopY.toFixed(2)),
        width: Number(w.toFixed(2)),
        height: Number(h.toFixed(2)),
        rotation: 0,
        text: '',
        fontFamily: 'Helvetica',
        fontSize: 10,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: upper.strokeColor,
        backgroundColor: 'transparent',
        borderColor: upper.strokeColor,
        borderWidth: Number(avgWidth.toFixed(2)),
        align: 'left',
        opacity: Math.min(upper.opacity, leftEdge.opacity),
        editable: true,
        locked: false,
        visible: true,
        confidence: 0.93,
        confidenceLevel: 'high',
        needsReview: false,
        shapeKind: 'rect',
        childIds: [upper.id, lower.id, leftEdge.id, rightEdge.id],
        sourceOriginalRect: {
          x: Number(boxLeftX.toFixed(2)),
          y: Number(boxTopY.toFixed(2)),
          width: Number(w.toFixed(2)),
          height: Number(h.toFixed(2)),
        },
        sourceOrigin: 'original_pdf',
        objectCategory: 'vector',
        objectSubtype: subtype,
        detectionMethod: 'geometric_inference',
        relationshipNote: 'Reconstructed from 4 connected orthogonal edge lines',
        originalBBox: {
          x: Number(boxLeftX.toFixed(2)),
          y: Number(boxTopY.toFixed(2)),
          width: Number(w.toFixed(2)),
          height: Number(h.toFixed(2)),
        },
        zOrder: Math.min(upper.zOrder, lower.zOrder, leftEdge.zOrder, rightEdge.zOrder),
        strokeColor: upper.strokeColor,
        dashArray: upper.dashArray.length ? upper.dashArray : undefined,
        vectorPath: {
          commands: [
            { op: 'M', args: [boxLeftX, boxTopY] },
            { op: 'L', args: [boxRightX, boxTopY] },
            { op: 'L', args: [boxRightX, boxBotY] },
            { op: 'L', args: [boxLeftX, boxBotY] },
            { op: 'Z', args: [] },
          ],
          points: [
            boxLeftX,
            boxTopY,
            boxRightX,
            boxTopY,
            boxRightX,
            boxBotY,
            boxLeftX,
            boxBotY,
          ],
          isClosed: true,
          isFilled: false,
          isStroked: true,
          dashArray: upper.dashArray,
          lineRole: 'rect_border',
        },
      });
      break;
    }
  }

  return rects;
}

/**
 * Converts remaining unclaimed line segments into classified line elements
 * (horizontal_line, vertical_line, diagonal_line, dashed_line, divider, underline).
 */
export function finalizeUnclaimedLines(
  lineSegments: AnalyzedLineSegment[],
  textElements: DocumentElement[],
  pageNumber: number,
  pageWidthPt: number
): DocumentElement[] {
  const textIndex = new SpatialBBoxIndex<DocumentElement>(36);
  textIndex.insertAll(textElements);

  const out: DocumentElement[] = [];
  for (const seg of lineSegments) {
    if (seg.claimedByTableId || seg.claimedByRectId) continue;

    let role: LineSemanticRole = 'independent';
    let subtype: ObjectClassification =
      seg.dashArray.length > 0
        ? 'dashed_line'
        : seg.orientation === 'horizontal'
        ? 'horizontal_line'
        : seg.orientation === 'vertical'
        ? 'vertical_line'
        : 'diagonal_line';

    if (seg.orientation === 'horizontal') {
      const len = seg.x2 - seg.x1;
      // Check if directly beneath a text line (underline)
      const nearTexts = textIndex.queryIntersecting(
        {
          x: seg.x1 - 4,
          y: seg.y1 - 14,
          width: len + 8,
          height: 16,
        },
        2
      );
      const isUnderline = nearTexts.some(
        (t) =>
          t.y + t.height >= seg.y1 - 6 &&
          t.y + t.height <= seg.y1 + 3 &&
          Math.abs(t.x - seg.x1) <= 12 &&
          len <= t.width + 24
      );
      if (isUnderline) {
        role = 'underline';
      } else if (len >= pageWidthPt * 0.35 && seg.dashArray.length === 0) {
        role = 'separator';
        subtype = 'divider';
      }
    }

    const bboxW = seg.orientation === 'horizontal' ? Math.max(2, seg.x2 - seg.x1) : Math.max(2, seg.bbox.width);
    const bboxH = seg.orientation === 'vertical' ? Math.max(2, seg.y2 - seg.y1) : Math.max(2, seg.bbox.height);
    const relPoints = [
      Number((seg.x1 - seg.bbox.x).toFixed(2)),
      Number((seg.y1 - seg.bbox.y).toFixed(2)),
      Number((seg.x2 - seg.bbox.x).toFixed(2)),
      Number((seg.y2 - seg.bbox.y).toFixed(2)),
    ];

    out.push({
      id: seg.id,
      type: 'line',
      pageNumber,
      x: seg.bbox.x,
      y: seg.bbox.y,
      width: Number(bboxW.toFixed(2)),
      height: Number(bboxH.toFixed(2)),
      rotation: 0,
      text: '',
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: seg.strokeColor,
      backgroundColor: 'transparent',
      borderColor: seg.strokeColor,
      borderWidth: Number(seg.strokeWidth.toFixed(2)),
      align: 'left',
      opacity: seg.opacity,
      editable: true,
      locked: false,
      visible: true,
      confidence: 0.95,
      confidenceLevel: 'high',
      needsReview: false,
      shapeKind: 'line',
      points: relPoints,
      sourceOriginalRect: {
        x: seg.bbox.x,
        y: seg.bbox.y,
        width: Number(bboxW.toFixed(2)),
        height: Number(bboxH.toFixed(2)),
      },
      sourceOrigin: 'original_pdf',
      objectCategory: 'vector',
      objectSubtype: subtype,
      detectionMethod: 'pdf_operator',
      originalObjectRef: seg.rawPath.originalObjectRef,
      originalBBox: { ...seg.bbox },
      transformMatrix: seg.rawPath.transformMatrix,
      zOrder: seg.zOrder,
      strokeColor: seg.strokeColor,
      dashArray: seg.dashArray.length ? seg.dashArray : undefined,
      vectorPath: {
        commands: seg.rawPath.commands,
        points: [seg.x1, seg.y1, seg.x2, seg.y2],
        isClosed: false,
        isFilled: false,
        isStroked: true,
        dashArray: seg.dashArray,
        lineCap: seg.rawPath.lineCap,
        lineJoin: seg.rawPath.lineJoin,
        transformMatrix: seg.rawPath.transformMatrix,
        lineRole: role,
      },
    });
  }
  return out;
}

/**
 * Classifies text semantics (`heading`, `invoice_number`, `receipt_number`,
 * `identifier_field`, `date_field`, `numeric_field`, `label`, `paragraph`, `text_run`).
 */
export function classifyTextElementSemantics(
  text: string,
  fontSize: number,
  fontWeight: 'normal' | 'bold',
  y: number,
  pageHeightPt: number,
  lineCount: number
): {
  type: ElementType;
  subtype: ObjectClassification;
  fieldKey?: string;
} {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  if (
    /\b(?:invoice|inv)\b\s*(?:no\.?|num\.?|number|#)?\s*[:#-]?\s*(?=[a-z0-9-]*\d)[a-z0-9-]{2,}/i.test(clean) ||
    /^INV[-_#]?\d+/i.test(clean)
  ) {
    return {
      type: 'invoice_number',
      subtype: 'identifier_field',
      fieldKey: 'invoice_number',
    };
  }
  if (
    /\b(?:receipt|rcpt|rec|slip|ticket)\b\s*(?:no\.?|num\.?|number|#)?\s*[:#-]?\s*(?=[a-z0-9-]*\d)[a-z0-9-]{2,}/i.test(clean) ||
    /^(?:REC|RCPT|RCP)[-_#]?\d+/i.test(clean)
  ) {
    return {
      type: 'receipt_number',
      subtype: 'identifier_field',
      fieldKey: 'receipt_number',
    };
  }
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(clean) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(clean) || /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/i.test(clean)) {
    return { type: 'text', subtype: 'date_field', fieldKey: 'date' };
  }
  if (/^[$€£¥₹]?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?%?$/.test(clean)) {
    return { type: 'text', subtype: 'numeric_field' };
  }
  if (/^#?[A-Z]{1,5}[-_/]?\d{3,}$/.test(clean)) {
    return { type: 'text', subtype: 'identifier_field' };
  }
  if (fontSize >= 14.5 || (fontSize >= 12.5 && fontWeight === 'bold' && y < pageHeightPt * 0.3)) {
    return { type: 'heading', subtype: 'heading' };
  }
  if (lineCount >= 2 && clean.length >= 45) {
    return { type: 'text', subtype: 'paragraph' };
  }
  if (clean.endsWith(':') && clean.length <= 36) {
    return { type: 'text', subtype: 'label' };
  }
  if (lower.startsWith('total') || lower.startsWith('subtotal') || lower.startsWith('tax')) {
    return { type: 'text', subtype: 'label' };
  }
  return { type: 'text', subtype: 'text_run' };
}

/**
 * Pass 2 grouping: joins ONLY tightly adjacent runs on the exact same baseline & font
 * into logical inline text phrases (never merging across table columns or unrelated blocks!).
 */
export function buildTextElementsFromRuns(
  runs: RawTextRun[],
  pageNumber: number,
  pageHeightPt: number
): DocumentElement[] {
  if (runs.length === 0) return [];

  // Sort in reading order: top-to-bottom baseline (bucketed within 3pt), then left-to-right
  const sorted = [...runs].sort((a, b) => {
    const dy = a.baselineY - b.baselineY;
    if (Math.abs(dy) > Math.max(2.5, Math.min(a.fontSize, b.fontSize) * 0.35)) {
      return dy;
    }
    return a.x - b.x;
  });

  const groups: RawTextRun[][] = [];
  for (const run of sorted) {
    const clean = run.text;
    if (!clean.trim()) continue;

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.length > 0) {
      const prev = lastGroup[lastGroup.length - 1];
      const sameAngle = Math.abs(prev.rotation - run.rotation) <= 2;
      const sameBaseline =
        Math.abs(prev.baselineY - run.baselineY) <=
        Math.max(2.4, Math.min(prev.fontSize, run.fontSize) * 0.32);
      const sameFontSize = Math.abs(prev.fontSize - run.fontSize) <= 1.2;
      const sameWeight = prev.fontWeight === run.fontWeight;
      const sameOrigin = prev.sourceOrigin === run.sourceOrigin;
      const gap = run.x - (prev.x + prev.width);
      const maxWordGap = Math.max(8.5, prev.fontSize * 0.92);

      // Never merge a trailing-colon label into its value if separated by >= 6pt
      const prevEndsWithColon = prev.text.trimEnd().endsWith(':') && gap > 5;

      if (
        sameAngle &&
        sameBaseline &&
        sameFontSize &&
        sameWeight &&
        sameOrigin &&
        !prev.hasEOL &&
        !prevEndsWithColon &&
        gap >= -2.5 &&
        gap <= maxWordGap
      ) {
        lastGroup.push(run);
        continue;
      }
    }
    groups.push([run]);
  }

  return groups.map((grp, idx) => {
    const first = grp[0];
    let text = '';
    for (let i = 0; i < grp.length; i++) {
      const cur = grp[i];
      if (i > 0) {
        const prev = grp[i - 1];
        const gap = cur.x - (prev.x + prev.width);
        if (
          gap > Math.max(1.4, cur.fontSize * 0.14) &&
          !prev.text.endsWith(' ') &&
          !cur.text.startsWith(' ')
        ) {
          text += ' ';
        }
      }
      text += cur.text;
    }

    const minX = Math.min(...grp.map((g) => g.x));
    const minY = Math.min(...grp.map((g) => g.y));
    const maxX = Math.max(...grp.map((g) => g.x + g.width));
    const maxY = Math.max(...grp.map((g) => g.y + g.height));
    const width = Math.max(8, maxX - minX);
    const height = Math.max(first.fontSize * 1.15, maxY - minY);
    const avgConf =
      grp.reduce((sum, g) => sum + g.confidence, 0) / Math.max(1, grp.length);
    const sem = classifyTextElementSemantics(
      text,
      first.fontSize,
      first.fontWeight,
      minY,
      pageHeightPt,
      1
    );
    const needsReview = avgConf < 0.72;
    const subtype: ObjectClassification =
      grp.length > 1 && sem.subtype === 'text_run' ? 'text_group' : sem.subtype;

    return {
      id: `el-p${pageNumber}-txt-${idx + 1}`,
      type: sem.type,
      pageNumber,
      x: Number(minX.toFixed(2)),
      y: Number(minY.toFixed(2)),
      width: Number(width.toFixed(2)),
      height: Number(height.toFixed(2)),
      rotation: Number((first.rotation || 0).toFixed(2)),
      text: text.trim(),
      fontFamily: first.fontFamily || 'Helvetica',
      fontSize: Number(first.fontSize.toFixed(2)),
      fontWeight: first.fontWeight,
      fontStyle: first.fontStyle,
      color: first.color || '#111827',
      backgroundColor: 'transparent',
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: Number(avgConf.toFixed(2)),
      confidenceLevel: scoreToConfidenceLevel(avgConf, needsReview),
      needsReview,
      reviewReason: needsReview
        ? first.sourceOrigin === 'scanned_ocr'
          ? 'OCR confidence below 72% — verify recognized characters.'
          : 'Low confidence text extraction — verify geometry or content.'
        : undefined,
      fieldKey: sem.fieldKey,
      sourceOriginalRect: {
        x: Number(minX.toFixed(2)),
        y: Number(minY.toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
      },
      sourceOrigin: first.sourceOrigin,
      objectCategory: 'text',
      objectSubtype: subtype,
      detectionMethod:
        first.sourceOrigin === 'scanned_ocr' ? 'ocr_tesseract' : 'pdf_text',
      originalObjectRef: first.originalObjectRef,
      originalBBox: {
        x: Number(minX.toFixed(2)),
        y: Number(minY.toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
      },
      transformMatrix: first.transformMatrix,
      zOrder: first.zOrder,
      baselineY: Number(first.baselineY.toFixed(2)),
      charSpacingPt: first.charSpacingPt,
      wordSpacingPt: first.wordSpacingPt,
    };
  });
}

/**
 * Classifies extracted raster images (`logo`, `signature_image`, `stamp_image`,
 * `background_image`, `image_mask`, `photograph`, `decorative_image`).
 */
export function buildImageElementsFromPlacements(
  placements: RawImagePlacement[],
  input: RawPageScanInput,
  textElements: DocumentElement[]
): DocumentElement[] {
  const pageArea = Math.max(1, input.widthPt * input.heightPt);

  return placements.map((img, idx) => {
    const resource = input.imageResources[img.resourceId];
    const areaRatio = (img.width * img.height) / pageArea;
    const aspect = img.width / Math.max(1, img.height);

    // Check if native text overlaps significantly on top of a full-page image -> background scan
    const overlappingTexts = textElements.filter((t) =>
      rectsOverlap(
        { x: img.x, y: img.y, width: img.width, height: img.height },
        { x: t.x, y: t.y, width: t.width, height: t.height }
      )
    );

    const nearSigText = textElements.some(
      (t) =>
        /\b(signature|signed|authorized\s*by|sign\s*here)\b/i.test(t.text) &&
        Math.abs(t.y - (img.y + img.height)) <= 36 &&
        Math.abs(t.x - img.x) <= 90
    );

    let subtype: ObjectClassification = 'photograph';
    let elType: ElementType = 'image';
    let isBackground = false;

    if (img.isImageMask) {
      subtype = 'image_mask';
    } else if (areaRatio >= 0.72) {
      subtype = 'background_image';
      isBackground = true;
    } else if (nearSigText || (aspect >= 2.2 && img.height <= 64 && img.y > input.heightPt * 0.45)) {
      subtype = 'signature_image';
      elType = 'signature';
    } else if (img.y < input.heightPt * 0.25 && img.width <= input.widthPt * 0.42 && img.height <= 120) {
      subtype = 'logo';
    } else if (
      img.width <= 130 &&
      img.height <= 130 &&
      Math.abs(aspect - 1) <= 0.45 &&
      img.y > input.heightPt * 0.45 &&
      (img.hasAlpha ||
        (img.width <= 96 && img.height <= 96) ||
        textElements.some(
          (t) =>
            /\b(stamp|seal|approved|paid|certified|official)\b/i.test(t.text) &&
            Math.abs(t.y - (img.y + img.height / 2)) <= 64 &&
            Math.abs(t.x - img.x) <= 110
        ))
    ) {
      subtype = 'stamp_image';
    } else if (overlappingTexts.length >= 2 && areaRatio >= 0.25) {
      subtype = 'decorative_image';
    }

    const effDpi =
      img.width > 0 && img.naturalWidth > 0
        ? Math.round(img.naturalWidth / (img.width / 72))
        : undefined;

    const hasData = Boolean(resource?.dataUrl);
    const conf = hasData ? 0.94 : 0.6;
    const needsReview = !hasData;

    return {
      id: img.id || `el-p${input.pageNumber}-img-${idx + 1}`,
      type: elType,
      pageNumber: input.pageNumber,
      x: Number(img.x.toFixed(2)),
      y: Number(img.y.toFixed(2)),
      width: Number(Math.max(4, img.width).toFixed(2)),
      height: Number(Math.max(4, img.height).toFixed(2)),
      rotation: Number((img.rotation || 0).toFixed(2)),
      text: '',
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#111827',
      backgroundColor: 'transparent',
      align: 'left',
      opacity: 1,
      editable: true,
      locked: isBackground,
      visible: true,
      confidence: conf,
      confidenceLevel: scoreToConfidenceLevel(conf, needsReview),
      needsReview,
      reviewReason: needsReview
        ? 'Embedded image resource could not be decoded into pixels.'
        : undefined,
      imageDataUrl: resource?.dataUrl,
      imageNaturalWidth: img.naturalWidth || resource?.naturalWidth,
      imageNaturalHeight: img.naturalHeight || resource?.naturalHeight,
      imageResourceId: img.resourceId,
      effectiveDpi: effDpi,
      isBackgroundImage: isBackground,
      sourceOriginalRect: {
        x: Number(img.x.toFixed(2)),
        y: Number(img.y.toFixed(2)),
        width: Number(Math.max(4, img.width).toFixed(2)),
        height: Number(Math.max(4, img.height).toFixed(2)),
      },
      sourceOrigin: 'original_pdf',
      objectCategory: 'image',
      objectSubtype: subtype,
      detectionMethod: 'pdf_xobject',
      originalObjectRef: img.originalObjectRef || img.sourceXObjectName,
      originalBBox: {
        x: Number(img.x.toFixed(2)),
        y: Number(img.y.toFixed(2)),
        width: Number(Math.max(4, img.width).toFixed(2)),
        height: Number(Math.max(4, img.height).toFixed(2)),
      },
      transformMatrix: img.transformMatrix,
      zOrder: img.zOrder,
    };
  });
}

/**
 * Converts inspected AcroForm widgets & non-widget PDF annotations into editable elements.
 */
export function buildFormAndAnnotationElements(
  input: RawPageScanInput
): DocumentElement[] {
  const out: DocumentElement[] = [];

  for (const w of input.formWidgets) {
    out.push({
      id: w.id,
      type: 'form_field',
      pageNumber: input.pageNumber,
      x: w.rect.x,
      y: w.rect.y,
      width: w.rect.width,
      height: w.rect.height,
      rotation: 0,
      text: w.value || w.name,
      fontFamily: 'Helvetica',
      fontSize: Math.max(8, Math.min(12, w.rect.height * 0.65)),
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#111827',
      backgroundColor: '#FFFFFF',
      borderColor: '#4B5563',
      borderWidth: 1,
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: 0.96,
      confidenceLevel: 'high',
      needsReview: false,
      fieldKey: w.name,
      sourceOrigin: 'original_pdf',
      objectCategory: 'form',
      objectSubtype: w.kind,
      detectionMethod: 'pdf_form',
      formFieldKind: w.kind,
      formFieldName: w.name,
      formFieldValue: w.value,
      formOptions: w.options,
      formChecked: w.checked,
      originalBBox: { ...w.rect },
      sourceOriginalRect: { ...w.rect },
    });
  }

  let annotIdx = 0;
  for (const a of input.annotations) {
    if (a.isWidget) continue;
    annotIdx++;
    const lowerSub = a.subtype.toLowerCase();
    const kind: DocumentElement['annotationKind'] =
      lowerSub === 'highlight'
        ? 'highlight'
        : lowerSub === 'underline'
        ? 'underline'
        : lowerSub === 'strikeout'
        ? 'strikeout'
        : lowerSub === 'circle'
        ? 'ellipse'
        : lowerSub === 'square'
        ? 'rect'
        : lowerSub === 'freetext'
        ? 'free_text'
        : 'note';

    out.push({
      id: `annot-p${input.pageNumber}-${annotIdx}`,
      type: 'annotation',
      pageNumber: input.pageNumber,
      x: a.rect.x,
      y: a.rect.y,
      width: a.rect.width,
      height: a.rect.height,
      rotation: 0,
      text: a.contents || '',
      commentText: a.contents || '',
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#111827',
      backgroundColor: 'transparent',
      borderWidth: 1,
      align: 'left',
      opacity: 0.85,
      editable: true,
      locked: false,
      visible: true,
      confidence: 0.92,
      confidenceLevel: 'high',
      needsReview: false,
      annotationKind: kind,
      sourceOrigin: 'annotation',
      objectCategory: 'structural',
      objectSubtype: 'section',
      detectionMethod: 'pdf_annotation',
      originalBBox: { ...a.rect },
      sourceOriginalRect: { ...a.rect },
    });
  }

  return out;
}
