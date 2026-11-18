import { DocumentElement, RectPt } from '../types/pdfStudio';

export type AlignMode =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom';

export interface SmartGuideLine {
  orientation: 'v' | 'h';
  pos: number;
  start: number;
  end: number;
  kind: 'align' | 'spacing';
  label?: string;
}

export function alignSelectedElements(
  allElements: DocumentElement[],
  selectedIds: string[],
  mode: AlignMode
): Array<{ id: string; patch: Partial<DocumentElement> }> {
  const sel = allElements.filter(
    (el) => selectedIds.includes(el.id) && !el.locked
  );
  if (sel.length < 2) return [];

  const minX = Math.min(...sel.map((e) => e.x));
  const maxX = Math.max(...sel.map((e) => e.x + e.width));
  const minY = Math.min(...sel.map((e) => e.y));
  const maxY = Math.max(...sel.map((e) => e.y + e.height));
  const centerX = (minX + maxX) / 2;
  const middleY = (minY + maxY) / 2;

  return sel.map((el) => {
    let x = el.x;
    let y = el.y;
    switch (mode) {
      case 'left':
        x = minX;
        break;
      case 'center':
        x = centerX - el.width / 2;
        break;
      case 'right':
        x = maxX - el.width;
        break;
      case 'top':
        y = minY;
        break;
      case 'middle':
        y = middleY - el.height / 2;
        break;
      case 'bottom':
        y = maxY - el.height;
        break;
    }
    return {
      id: el.id,
      patch: {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        eraseOriginal: el.isUserAdded ? false : true,
      },
    };
  });
}

export function distributeSelectedElements(
  allElements: DocumentElement[],
  selectedIds: string[],
  axis: 'horizontal' | 'vertical'
): Array<{ id: string; patch: Partial<DocumentElement> }> {
  const sel = allElements.filter(
    (el) => selectedIds.includes(el.id) && !el.locked
  );
  if (sel.length < 3) return [];

  if (axis === 'horizontal') {
    const sorted = [...sel].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalElWidths = sorted.reduce((acc, el) => acc + el.width, 0);
    const span = last.x + last.width - first.x;
    const gap = (span - totalElWidths) / (sorted.length - 1);

    let cursor = first.x;
    return sorted.map((el) => {
      const nextX = cursor;
      cursor += el.width + gap;
      return {
        id: el.id,
        patch: {
          x: Number(nextX.toFixed(2)),
          eraseOriginal: el.isUserAdded ? false : true,
        },
      };
    });
  } else {
    const sorted = [...sel].sort((a, b) => a.y - b.y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalElHeights = sorted.reduce((acc, el) => acc + el.height, 0);
    const span = last.y + last.height - first.y;
    const gap = (span - totalElHeights) / (sorted.length - 1);

    let cursor = first.y;
    return sorted.map((el) => {
      const nextY = cursor;
      cursor += el.height + gap;
      return {
        id: el.id,
        patch: {
          y: Number(nextY.toFixed(2)),
          eraseOriginal: el.isUserAdded ? false : true,
        },
      };
    });
  }
}

export function equalSpacingSelectedElements(
  allElements: DocumentElement[],
  selectedIds: string[],
  axis: 'horizontal' | 'vertical',
  explicitGapPt?: number
): Array<{ id: string; patch: Partial<DocumentElement> }> {
  const sel = allElements.filter(
    (el) => selectedIds.includes(el.id) && !el.locked
  );
  if (sel.length < 2) return [];

  if (axis === 'horizontal') {
    const sorted = [...sel].sort((a, b) => a.x - b.x);
    let gap = explicitGapPt;
    if (gap === undefined) {
      if (sorted.length === 2) {
        gap = Math.max(0, sorted[1].x - (sorted[0].x + sorted[0].width));
      } else {
        const span =
          sorted[sorted.length - 1].x +
          sorted[sorted.length - 1].width -
          sorted[0].x;
        const sumW = sorted.reduce((s, e) => s + e.width, 0);
        gap = Math.max(0, (span - sumW) / (sorted.length - 1));
      }
    }
    let cursor = sorted[0].x;
    return sorted.map((el) => {
      const x = cursor;
      cursor += el.width + gap!;
      return {
        id: el.id,
        patch: {
          x: Number(x.toFixed(2)),
          eraseOriginal: el.isUserAdded ? false : true,
        },
      };
    });
  } else {
    const sorted = [...sel].sort((a, b) => a.y - b.y);
    let gap = explicitGapPt;
    if (gap === undefined) {
      if (sorted.length === 2) {
        gap = Math.max(0, sorted[1].y - (sorted[0].y + sorted[0].height));
      } else {
        const span =
          sorted[sorted.length - 1].y +
          sorted[sorted.length - 1].height -
          sorted[0].y;
        const sumH = sorted.reduce((s, e) => s + e.height, 0);
        gap = Math.max(0, (span - sumH) / (sorted.length - 1));
      }
    }
    let cursor = sorted[0].y;
    return sorted.map((el) => {
      const y = cursor;
      cursor += el.height + gap!;
      return {
        id: el.id,
        patch: {
          y: Number(y.toFixed(2)),
          eraseOriginal: el.isUserAdded ? false : true,
        },
      };
    });
  }
}

export function computeSmartSnapAndGuides(
  activeRect: RectPt,
  otherElements: DocumentElement[],
  options: {
    canvasW: number;
    canvasH: number;
    snapToGrid: boolean;
    gridSizePt: number;
    snapToObjects: boolean;
    showAlignmentGuides: boolean;
    snapThresholdPt: number;
  }
): { x: number; y: number; guides: SmartGuideLine[] } {
  let x = activeRect.x;
  let y = activeRect.y;

  if (options.snapToGrid) {
    const step = Math.max(2, options.gridSizePt);
    const gx = Math.round(x / step) * step;
    const gy = Math.round(y / step) * step;
    if (Math.abs(gx - x) <= options.snapThresholdPt) x = gx;
    if (Math.abs(gy - y) <= options.snapThresholdPt) y = gy;
  }

  const guides: SmartGuideLine[] = [];
  if (!options.snapToObjects && !options.showAlignmentGuides) {
    return { x, y, guides };
  }

  const tol = Math.max(2, options.snapThresholdPt || 6);
  const w = activeRect.width;
  const h = activeRect.height;

  // Candidate X targets (active edges + center vs other edges + center + page center)
  let bestDx = tol + 1;
  let targetX = x;
  let vGuidePos: number | null = null;

  const pageCenterX = options.canvasW / 2;
  const xPairs: Array<[number, number, number]> = [
    [x, pageCenterX - w / 2, pageCenterX],
  ];

  let bestDy = tol + 1;
  let targetY = y;
  let hGuidePos: number | null = null;

  const pageCenterY = options.canvasH / 2;
  const yPairs: Array<[number, number, number]> = [
    [y, pageCenterY - h / 2, pageCenterY],
  ];

  for (const other of otherElements) {
    if (!other.visible) continue;
    const oLeft = other.x;
    const oCenter = other.x + other.width / 2;
    const oRight = other.x + other.width;
    const oTop = other.y;
    const oMid = other.y + other.height / 2;
    const oBot = other.y + other.height;

    xPairs.push(
      [x, oLeft, oLeft],
      [x, oRight, oRight],
      [x + w / 2, oCenter, oCenter],
      [x + w, oRight, oRight],
      [x + w, oLeft, oLeft]
    );
    yPairs.push(
      [y, oTop, oTop],
      [y, oBot, oBot],
      [y + h / 2, oMid, oMid],
      [y + h, oBot, oBot],
      [y + h, oTop, oTop]
    );
  }

  for (const [activeEdgeVal, snapToVal, guideLineX] of xPairs) {
    const diff = snapToVal - activeEdgeVal;
    const absD = Math.abs(diff);
    if (absD <= tol && absD < bestDx) {
      bestDx = absD;
      targetX = x + diff;
      vGuidePos = guideLineX;
    }
  }

  for (const [activeEdgeVal, snapToVal, guideLineY] of yPairs) {
    const diff = snapToVal - activeEdgeVal;
    const absD = Math.abs(diff);
    if (absD <= tol && absD < bestDy) {
      bestDy = absD;
      targetY = y + diff;
      hGuidePos = guideLineY;
    }
  }

  if (options.snapToObjects) {
    if (vGuidePos !== null) x = targetX;
    if (hGuidePos !== null) y = targetY;
  }

  if (options.showAlignmentGuides) {
    if (vGuidePos !== null) {
      guides.push({
        orientation: 'v',
        pos: vGuidePos,
        start: 0,
        end: options.canvasH,
        kind: 'align',
      });
    }
    if (hGuidePos !== null) {
      guides.push({
        orientation: 'h',
        pos: hGuidePos,
        start: 0,
        end: options.canvasW,
        kind: 'align',
      });
    }

    // Equal horizontal / vertical spacing indicator between neighbors
    const horzSorted = otherElements
      .filter((o) => o.visible && Math.abs(o.y - y) < Math.max(h, o.height))
      .sort((a, b) => a.x - b.x);
    if (horzSorted.length >= 2) {
      for (let i = 0; i < horzSorted.length - 1; i++) {
        const a = horzSorted[i];
        const b = horzSorted[i + 1];
        const refGap = b.x - (a.x + a.width);
        if (refGap > 2) {
          const rightOfB = x - (b.x + b.width);
          if (Math.abs(rightOfB - refGap) <= tol) {
            if (options.snapToObjects) x = b.x + b.width + refGap;
            const yLine = y + h / 2;
            guides.push({
              orientation: 'h',
              pos: yLine,
              start: b.x + b.width,
              end: x,
              kind: 'spacing',
              label: `${Math.round(refGap)}pt`,
            });
          }
        }
      }
    }
  }

  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    guides,
  };
}

export function getElementsInMarquee(
  elements: DocumentElement[],
  marquee: RectPt
): string[] {
  const rx1 = marquee.x;
  const ry1 = marquee.y;
  const rx2 = marquee.x + marquee.width;
  const ry2 = marquee.y + marquee.height;

  return elements
    .filter((el) => {
      if (!el.visible) return false;
      const ex1 = el.x;
      const ey1 = el.y;
      const ex2 = el.x + el.width;
      const ey2 = el.y + el.height;
      return !(ex2 < rx1 || ex1 > rx2 || ey2 < ry1 || ey1 > ry2);
    })
    .map((e) => e.id);
}

export function matchesShortcutCombo(
  e: KeyboardEvent,
  combo: string
): boolean {
  if (!combo) return false;
  const parts = combo
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const needCtrl = parts.includes('ctrl') || parts.includes('cmd') || parts.includes('mod');
  const needShift = parts.includes('shift');
  const needAlt = parts.includes('alt');
  const keyToken = parts.find(
    (p) => !['ctrl', 'cmd', 'mod', 'shift', 'alt'].includes(p)
  );
  if (!keyToken) return false;

  const hasCtrl = e.ctrlKey || e.metaKey;
  if (needCtrl !== hasCtrl) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;

  const k = e.key.toLowerCase();
  if (keyToken === '=' && (k === '=' || k === '+')) return true;
  if (keyToken === 'delete' && (k === 'delete' || k === 'backspace')) return true;
  return k === keyToken;
}
