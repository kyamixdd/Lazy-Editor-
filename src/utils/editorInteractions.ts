import { ActiveEditorTool, EditorToolCategory } from '../types/pdfStudio';

/**
 * Toggles an editor tool deterministically:
 * - Clicking an already-active non-'select' tool deactivates it back to 'select'.
 * - Switching to any tool other than 'style_painter' clears stylePainterActive.
 */
export function toggleEditorTool(
  currentTool: ActiveEditorTool,
  requestedTool: ActiveEditorTool,
  stylePainterActive = false
): { activeTool: ActiveEditorTool; stylePainterActive: boolean } {
  if (requestedTool === 'select') {
    return { activeTool: 'select', stylePainterActive: false };
  }
  if (currentTool === requestedTool && !stylePainterActive) {
    return { activeTool: 'select', stylePainterActive: false };
  }
  return {
    activeTool: requestedTool,
    stylePainterActive: requestedTool === 'style_painter',
  };
}

/**
 * Synchronizes Snap-to-Grid and Alignment Guides so they never get inverted out of sync.
 */
export function toggleSyncedSnapAndGuides(
  snapToGrid: boolean,
  showGuides: boolean
): { snapToGrid: boolean; showGuides: boolean } {
  const next = !(snapToGrid && showGuides);
  return { snapToGrid: next, showGuides: next };
}

export type EditorEscapeStep =
  | 'asset_menu'
  | 'search_bar'
  | 'crop_mode'
  | 'style_painter'
  | 'active_tool'
  | 'mobile_or_tablet_drawer'
  | 'selection'
  | 'none';

export interface EditorEscapeState {
  hasOpenModal: boolean;
  showAssetInsertMenu: boolean;
  showSearchBar: boolean;
  cropMode: boolean;
  stylePainterActive: boolean;
  activeTool: ActiveEditorTool;
  hasOpenMobileOrTabletOverlay: boolean;
  selectedCount: number;
}

export function resolveEditorEscapeStep(state: EditorEscapeState): EditorEscapeStep {
  if (state.hasOpenModal) return 'none'; // Modals handle their own Escape listener cleanly
  if (state.showAssetInsertMenu) return 'asset_menu';
  if (state.showSearchBar) return 'search_bar';
  if (state.cropMode) return 'crop_mode';
  if (state.stylePainterActive) return 'style_painter';
  if (state.activeTool !== 'select') return 'active_tool';
  if (state.hasOpenMobileOrTabletOverlay) return 'mobile_or_tablet_drawer';
  if (state.selectedCount > 0) return 'selection';
  return 'none';
}

export function defaultCategoryForTool(tool: ActiveEditorTool): EditorToolCategory {
  switch (tool) {
    case 'text':
      return 'text';
    case 'rect':
    case 'circle':
    case 'line':
    case 'arrow':
      return 'shapes';
    case 'draw':
      return 'draw';
    case 'highlight':
    case 'underline_annot':
    case 'strikeout_annot':
    case 'note':
    case 'callout':
    case 'redact':
      return 'annotate';
    case 'measure':
      return 'measure';
    case 'inspect':
      return 'inspect';
    default:
      return 'select';
  }
}

export interface NumericCommitOptions {
  min?: number;
  max?: number;
  decimals?: number;
  allowZero?: boolean;
  integer?: boolean;
}

/**
 * Parses a draft numeric string on commit (blur / Enter) safely without snapping mid-typing.
 */
export function parseCommittedNumericDraft(
  raw: string,
  fallback: number,
  opts: NumericCommitOptions = {}
): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (opts.allowZero === false && parsed === 0) {
    return fallback;
  }
  let val = parsed;
  if (opts.min !== undefined) val = Math.max(opts.min, val);
  if (opts.max !== undefined) val = Math.min(opts.max, val);
  if (opts.integer) {
    val = Math.round(val);
  } else if (opts.decimals !== undefined) {
    const factor = 10 ** opts.decimals;
    val = Math.round(val * factor) / factor;
  }
  return val;
}
