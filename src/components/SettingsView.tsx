import React, { useState } from 'react';
import { ArrowRight, Info, Keyboard, RotateCcw, Trash2 } from 'lucide-react';
import {
  APP_COPYRIGHT_YEAR,
  APP_PRODUCT_NAME,
  APP_SUITE_NAME,
  APP_VERSION,
  DEVELOPER_PROFILE,
} from '../config/appInfo';
import {
  MeasurementUnit,
  NavSection,
  PageSizePreset,
  ShortcutActionId,
  StudioSettings,
  WorkspaceLayoutMode,
} from '../types/pdfStudio';
import { DEFAULT_SHORTCUTS } from '../utils/projectStorage';
import { PAGE_PRESETS_PT } from '../utils/units';
import { BrandMark } from './BrandMark';
import { GlassButton, GlassCard } from './glass';

interface SettingsViewProps {
  settings: StudioSettings;
  onUpdateSettings: (next: StudioSettings) => void;
  onClearWorkspace: () => void;
  onNavigate?: (section: NavSection) => void;
}

const EDITOR_TOOL_TOGGLES: Array<{ id: string; label: string }> = [
  { id: 'text', label: 'Add Text' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'line', label: 'Line' },
  { id: 'table', label: 'Table' },
  { id: 'block', label: 'Document Block' },
  { id: 'image', label: 'Upload Image' },
  { id: 'assets', label: 'Asset Library Insert' },
  { id: 'search', label: 'Search & Replace' },
  { id: 'rulers', label: 'Rulers Toggle' },
  { id: 'grid', label: 'Grid Toggle' },
  { id: 'snap', label: 'Smart Snap Toggle' },
  { id: 'crop', label: 'Visual Crop' },
  { id: 'dupPage', label: 'Duplicate Page' },
  { id: 'history', label: 'Version History' },
  { id: 'qc', label: 'Preflight & Compare' },
  { id: 'recentBar', label: 'Recent Tools Strip' },
];

const SHORTCUT_LABELS: Record<ShortcutActionId, string> = {
  undo: 'Undo',
  redo: 'Redo',
  copy: 'Copy Selection',
  paste: 'Paste',
  duplicate: 'Duplicate with Offset',
  delete: 'Delete Selection',
  group: 'Group / Ungroup',
  lock: 'Lock / Unlock',
  selectAll: 'Select All on Page',
  zoomIn: 'Zoom In',
  zoomOut: 'Zoom Out',
  saveSnapshot: 'Save Version Snapshot',
  nudgeUp: 'Nudge Up (Shift = 10pt)',
  nudgeDown: 'Nudge Down (Shift = 10pt)',
  nudgeLeft: 'Nudge Left (Shift = 10pt)',
  nudgeRight: 'Nudge Right (Shift = 10pt)',
};

function formatKeyCombo(e: React.KeyboardEvent): string | null {
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(k);
  return parts.join('+');
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onClearWorkspace,
  onNavigate,
}) => {
  const [capturingAction, setCapturingAction] =
    useState<ShortcutActionId | null>(null);

  const shortcuts: Record<ShortcutActionId, string> = {
    ...DEFAULT_SHORTCUTS,
    ...(settings.shortcuts || {}),
  };

  const hiddenTools = settings.hiddenEditorTools || [];
  const toggleToolVisibility = (toolId: string) => {
    const next = hiddenTools.includes(toolId)
      ? hiddenTools.filter((id) => id !== toolId)
      : [...hiddenTools, toolId];
    onUpdateSettings({ ...settings, hiddenEditorTools: next });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-5xl mx-auto w-full space-y-5 tablet:space-y-6">
      <div className="pb-5 border-b border-slate-200/80 dark:border-white/10">
        <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Studio Settings & Customization
        </h1>
        <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
          Configure appearance themes, workspace layout dimensions, precision snapping, toolbar visibility, keyboard shortcuts, and auto-snapshots.
        </p>
      </div>

      {/* Product Identity & About Us Access */}
      {onNavigate && (
        <GlassCard
          level={3}
          padding="md"
          className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 text-xs"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <BrandMark size="md" />
            <div className="min-w-0">
              <div className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100 truncate">
                {APP_PRODUCT_NAME} · {APP_SUITE_NAME}
              </div>
              <div className="mt-0.5 text-slate-600 dark:text-slate-400 truncate tabular-nums">
                Version {APP_VERSION} · Developed by {DEVELOPER_PROFILE.name} · © {APP_COPYRIGHT_YEAR}
              </div>
            </div>
          </div>
          <GlassButton
            variant="glass"
            size="md"
            onClick={() => onNavigate('about')}
            className="shrink-0"
          >
            <Info className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            About Us
            <ArrowRight className="w-3.5 h-3.5" />
          </GlassButton>
        </GlassCard>
      )}

      {/* Appearance, Units & Workspace Layout */}
      <GlassCard level={3} padding="md" className="space-y-5 text-xs">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Appearance, Units & Workspace Layout
        </h2>
        <div className="grid grid-cols-1 tablet:grid-cols-3 gap-4">
          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Appearance Theme
            </span>
            <select
              value={settings.theme}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  theme: e.target.value as StudioSettings['theme'],
                })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              <option value="dark">Dark Mode</option>
              <option value="light">Light Mode</option>
              <option value="system">System Preference</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Workspace Layout Preset
            </span>
            <select
              value={settings.workspaceLayout || 'standard'}
              onChange={(e) => {
                const mode = e.target.value as WorkspaceLayoutMode;
                onUpdateSettings({
                  ...settings,
                  workspaceLayout: mode,
                  navSidebarWidthPx:
                    mode === 'compact' ? 204 : mode === 'wide-canvas' ? 200 : 240,
                  layersPanelWidthPx:
                    mode === 'compact' ? 188 : mode === 'wide-canvas' ? 180 : 224,
                  inspectorWidthPx:
                    mode === 'compact' ? 288 : mode === 'wide-canvas' ? 280 : 320,
                });
              }}
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              <option value="standard">Standard Studio (Balanced)</option>
              <option value="compact">Compact Panels (Dense)</option>
              <option value="wide-canvas">Wide Canvas (Auto-collapse Layers)</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Default Measurement Unit
            </span>
            <select
              value={settings.defaultUnit}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  defaultUnit: e.target.value as MeasurementUnit,
                })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              <option value="mm">Millimeters (mm)</option>
              <option value="cm">Centimeters (cm)</option>
              <option value="in">Inches (in)</option>
              <option value="pt">Points (pt · 72/in)</option>
              <option value="px">Pixels (px · 96 DPI)</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Default Page Size
            </span>
            <select
              value={settings.defaultPagePreset}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  defaultPagePreset: e.target.value as PageSizePreset,
                })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              {(Object.keys(PAGE_PRESETS_PT) as Array<Exclude<PageSizePreset, 'Custom'>>).map(
                (p) => (
                  <option key={p} value={p}>
                    {PAGE_PRESETS_PT[p].label}
                  </option>
                )
              )}
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Tesseract OCR Language
            </span>
            <select
              value={settings.ocrLanguage}
              onChange={(e) =>
                onUpdateSettings({ ...settings, ocrLanguage: e.target.value })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              <option value="eng">English (eng)</option>
              <option value="spa">Spanish (spa)</option>
              <option value="fra">French (fra)</option>
              <option value="deu">German (deu)</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Auto-Snapshot Interval
            </span>
            <select
              value={settings.autoSnapshotIntervalSec ?? 120}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  autoSnapshotIntervalSec: Number(e.target.value),
                })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              <option value={0}>Disabled</option>
              <option value={30}>Every 30 seconds</option>
              <option value={60}>Every 1 minute</option>
              <option value={120}>Every 2 minutes</option>
              <option value={300}>Every 5 minutes</option>
            </select>
          </label>
        </div>

        {/* Adjustable Sidebar Widths */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 tablet:grid-cols-3 gap-4">
          <label className="block">
            <div className="flex justify-between text-slate-700 dark:text-slate-300 font-medium">
              <span>Navigation Sidebar Width</span>
              <span className="tabular-nums font-mono">
                {settings.navSidebarWidthPx || 240}px
              </span>
            </div>
            <input
              type="range"
              min={190}
              max={310}
              step={4}
              value={settings.navSidebarWidthPx || 240}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  navSidebarWidthPx: Number(e.target.value),
                })
              }
              className="mt-2 w-full"
            />
          </label>

          <label className="block">
            <div className="flex justify-between text-slate-700 dark:text-slate-300 font-medium">
              <span>Editor Layers Panel Width</span>
              <span className="tabular-nums font-mono">
                {settings.layersPanelWidthPx || 224}px
              </span>
            </div>
            <input
              type="range"
              min={170}
              max={320}
              step={4}
              value={settings.layersPanelWidthPx || 224}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  layersPanelWidthPx: Number(e.target.value),
                })
              }
              className="mt-2 w-full"
            />
          </label>

          <label className="block">
            <div className="flex justify-between text-slate-700 dark:text-slate-300 font-medium">
              <span>Properties Inspector Width</span>
              <span className="tabular-nums font-mono">
                {settings.inspectorWidthPx || 320}px
              </span>
            </div>
            <input
              type="range"
              min={270}
              max={420}
              step={4}
              value={settings.inspectorWidthPx || 320}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  inspectorWidthPx: Number(e.target.value),
                })
              }
              className="mt-2 w-full"
            />
          </label>
        </div>
      </GlassCard>

      {/* Precision Editing & Snapping Preferences */}
      <GlassCard level={3} padding="md" className="space-y-4 text-xs">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Precision Editing & Snapping
        </h2>
        <div className="grid grid-cols-1 tablet:grid-cols-4 gap-4">
          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Grid Spacing (pt)
            </span>
            <input
              type="number"
              min={4}
              max={72}
              value={settings.gridSizePt}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  gridSizePt: Math.max(4, Number(e.target.value) || 10),
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
            />
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Snap Tolerance (pt)
            </span>
            <input
              type="number"
              min={2}
              max={24}
              value={settings.snapThresholdPt}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  snapThresholdPt: Math.max(2, Number(e.target.value) || 6),
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
            />
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Duplicate X Offset (pt)
            </span>
            <input
              type="number"
              min={-100}
              max={200}
              value={settings.duplicateOffsetXPt ?? 14}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  duplicateOffsetXPt: Number(e.target.value) || 0,
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
            />
          </label>

          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Duplicate Y Offset (pt)
            </span>
            <input
              type="number"
              min={-100}
              max={200}
              value={settings.duplicateOffsetYPt ?? 14}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  duplicateOffsetYPt: Number(e.target.value) || 0,
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
            />
          </label>
        </div>

        <div className="pt-2 space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.snapToObjects ?? true}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  snapToObjects: e.target.checked,
                })
              }
              className="rounded border-slate-400 text-blue-600"
            />
            <span>Snap to neighboring objects & page centers with smart alignment guides</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showRulersByDefault}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  showRulersByDefault: e.target.checked,
                })
              }
              className="rounded border-slate-400 text-blue-600"
            />
            <span>Show calibrated rulers in PDF Editor by default</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showGridByDefault}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  showGridByDefault: e.target.checked,
                })
              }
              className="rounded border-slate-400 text-blue-600"
            />
            <span>Show canvas grid overlay by default</span>
          </label>
        </div>
      </GlassCard>

      {/* Custom Editor Toolbar & Recent Tools */}
      <GlassCard level={3} padding="md" className="space-y-4 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Custom Editor Toolbar & Recent Tools
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Choose which tools remain visible in the desktop Editor top toolbar.
            </p>
          </div>
          {settings.recentTools && settings.recentTools.length > 0 && (
            <button
              type="button"
              onClick={() => onUpdateSettings({ ...settings, recentTools: [] })}
              className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px]"
            >
              Clear Recent Tools ({settings.recentTools.length})
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 tablet:grid-cols-4 gap-2">
          {EDITOR_TOOL_TOGGLES.map((tool) => {
            const visible = !hiddenTools.includes(tool.id);
            return (
              <label
                key={tool.id}
                className="flex items-center gap-2 p-2 rounded border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => toggleToolVisibility(tool.id)}
                  className="rounded border-slate-400 text-blue-600"
                />
                <span className="truncate">{tool.label}</span>
              </label>
            );
          })}
        </div>
      </GlassCard>

      {/* Keyboard Shortcut Customizer */}
      <GlassCard level={3} padding="md" className="space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-blue-500" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Keyboard Shortcuts
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Click any shortcut box and press your desired key combination.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onUpdateSettings({
                ...settings,
                shortcuts: { ...DEFAULT_SHORTCUTS },
              })
            }
            className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Reset Defaults
          </button>
        </div>

        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-2.5">
          {(Object.keys(SHORTCUT_LABELS) as ShortcutActionId[]).map((actionId) => {
            const isCapturing = capturingAction === actionId;
            return (
              <div
                key={actionId}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-slate-200 dark:border-slate-800"
              >
                <span className="text-slate-700 dark:text-slate-300">
                  {SHORTCUT_LABELS[actionId]}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCapturingAction(isCapturing ? null : actionId)
                  }
                  onKeyDown={(e) => {
                    if (!isCapturing) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const combo = formatKeyCombo(e);
                    if (combo) {
                      onUpdateSettings({
                        ...settings,
                        shortcuts: {
                          ...shortcuts,
                          [actionId]: combo,
                        },
                      });
                      setCapturingAction(null);
                    }
                  }}
                  className={`px-2.5 py-1 rounded font-mono text-[11px] border min-w-[96px] text-center ${
                    isCapturing
                      ? 'border-blue-500 bg-blue-600/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0E131D] text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {isCapturing ? 'Press keys...' : shortcuts[actionId]}
                </button>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* Storage Management */}
      <GlassCard level={3} padding="md" className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 text-xs">
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Clear Local Project Cache
          </div>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">
            Removes all locally stored PDF binaries and project drafts from IndexedDB.
          </p>
        </div>
        <GlassButton variant="danger" size="md" onClick={onClearWorkspace}>
          <Trash2 className="w-3.5 h-3.5" />
          Clear Cache
        </GlassButton>
      </GlassCard>
    </div>
  );
};
