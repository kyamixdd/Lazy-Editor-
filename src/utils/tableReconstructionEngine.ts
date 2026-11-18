import {
  DocumentElement,
  RectPt,
  TableElementData,
  TableMergedCell,
} from '../types/pdfStudio';
import {
  AnalyzedLineSegment,
  scoreToConfidenceLevel,
} from './geometryClassifier';
import { SpatialBBoxIndex } from './spatialIndex';

export interface TableReconstructionResult {
  tables: DocumentElement[];
  consumedTextIds: Set<string>;
}

function clusterValues(vals: number[], tol = 3.2): number[] {
  if (vals.length === 0) return [];
  const sorted = [...vals].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = clusters[clusters.length - 1];
    const avg = last.reduce((s, v) => s + v, 0) / last.length;
    if (Math.abs(cur - avg) <= tol) {
      last.push(cur);
    } else {
      clusters.push([cur]);
    }
  }
  return clusters.map((c) => Number((c.reduce((s, v) => s + v, 0) / c.length).toFixed(2)));
}

function segmentCoversSpan(
  segStart: number,
  segEnd: number,
  spanStart: number,
  spanEnd: number,
  tol = 4
): boolean {
  const overlapStart = Math.max(segStart, spanStart);
  const overlapEnd = Math.min(segEnd, spanEnd);
  const spanLen = Math.max(1, spanEnd - spanStart);
  return overlapEnd - overlapStart >= spanLen * 0.68 || (segStart <= spanStart + tol && segEnd >= spanEnd - tol);
}

function hasHorizontalDivider(
  horizLines: AnalyzedLineSegment[],
  y: number,
  x1: number,
  x2: number,
  tol = 3.5
): boolean {
  return horizLines.some(
    (h) => Math.abs(h.y1 - y) <= tol && segmentCoversSpan(h.x1, h.x2, x1, x2, tol)
  );
}

function hasVerticalDivider(
  vertLines: AnalyzedLineSegment[],
  x: number,
  y1: number,
  y2: number,
  tol = 3.5
): boolean {
  return vertLines.some(
    (v) => Math.abs(v.x1 - x) <= tol && segmentCoversSpan(v.y1, v.y2, y1, y2, tol)
  );
}

function inferColumnEdgesFromTexts(
  texts: DocumentElement[],
  minX: number,
  maxX: number
): number[] {
  if (texts.length < 2) return [minX, maxX];
  // Cluster text left X positions when gaps separate distinct columns
  const xs = clusterValues(
    texts.map((t) => t.x),
    12
  );
  const filtered: number[] = [];
  for (const x of xs) {
    if (x > minX + 12 && x < maxX - 12) {
      filtered.push(x - 4);
    }
  }
  return clusterValues([minX, ...filtered, maxX], 8);
}

function inferRowEdgesFromTexts(
  texts: DocumentElement[],
  minY: number,
  maxY: number
): number[] {
  if (texts.length < 2) return [minY, maxY];
  const rowYs = clusterValues(
    texts.map((t) => t.y),
    5
  );
  if (rowYs.length < 2) return [minY, maxY];
  const edges: number[] = [minY];
  for (let i = 1; i < rowYs.length; i++) {
    const mid = (rowYs[i - 1] + rowYs[i]) / 2 + 4;
    if (mid > minY + 6 && mid < maxY - 6) {
      edges.push(Number(mid.toFixed(2)));
    }
  }
  edges.push(maxY);
  return clusterValues(edges, 5);
}

function assignTextsToGrid(
  texts: DocumentElement[],
  xCoords: number[],
  yCoords: number[],
  mergedCells: TableMergedCell[]
): string[][] {
  const rowCount = yCoords.length - 1;
  const colCount = xCoords.length - 1;
  const buckets: DocumentElement[][][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: colCount }, () => [])
  );

  // Map every (r, c) to its anchor cell if inside a merged cell
  const anchorMap = new Map<string, { r: number; c: number }>();
  for (const m of mergedCells) {
    for (let rr = m.row; rr < Math.min(rowCount, m.row + m.rowSpan); rr++) {
      for (let cc = m.col; cc < Math.min(colCount, m.col + m.colSpan); cc++) {
        anchorMap.set(`${rr}:${cc}`, { r: m.row, c: m.col });
      }
    }
  }

  for (const t of texts) {
    const cx = t.x + Math.min(t.width / 2, 16);
    const cy = t.y + t.height / 2;
    let rIdx = rowCount - 1;
    for (let r = 0; r < rowCount; r++) {
      if (cy >= yCoords[r] - 3 && cy <= yCoords[r + 1] + 3) {
        rIdx = r;
        break;
      }
    }
    let cIdx = colCount - 1;
    for (let c = 0; c < colCount; c++) {
      if (cx >= xCoords[c] - 3 && cx <= xCoords[c + 1] + 3) {
        cIdx = c;
        break;
      }
    }
    const anchor = anchorMap.get(`${rIdx}:${cIdx}`) || { r: rIdx, c: cIdx };
    buckets[anchor.r][anchor.c].push(t);
  }

  return buckets.map((row) =>
    row.map((cellTexts) => {
      if (cellTexts.length === 0) return '';
      const sorted = [...cellTexts].sort((a, b) => {
        if (Math.abs(a.y - b.y) > 4) return a.y - b.y;
        return a.x - b.x;
      });
      const lines: string[] = [];
      let curLine = sorted[0].text;
      let curY = sorted[0].y;
      for (let i = 1; i < sorted.length; i++) {
        const item = sorted[i];
        if (Math.abs(item.y - curY) <= Math.max(3, item.fontSize * 0.45)) {
          curLine += ' ' + item.text;
        } else {
          lines.push(curLine.trim());
          curLine = item.text;
          curY = item.y;
        }
      }
      if (curLine.trim()) lines.push(curLine.trim());
      return lines.join('\n');
    })
  );
}

/**
 * Part 4: Intelligent Table Reconstruction Engine
 * 1. Detects fully bordered & partially bordered tables from intersecting horizontal/vertical lines
 *    (handling irregular column widths, variable row heights, multiline cells, and merged cells).
 * 2. Detects borderless tables from consistent row/column text alignment across >= 3 rows.
 */
export function reconstructTablesOnPage(
  lineSegments: AnalyzedLineSegment[],
  textElements: DocumentElement[],
  vectorElements: DocumentElement[],
  pageNumber: number
): TableReconstructionResult {
  const tables: DocumentElement[] = [];
  const consumedTextIds = new Set<string>();
  const textIndex = new SpatialBBoxIndex<DocumentElement>(36);
  textIndex.insertAll(textElements);

  const horiz = lineSegments.filter(
    (l) => !l.claimedByTableId && l.orientation === 'horizontal' && l.x2 - l.x1 >= 14
  );
  const vert = lineSegments.filter(
    (l) => !l.claimedByTableId && l.orientation === 'vertical' && l.y2 - l.y1 >= 12
  );

  // Build connected components of intersecting horizontal & vertical lines
  const tol = 3.5;
  const hAdj = new Map<string, Set<string>>();
  const vAdj = new Map<string, Set<string>>();
  for (const h of horiz) {
    for (const v of vert) {
      const xIntersects = v.x1 >= h.x1 - tol && v.x1 <= h.x2 + tol;
      const yIntersects = h.y1 >= v.y1 - tol && h.y1 <= v.y2 + tol;
      if (xIntersects && yIntersects) {
        if (!hAdj.has(h.id)) hAdj.set(h.id, new Set());
        if (!vAdj.has(v.id)) vAdj.set(v.id, new Set());
        hAdj.get(h.id)!.add(v.id);
        vAdj.get(v.id)!.add(h.id);
      }
    }
  }

  const visitedH = new Set<string>();
  const visitedV = new Set<string>();

  for (const hStart of horiz) {
    if (visitedH.has(hStart.id) || !hAdj.has(hStart.id)) continue;

    const compH: AnalyzedLineSegment[] = [];
    const compV: AnalyzedLineSegment[] = [];
    const q: Array<{ kind: 'h' | 'v'; id: string }> = [{ kind: 'h', id: hStart.id }];
    visitedH.add(hStart.id);

    while (q.length > 0) {
      const cur = q.shift()!;
      if (cur.kind === 'h') {
        const hSeg = horiz.find((x) => x.id === cur.id);
        if (hSeg) compH.push(hSeg);
        for (const vId of hAdj.get(cur.id) || []) {
          if (!visitedV.has(vId)) {
            visitedV.add(vId);
            q.push({ kind: 'v', id: vId });
          }
        }
      } else {
        const vSeg = vert.find((x) => x.id === cur.id);
        if (vSeg) compV.push(vSeg);
        for (const hId of vAdj.get(cur.id) || []) {
          if (!visitedH.has(hId)) {
            visitedH.add(hId);
            q.push({ kind: 'h', id: hId });
          }
        }
      }
    }

    let yCoords = clusterValues(
      [...compH.map((h) => h.y1), ...compV.flatMap((v) => [v.y1, v.y2])],
      3.5
    );
    let xCoords = clusterValues(
      [...compV.map((v) => v.x1), ...compH.flatMap((h) => [h.x1, h.x2])],
      3.5
    );

    if (xCoords.length < 2 || yCoords.length < 2) continue;

    // A 1x1 box with only 4 perimeter lines is a rectangle/border, NOT a table!
    if (xCoords.length === 2 && yCoords.length === 2) continue;

    const tableRect: RectPt = {
      x: xCoords[0],
      y: yCoords[0],
      width: xCoords[xCoords.length - 1] - xCoords[0],
      height: yCoords[yCoords.length - 1] - yCoords[0],
    };
    if (tableRect.width < 30 || tableRect.height < 20) continue;

    const insideTexts = textIndex.queryContained(tableRect, 5).filter((t) => !consumedTextIds.has(t.id));

    // Partial border recovery: if only rows or only cols were drawn as lines, infer missing axis from texts
    let isPartial = false;
    if (xCoords.length === 2 && yCoords.length >= 3 && insideTexts.length >= 4) {
      const inferredX = inferColumnEdgesFromTexts(insideTexts, tableRect.x, tableRect.x + tableRect.width);
      if (inferredX.length >= 3) {
        xCoords = inferredX;
        isPartial = true;
      }
    }
    if (yCoords.length === 2 && xCoords.length >= 3 && insideTexts.length >= 4) {
      const inferredY = inferRowEdgesFromTexts(insideTexts, tableRect.y, tableRect.y + tableRect.height);
      if (inferredY.length >= 3) {
        yCoords = inferredY;
        isPartial = true;
      }
    }

    const rowCount = yCoords.length - 1;
    const colCount = xCoords.length - 1;
    if (rowCount < 1 || colCount < 2 || (rowCount === 1 && colCount < 2)) continue;
    if (rowCount === 1 && colCount === 1) continue;

    // Detect merged cells by checking missing internal grid borders
    const mergedCells: TableMergedCell[] = [];
    const covered = Array.from({ length: rowCount }, () => Array<boolean>(colCount).fill(false));

    if (!isPartial && compH.length >= 2 && compV.length >= 2) {
      for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < colCount; c++) {
          if (covered[r][c]) continue;
          let colSpan = 1;
          while (
            c + colSpan < colCount &&
            !hasVerticalDivider(
              compV,
              xCoords[c + colSpan],
              yCoords[r],
              yCoords[r + 1],
              4
            )
          ) {
            colSpan++;
          }

          let rowSpan = 1;
          while (r + rowSpan < rowCount) {
            // Bottom boundary across [c .. c + colSpan] must be missing
            let hasBoundary = false;
            for (let cc = c; cc < c + colSpan; cc++) {
              if (
                hasHorizontalDivider(
                  compH,
                  yCoords[r + rowSpan],
                  xCoords[cc],
                  xCoords[cc + 1],
                  4
                )
              ) {
                hasBoundary = true;
                break;
              }
            }
            if (hasBoundary) break;
            rowSpan++;
          }

          if (colSpan > 1 || rowSpan > 1) {
            mergedCells.push({ row: r, col: c, rowSpan, colSpan });
          }
          for (let rr = r; rr < r + rowSpan; rr++) {
            for (let cc = c; cc < c + colSpan; cc++) {
              covered[rr][cc] = true;
            }
          }
        }
      }
    }

    const rows = assignTextsToGrid(insideTexts, xCoords, yCoords, mergedCells);
    const colWidthsPt = Array.from({ length: colCount }, (_, c) =>
      Number((xCoords[c + 1] - xCoords[c]).toFixed(2))
    );
    const rowHeightsPt = Array.from({ length: rowCount }, (_, r) =>
      Number((yCoords[r + 1] - yCoords[r]).toFixed(2))
    );

    // Check if header row has a filled background shape in vectorElements
    const headerRectBg = vectorElements.find(
      (v) =>
        v.fillColor &&
        v.fillColor !== 'transparent' &&
        v.fillColor.toLowerCase() !== '#ffffff' &&
        Math.abs(v.y - tableRect.y) <= 6 &&
        Math.abs(v.width - tableRect.width) <= 12 &&
        v.height <= rowHeightsPt[0] + 8
    );

    const tableId = `el-p${pageNumber}-table-${tables.length + 1}`;
    const borderElementIds: string[] = [];
    for (const h of compH) {
      h.claimedByTableId = tableId;
      h.lineRole = 'table_border';
      borderElementIds.push(h.id);
    }
    for (const v of compV) {
      v.claimedByTableId = tableId;
      v.lineRole = 'table_border';
      borderElementIds.push(v.id);
    }
    for (const t of insideTexts) {
      consumedTextIds.add(t.id);
    }

    const firstText = insideTexts[0];
    const conf = isPartial ? 0.84 : 0.94;
    tables.push({
      id: tableId,
      type: 'table',
      pageNumber,
      x: Number(tableRect.x.toFixed(2)),
      y: Number(tableRect.y.toFixed(2)),
      width: Number(tableRect.width.toFixed(2)),
      height: Number(tableRect.height.toFixed(2)),
      rotation: 0,
      text: `Table (${rowCount}×${colCount})`,
      fontFamily: firstText?.fontFamily || 'Helvetica',
      fontSize: firstText?.fontSize || 9.5,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: firstText?.color || '#111827',
      backgroundColor: 'transparent',
      borderColor: compH[0]?.strokeColor || '#374151',
      borderWidth: compH[0]?.strokeWidth || 0.8,
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: conf,
      confidenceLevel: scoreToConfidenceLevel(conf),
      needsReview: isPartial && insideTexts.length === 0,
      childIds: borderElementIds,
      tableData: {
        rows,
        headerRow: rowCount >= 2,
        borderColor: compH[0]?.strokeColor || '#374151',
        headerBgColor: headerRectBg?.fillColor || '#F3F4F6',
        cellPadding: 4,
        colWidthsPt,
        rowHeightsPt,
        mergedCells: mergedCells.length > 0 ? mergedCells : undefined,
        hasBorders: true,
        detectionBasis: isPartial ? 'partial' : 'bordered',
        borderElementIds,
        borderWidthPt: compH[0]?.strokeWidth || 0.8,
      },
      sourceOriginalRect: {
        x: Number(tableRect.x.toFixed(2)),
        y: Number(tableRect.y.toFixed(2)),
        width: Number(tableRect.width.toFixed(2)),
        height: Number(tableRect.height.toFixed(2)),
      },
      sourceOrigin: 'original_pdf',
      objectCategory: 'structural',
      objectSubtype: 'table',
      detectionMethod: 'table_grid',
      relationshipNote: `${isPartial ? 'Partially bordered' : 'Bordered'} ${rowCount}×${colCount} table${
        mergedCells.length ? ` (${mergedCells.length} merged cells)` : ''
      }`,
      originalBBox: { ...tableRect },
    });
  }

  // Pass B: Detect horizontal-only line tables (common in invoices: header rules + row dividers without vertical lines)
  const remainingHoriz = horiz.filter((h) => !h.claimedByTableId);
  if (remainingHoriz.length >= 2) {
    // Group horizontal lines that share left/right span within 12pt
    const usedH = new Set<string>();
    for (let i = 0; i < remainingHoriz.length; i++) {
      const seed = remainingHoriz[i];
      if (usedH.has(seed.id)) continue;
      const spanW = seed.x2 - seed.x1;
      if (spanW < 120) continue;

      const groupH = remainingHoriz
        .filter(
          (h) =>
            !usedH.has(h.id) &&
            Math.abs(h.x1 - seed.x1) <= 14 &&
            Math.abs(h.x2 - seed.x2) <= 14
        )
        .sort((a, b) => a.y1 - b.y1);

      if (groupH.length < 2) continue;

      const minX = Math.min(...groupH.map((h) => h.x1));
      const maxX = Math.max(...groupH.map((h) => h.x2));
      const minY = groupH[0].y1 - 18;
      const maxY = groupH[groupH.length - 1].y1 + 24;

      const regionTexts = textIndex
        .queryContained({ x: minX - 4, y: minY, width: maxX - minX + 8, height: maxY - minY }, 4)
        .filter((t) => !consumedTextIds.has(t.id));

      if (regionTexts.length < 4) continue;
      const xCols = inferColumnEdgesFromTexts(regionTexts, minX, maxX);
      const yRows =
        groupH.length >= 3
          ? clusterValues(
              [
                Math.min(...regionTexts.map((t) => t.y)) - 2,
                ...groupH.map((h) => h.y1),
                Math.max(...regionTexts.map((t) => t.y + t.height)) + 4,
              ],
              6
            )
          : inferRowEdgesFromTexts(
              regionTexts,
              Math.min(...regionTexts.map((t) => t.y)) - 2,
              Math.max(...regionTexts.map((t) => t.y + t.height)) + 4
            );

      const rowCount = yRows.length - 1;
      const colCount = xCols.length - 1;
      if (rowCount < 2 || colCount < 2) continue;

      const tableRect: RectPt = {
        x: xCols[0],
        y: yRows[0],
        width: xCols[xCols.length - 1] - xCols[0],
        height: yRows[yRows.length - 1] - yRows[0],
      };
      const rows = assignTextsToGrid(regionTexts, xCols, yRows, []);
      const tableId = `el-p${pageNumber}-table-${tables.length + 1}`;
      for (const h of groupH) {
        usedH.add(h.id);
        h.claimedByTableId = tableId;
        h.lineRole = 'table_border';
      }
      for (const t of regionTexts) {
        consumedTextIds.add(t.id);
      }

      tables.push({
        id: tableId,
        type: 'table',
        pageNumber,
        x: Number(tableRect.x.toFixed(2)),
        y: Number(tableRect.y.toFixed(2)),
        width: Number(tableRect.width.toFixed(2)),
        height: Number(tableRect.height.toFixed(2)),
        rotation: 0,
        text: `Table (${rowCount}×${colCount})`,
        fontFamily: regionTexts[0]?.fontFamily || 'Helvetica',
        fontSize: regionTexts[0]?.fontSize || 9.5,
        fontWeight: 'normal',
        fontStyle: 'normal',
        color: regionTexts[0]?.color || '#111827',
        backgroundColor: 'transparent',
        borderColor: groupH[0].strokeColor || '#374151',
        borderWidth: groupH[0].strokeWidth || 0.7,
        align: 'left',
        opacity: 1,
        editable: true,
        locked: false,
        visible: true,
        confidence: 0.85,
        confidenceLevel: 'high',
        needsReview: false,
        childIds: groupH.map((h) => h.id),
        tableData: {
          rows,
          headerRow: true,
          borderColor: groupH[0].strokeColor || '#374151',
          headerBgColor: '#F3F4F6',
          cellPadding: 4,
          colWidthsPt: Array.from({ length: colCount }, (_, c) =>
            Number((xCols[c + 1] - xCols[c]).toFixed(2))
          ),
          rowHeightsPt: Array.from({ length: rowCount }, (_, r) =>
            Number((yRows[r + 1] - yRows[r]).toFixed(2))
          ),
          hasBorders: true,
          detectionBasis: 'partial',
          borderElementIds: groupH.map((h) => h.id),
          borderWidthPt: groupH[0].strokeWidth || 0.7,
        },
        sourceOriginalRect: { ...tableRect },
        sourceOrigin: 'original_pdf',
        objectCategory: 'structural',
        objectSubtype: 'table',
        detectionMethod: 'table_grid',
        relationshipNote: `Partially bordered ${rowCount}×${colCount} table (row dividers + aligned columns)`,
        originalBBox: { ...tableRect },
      });
    }
  }

  // Pass C: Borderless table detection from consistent aligned rows & columns
  const remainingTexts = textElements
    .filter((t) => !consumedTextIds.has(t.id) && t.rotation === 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const baselineRows: DocumentElement[][] = [];
  for (const t of remainingTexts) {
    const last = baselineRows[baselineRows.length - 1];
    if (last && Math.abs(last[0].y - t.y) <= 4.5) {
      last.push(t);
    } else {
      baselineRows.push([t]);
    }
  }

  let runStart = 0;
  while (runStart < baselineRows.length) {
    if (baselineRows[runStart].length < 2) {
      runStart++;
      continue;
    }
    let runEnd = runStart;
    while (runEnd + 1 < baselineRows.length) {
      const curRow = baselineRows[runEnd];
      const nextRow = baselineRows[runEnd + 1];
      const rowGap = nextRow[0].y - curRow[0].y;
      if (nextRow.length < 2 || rowGap > 34) break;
      runEnd++;
    }

    const rowSpanCount = runEnd - runStart + 1;
    if (rowSpanCount >= 3) {
      const candidateRows = baselineRows.slice(runStart, runEnd + 1);
      const flatTexts = candidateRows.flat();
      const minX = Math.min(...flatTexts.map((t) => t.x));
      const maxX = Math.max(...flatTexts.map((t) => t.x + t.width));
      const minY = Math.min(...flatTexts.map((t) => t.y));
      const maxY = Math.max(...flatTexts.map((t) => t.y + t.height));

      const xCols = inferColumnEdgesFromTexts(flatTexts, minX, maxX);
      const colCount = xCols.length - 1;
      if (colCount >= 2) {
        const yRows = inferRowEdgesFromTexts(flatTexts, minY, maxY);
        const rowCount = yRows.length - 1;
        if (rowCount >= 3) {
          const rows = assignTextsToGrid(flatTexts, xCols, yRows, []);
          // Verify high column occupancy across rows so random label pairs aren't misgrouped
          const populatedCells = rows.flat().filter((c) => c.trim().length > 0).length;
          const occupancy = populatedCells / Math.max(1, rowCount * colCount);
          if (occupancy >= 0.55) {
            const tableRect: RectPt = {
              x: Number(minX.toFixed(2)),
              y: Number(minY.toFixed(2)),
              width: Number((maxX - minX).toFixed(2)),
              height: Number((maxY - minY).toFixed(2)),
            };
            const tableId = `el-p${pageNumber}-table-${tables.length + 1}`;
            for (const t of flatTexts) consumedTextIds.add(t.id);

            tables.push({
              id: tableId,
              type: 'table',
              pageNumber,
              x: tableRect.x,
              y: tableRect.y,
              width: tableRect.width,
              height: tableRect.height,
              rotation: 0,
              text: `Borderless Table (${rowCount}×${colCount})`,
              fontFamily: flatTexts[0].fontFamily || 'Helvetica',
              fontSize: flatTexts[0].fontSize || 9.5,
              fontWeight: 'normal',
              fontStyle: 'normal',
              color: flatTexts[0].color || '#111827',
              backgroundColor: 'transparent',
              borderColor: '#9CA3AF',
              borderWidth: 0,
              align: 'left',
              opacity: 1,
              editable: true,
              locked: false,
              visible: true,
              confidence: 0.78,
              confidenceLevel: 'medium',
              needsReview: false,
              tableData: {
                rows,
                headerRow: true,
                borderColor: '#9CA3AF',
                headerBgColor: '#F3F4F6',
                cellPadding: 4,
                colWidthsPt: Array.from({ length: colCount }, (_, c) =>
                  Number((xCols[c + 1] - xCols[c]).toFixed(2))
                ),
                rowHeightsPt: Array.from({ length: rowCount }, (_, r) =>
                  Number((yRows[r + 1] - yRows[r]).toFixed(2))
                ),
                hasBorders: false,
                detectionBasis: 'borderless',
                borderWidthPt: 0,
              },
              sourceOriginalRect: { ...tableRect },
              sourceOrigin: 'original_pdf',
              objectCategory: 'structural',
              objectSubtype: 'table',
              detectionMethod: 'geometric_inference',
              relationshipNote: `Borderless ${rowCount}×${colCount} table inferred from column alignment`,
              originalBBox: { ...tableRect },
            });
          }
        }
      }
    }
    runStart = runEnd + 1;
  }

  return { tables, consumedTextIds };
}

/**
 * Converts a user-selected group of elements into an editable structured table element.
 */
export function convertSelectionToTableElement(
  selectedElements: DocumentElement[],
  pageNumber: number
): DocumentElement | null {
  const texts = selectedElements.filter(
    (e) =>
      e.pageNumber === pageNumber &&
      e.type !== 'table' &&
      e.type !== 'repeated_block' &&
      (e.text || '').trim().length > 0
  );
  const all = selectedElements.filter((e) => e.pageNumber === pageNumber);
  if (all.length === 0) return null;

  const minX = Math.min(...all.map((e) => e.x));
  const minY = Math.min(...all.map((e) => e.y));
  const maxX = Math.max(...all.map((e) => e.x + e.width));
  const maxY = Math.max(...all.map((e) => e.y + e.height));

  const xCols =
    texts.length >= 2
      ? inferColumnEdgesFromTexts(texts, minX, maxX)
      : [minX, minX + (maxX - minX) / 2, maxX];
  const yRows =
    texts.length >= 2
      ? inferRowEdgesFromTexts(texts, minY, maxY)
      : [minY, minY + (maxY - minY) / 2, maxY];

  const colCount = Math.max(1, xCols.length - 1);
  const rowCount = Math.max(1, yRows.length - 1);
  const rows = assignTextsToGrid(texts, xCols, yRows, []);
  const firstText = texts[0] || all[0];

  return {
    id: `el-p${pageNumber}-tbl-manual-${Date.now().toString(36)}`,
    type: 'table',
    pageNumber,
    x: Number(minX.toFixed(2)),
    y: Number(minY.toFixed(2)),
    width: Number(Math.max(40, maxX - minX).toFixed(2)),
    height: Number(Math.max(24, maxY - minY).toFixed(2)),
    rotation: 0,
    text: `Table (${rowCount}×${colCount})`,
    fontFamily: firstText.fontFamily || 'Helvetica',
    fontSize: firstText.fontSize || 10,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: firstText.color || '#111827',
    backgroundColor: 'transparent',
    borderColor: '#374151',
    borderWidth: 0.8,
    align: 'left',
    opacity: 1,
    editable: true,
    locked: false,
    visible: true,
    confidence: 1,
    confidenceLevel: 'high',
    needsReview: false,
    isUserAdded: true,
    sourceOrigin: 'user_overlay',
    objectCategory: 'structural',
    objectSubtype: 'table',
    detectionMethod: 'user_manual',
    tableData: {
      rows,
      headerRow: rowCount >= 2,
      borderColor: '#374151',
      headerBgColor: '#F3F4F6',
      cellPadding: 4,
      colWidthsPt: Array.from({ length: colCount }, (_, c) =>
        Number((xCols[c + 1] - xCols[c]).toFixed(2))
      ),
      rowHeightsPt: Array.from({ length: rowCount }, (_, r) =>
        Number((yRows[r + 1] - yRows[r]).toFixed(2))
      ),
      hasBorders: true,
      detectionBasis: 'manual',
      borderWidthPt: 0.8,
    },
  };
}

export function mergeTableCellRange(
  tableData: TableElementData,
  r1: number,
  c1: number,
  r2: number,
  c2: number
): TableElementData {
  const rowStart = Math.max(0, Math.min(r1, r2));
  const rowEnd = Math.min(tableData.rows.length - 1, Math.max(r1, r2));
  const colStart = Math.max(0, Math.min(c1, c2));
  const colEnd = Math.min((tableData.rows[0]?.length || 1) - 1, Math.max(c1, c2));
  const rowSpan = rowEnd - rowStart + 1;
  const colSpan = colEnd - colStart + 1;
  if (rowSpan <= 1 && colSpan <= 1) return tableData;

  const nextRows = tableData.rows.map((r) => [...r]);
  const combinedParts: string[] = [];
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      const val = (nextRows[r][c] || '').trim();
      if (val) combinedParts.push(val);
      if (r !== rowStart || c !== colStart) nextRows[r][c] = '';
    }
  }
  nextRows[rowStart][colStart] = combinedParts.join(' ');

  const existing = (tableData.mergedCells || []).filter(
    (m) =>
      m.row + m.rowSpan - 1 < rowStart ||
      m.row > rowEnd ||
      m.col + m.colSpan - 1 < colStart ||
      m.col > colEnd
  );

  return {
    ...tableData,
    rows: nextRows,
    mergedCells: [...existing, { row: rowStart, col: colStart, rowSpan, colSpan }],
  };
}

export function splitMergedTableCell(
  tableData: TableElementData,
  row: number,
  col: number
): TableElementData {
  const existing = tableData.mergedCells || [];
  const nextMerged = existing.filter(
    (m) =>
      !(
        row >= m.row &&
        row < m.row + m.rowSpan &&
        col >= m.col &&
        col < m.col + m.colSpan
      )
  );
  return {
    ...tableData,
    mergedCells: nextMerged.length > 0 ? nextMerged : undefined,
  };
}
