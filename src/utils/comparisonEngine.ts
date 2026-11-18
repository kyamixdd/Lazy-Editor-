import { DocumentElement, PDFProject } from '../types/pdfStudio';

export interface ElementDiffRecord {
  id: string;
  status: 'unchanged' | 'modified' | 'added' | 'removed';
  pageNumber: number;
  label: string;
  originalElement?: DocumentElement;
  editedElement?: DocumentElement;
  deltaPt?: { dx: number; dy: number; dw: number; dh: number };
  textChanged?: boolean;
  styleChanged?: boolean;
  unexpectedVisualDiff?: boolean;
  reasons: string[];
}

export interface ComparisonSummary {
  totalOriginal: number;
  totalEdited: number;
  unchangedCount: number;
  modifiedCount: number;
  addedCount: number;
  removedCount: number;
  unexpectedDiffCount: number;
  pageSizeChanged: boolean;
  diffs: ElementDiffRecord[];
}

export function compareOriginalVsEdited(
  project: PDFProject,
  baselineSnapshotIndex?: number
): ComparisonSummary {
  const diffs: ElementDiffRecord[] = [];

  // Baseline source: either an explicit historical snapshot, earliest saved version, or reconstructed original geometry
  const snapshot =
    baselineSnapshotIndex !== undefined &&
    project.versions &&
    project.versions[baselineSnapshotIndex]
      ? project.versions[baselineSnapshotIndex]
      : null;

  const baselineMap = new Map<string, DocumentElement>();
  if (snapshot) {
    for (const el of snapshot.elementsSnapshot) {
      baselineMap.set(el.id, el);
    }
  } else {
    for (const el of project.elements) {
      if (!el.isUserAdded && el.sourceOriginalRect) {
        baselineMap.set(el.id, {
          ...el,
          x: el.sourceOriginalRect.x,
          y: el.sourceOriginalRect.y,
          width: el.sourceOriginalRect.width,
          height: el.sourceOriginalRect.height,
          visible: true,
          eraseOriginal: false,
        });
      }
    }
  }

  const currentMap = new Map<string, DocumentElement>();
  for (const el of project.elements) {
    currentMap.set(el.id, el);
  }

  // Check all current elements
  for (const curr of project.elements) {
    const orig = baselineMap.get(curr.id);

    // Deleted original item kept as eraser rect
    if (!curr.visible && curr.eraseOriginal && !curr.isUserAdded) {
      diffs.push({
        id: curr.id,
        status: 'removed',
        pageNumber: curr.pageNumber,
        label: curr.text || curr.type,
        originalElement: orig || curr,
        editedElement: curr,
        unexpectedVisualDiff: false,
        reasons: ['Original PDF element removed / masked'],
      });
      continue;
    }

    if (!orig) {
      if (curr.isUserAdded || snapshot) {
        diffs.push({
          id: curr.id,
          status: 'added',
          pageNumber: curr.pageNumber,
          label: curr.text || curr.type,
          editedElement: curr,
          unexpectedVisualDiff: false,
          reasons: ['Added element in edited version'],
        });
      } else {
        diffs.push({
          id: curr.id,
          status: 'unchanged',
          pageNumber: curr.pageNumber,
          label: curr.text || curr.type,
          originalElement: curr,
          editedElement: curr,
          reasons: [],
        });
      }
      continue;
    }

    const dx = Number((curr.x - orig.x).toFixed(2));
    const dy = Number((curr.y - orig.y).toFixed(2));
    const dw = Number((curr.width - orig.width).toFixed(2));
    const dh = Number((curr.height - orig.height).toFixed(2));
    const posChanged = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
    const sizeChanged = Math.abs(dw) > 0.5 || Math.abs(dh) > 0.5;
    const textChanged = !snapshot
      ? Boolean(curr.eraseOriginal && !curr.isUserAdded && !posChanged && !sizeChanged)
      : curr.text !== orig.text;
    const styleChanged =
      curr.fontFamily !== orig.fontFamily ||
      Math.abs(curr.fontSize - orig.fontSize) > 0.2 ||
      curr.fontWeight !== orig.fontWeight ||
      curr.fontStyle !== orig.fontStyle ||
      curr.color !== orig.color ||
      curr.backgroundColor !== orig.backgroundColor ||
      curr.align !== orig.align;

    const reasons: string[] = [];
    if (textChanged) reasons.push('Text or content edited');
    if (posChanged) reasons.push(`Moved (${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy} pt)`);
    if (sizeChanged) reasons.push(`Resized (${dw >= 0 ? '+' : ''}${dw}, ${dh >= 0 ? '+' : ''}${dh} pt)`);
    if (styleChanged) reasons.push('Typography or color changed');
    if (curr.eraseOriginal && reasons.length === 0) {
      reasons.push('Modified against original PDF layer');
    }

    const unexpectedVisualDiff =
      Math.abs(dx) > 24 ||
      Math.abs(dy) > 24 ||
      (orig.width > 8 && Math.abs(dw) / orig.width > 0.45) ||
      (curr.eraseOriginal && !textChanged && !posChanged && !sizeChanged && !styleChanged);

    if (unexpectedVisualDiff && reasons.length > 0) {
      reasons.push('Large geometry shift detected');
    }

    const isModified = reasons.length > 0;
    diffs.push({
      id: curr.id,
      status: isModified ? 'modified' : 'unchanged',
      pageNumber: curr.pageNumber,
      label: curr.text || orig.text || curr.type,
      originalElement: orig,
      editedElement: curr,
      deltaPt: { dx, dy, dw, dh },
      textChanged,
      styleChanged,
      unexpectedVisualDiff,
      reasons,
    });
  }

  // Check elements present in baseline snapshot but completely missing from current
  if (snapshot) {
    for (const [id, orig] of baselineMap.entries()) {
      if (!currentMap.has(id)) {
        diffs.push({
          id,
          status: 'removed',
          pageNumber: orig.pageNumber,
          label: orig.text || orig.type,
          originalElement: orig,
          reasons: ['Removed since selected snapshot'],
        });
      }
    }
  }

  const basePage = snapshot?.pageConfigSnapshot || project.originalPages[0];
  const pageSizeChanged = Boolean(
    basePage &&
      (Math.abs(basePage.widthPt - project.pageConfig.widthPt) > 1 ||
        Math.abs(basePage.heightPt - project.pageConfig.heightPt) > 1)
  );

  return {
    totalOriginal: baselineMap.size,
    totalEdited: project.elements.filter((e) => e.visible).length,
    unchangedCount: diffs.filter((d) => d.status === 'unchanged').length,
    modifiedCount: diffs.filter((d) => d.status === 'modified').length,
    addedCount: diffs.filter((d) => d.status === 'added').length,
    removedCount: diffs.filter((d) => d.status === 'removed').length,
    unexpectedDiffCount: diffs.filter((d) => d.unexpectedVisualDiff).length,
    pageSizeChanged,
    diffs,
  };
}
