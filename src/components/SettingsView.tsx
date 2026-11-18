import React, { useState } from 'react';
import {
  ArrowRight,
  Info,
  Keyboard,
  Plus,
  RotateCcw,
  Sliders,
  Star,
  Trash2,
} from 'lucide-react';
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
  StudioEditingPreset,
  StudioSettings,
  WorkspaceLayoutMode,
} from '../types/pdfStudio';
import { DEFAULT_SHORTCUTS } from '../utils/projectStorage';
import { PAGE_PRESETS_PT } from '../utils/units';
import { BrandMark } from './BrandMark';
import { GlassButton, GlassCard } from './glass';
import { NumericDraftInput } from './NumericDraftInput';

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

const BUILTIN_EDITING_PRESETS: StudioEditingPreset[] = [
  {
    id: 'preset-high-precision-print',
    name: 'High-Precision Print',
    description: '5 pt fine grid, mm units, object snap, rulers visible',
    gridSizePt: 5,
    snapToObjects: true,
    defaultUnit: 'mm',
    showGridByDefault: false,
    showRulersByDefault: true,
  },
  {
    id: 'preset-rapid-label',
    name: 'Rapid Label Layout',
    description: '12 pt coarse grid, mm units, visible grid & snap',
    gridSizePt: 12,
    snapToObjects: true,
    defaultUnit: 'mm',
    showGridByDefault: true,
    showRulersByDefault: true,
  },
  {
    id: 'preset-point-forms',
    name: 'Point-Exact Forms',
    description: '8 pt baseline grid, pt units, visible grid & rulers',
    gridSizePt: 8,
    snapToObjects: true,
    defaultUnit: 'pt',
    showGridByDefault: true,
    showRulersByDefault: true,
  },
];

const FAVORITE_TOOL_CANDIDATES: Array<{ id: string; label: string }> = [
  { id: 'text', label: 'Add Text' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'line', label: 'Line' },
  { id: 'table', label: 'Table' },
  { id: 'qr_code', label: 'QR Code' },
  { id: 'barcode', label: 'Barcode' },
  { id: 'image', label: 'Image / Logo' },
  { id: 'signature', label: 'Signature Stamp' },
  { id: 'redact', label: 'Redaction' },
  { id: 'measure', label: 'Measure' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onClearWorkspace,
  onNavigate,
}) => {
  const [capturingAction, setCapturingAction] =
    useState<ShortcutActionId | null>(null);
  const [presetNameInput, setPresetNameInput] = useState('');

  const allPresets = [...BUILTIN_EDITING_PRESETS, ...(settings.editingPresets || [])];
  const favoriteTools = settings.favoriteTools || ['text', 'rect', 'qr_code', 'barcode'];

  const applyEditingPreset = (preset: StudioEditingPreset) => {
    onUpdateSettings({
      ...settings,
      activeEditingPresetId: preset.id,
      gridSizePt: preset.gridSizePt,
      snapToObjects: preset.snapToObjects,
      defaultUnit: preset.defaultUnit,
      showGridByDefault: preset.showGridByDefault,
      showRulersByDefault: preset.showRulersByDefault,
    });
  };

  const toggleFavoriteTool = (toolId: string) => {
    const next = favoriteTools.includes(toolId)
      ? favoriteTools.filter((id) => id !== toolId)
      : [...favoriteTools, toolId];
    onUpdateSettings({ ...settings, favoriteTools: next });
  };

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
      <div className="pb-5 border-b border-black/10 dark:border-white/12">
        <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-[#101010] dark:text-white">
          Studio Settings & Customization
        </h1>
        <p className="mt-1 text-xs tablet:text-sm text-[#555555] dark:text-[#B5B5B5]">
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
              <div className="text-sm font-display font-semibold text-[#101010] dark:text-white truncate">
                {APP_PRODUCT_NAME} · {APP_SUITE_NAME}
              </div>
              <div className="mt-0.5 text-[#555555] dark:text-[#B5B5B5] truncate tabular-nums">
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
            <Info className="w-3.5 h-3.5 text-[#101010] dark:text-white" />
            About Us
            <ArrowRight className="w-3.5 h-3.5" />
          </GlassButton>
        </GlassCard>
      )}

      {/* Appearance, Units & Workspace Layout */}
      <GlassCard level={3} padding="md" className="space-y-5 text-xs">
        <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
          Appearance, Units & Workspace Layout
        </h2>
        <div className="grid grid-cols-1 tablet:grid-cols-3 gap-4">
          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
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
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded-lg border studio-select"
            >
              <option value="dark">Obsidian Dark Mode</option>
              <option value="light">Pearl Light Mode</option>
              <option value="system">System Preference</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
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
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded-lg border studio-select"
            >
              <option value="standard">Standard Studio (Balanced)</option>
              <option value="compact">Compact Panels (Dense)</option>
              <option value="wide-canvas">Wide Canvas (Auto-collapse Layers)</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
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
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded-lg border studio-select"
            >
              <option value="mm">Millimeters (mm)</option>
              <option value="cm">Centimeters (cm)</option>
              <option value="in">Inches (in)</option>
              <option value="pt">Points (pt · 72/in)</option>
              <option value="px">Pixels (px · 96 DPI)</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
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
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded-lg border studio-select"
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
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
              Tesseract OCR Language
            </span>
            <select
              value={settings.ocrLanguage}
              onChange={(e) =>
                onUpdateSettings({ ...settings, ocrLanguage: e.target.value })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded-lg border studio-select"
            >
              <option value="eng">English (eng)</option>
              <option value="spa">Spanish (spa)</option>
              <option value="fra">French (fra)</option>
              <option value="deu">German (deu)</option>
            </select>
          </label>

          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
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
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded-lg border studio-select"
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
        <div className="pt-3 border-t border-black/10 dark:border-white/12 grid grid-cols-1 tablet:grid-cols-3 gap-4">
          <label className="block">
            <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5] font-medium">
              <span>Navigation Sidebar Width</span>
              <span className="tabular-nums font-mono text-[#101010] dark:text-white">
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
            <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5] font-medium">
              <span>Editor Layers Panel Width</span>
              <span className="tabular-nums font-mono text-[#101010] dark:text-white">
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
            <div className="flex justify-between text-[#555555] dark:text-[#B5B5B5] font-medium">
              <span>Properties Inspector Width</span>
              <span className="tabular-nums font-mono text-[#101010] dark:text-white">
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
        <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
          Precision Editing & Snapping
        </h2>
        <div className="grid grid-cols-1 tablet:grid-cols-4 gap-4">
          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
              Grid Spacing (pt)
            </span>
            <NumericDraftInput
              value={settings.gridSizePt}
              commitOptions={{ min: 4, max: 72, integer: true }}
              onCommit={(val) =>
                onUpdateSettings({
                  ...settings,
                  gridSizePt: val,
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded-lg border studio-input tabular-nums"
            />
          </label>

          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
              Snap Tolerance (pt)
            </span>
            <NumericDraftInput
              value={settings.snapThresholdPt}
              commitOptions={{ min: 2, max: 24, integer: true }}
              onCommit={(val) =>
                onUpdateSettings({
                  ...settings,
                  snapThresholdPt: val,
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded-lg border studio-input tabular-nums"
            />
          </label>

          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
              Duplicate X Offset (pt)
            </span>
            <NumericDraftInput
              value={settings.duplicateOffsetXPt ?? 14}
              commitOptions={{ min: -100, max: 200 }}
              onCommit={(val) =>
                onUpdateSettings({
                  ...settings,
                  duplicateOffsetXPt: val,
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded-lg border studio-input tabular-nums"
            />
          </label>

          <label className="block">
            <span className="font-medium text-[#555555] dark:text-[#B5B5B5]">
              Duplicate Y Offset (pt)
            </span>
            <NumericDraftInput
              value={settings.duplicateOffsetYPt ?? 14}
              commitOptions={{ min: -100, max: 200 }}
              onCommit={(val) =>
                onUpdateSettings({
                  ...settings,
                  duplicateOffsetYPt: val,
                })
              }
              className="mt-1.5 w-full px-3 py-2 rounded-lg border studio-input tabular-nums"
            />
          </label>
        </div>

        <div className="pt-2 space-y-2 text-[#101010] dark:text-white">
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
              className="rounded border-black/25 dark:border-white/25"
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
              className="rounded border-black/25 dark:border-white/25"
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
              className="rounded border-black/25 dark:border-white/25"
            />
            <span>Show canvas grid overlay by default</span>
          </label>
        </div>
      </GlassCard>

      {/* Editing Presets & Favorite Tools (Module 12) */}
      <GlassCard level={3} padding="md" className="space-y-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#101010] dark:text-white" />
            <div>
              <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
                Editing Presets &amp; Favorite Tools
              </h2>
              <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
                Switch precision grid/unit profiles in one click or save your custom workflow setup.
              </p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = presetNameInput.trim();
              if (!clean) return;
              const customPreset: StudioEditingPreset = {
                id: `preset-custom-${Date.now()}`,
                name: clean,
                description: `${settings.gridSizePt} pt grid · ${settings.defaultUnit} · snap ${
                  settings.snapToObjects ?? true ? 'on' : 'off'
                }`,
                gridSizePt: settings.gridSizePt,
                snapToObjects: settings.snapToObjects ?? true,
                defaultUnit: settings.defaultUnit,
                showGridByDefault: settings.showGridByDefault,
                showRulersByDefault: settings.showRulersByDefault,
              };
              onUpdateSettings({
                ...settings,
                activeEditingPresetId: customPreset.id,
                editingPresets: [...(settings.editingPresets || []), customPreset],
              });
              setPresetNameInput('');
            }}
            className="flex items-center gap-1.5"
          >
            <input
              type="text"
              value={presetNameInput}
              onChange={(e) => setPresetNameInput(e.target.value)}
              placeholder="New preset name..."
              className="px-2.5 py-1.5 rounded-lg border studio-input text-xs w-40"
            />
            <button
              type="submit"
              className="px-2.5 py-1.5 rounded-lg bg-[#101010] text-white dark:bg-white dark:text-[#050505] font-medium flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              Save Current
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 tablet:grid-cols-3 gap-2.5">
          {allPresets.map((preset) => {
            const isActive = settings.activeEditingPresetId === preset.id;
            const isCustom = !BUILTIN_EDITING_PRESETS.some((b) => b.id === preset.id);
            return (
              <div
                key={preset.id}
                className={`p-3 rounded-xl border flex flex-col justify-between gap-2 ${
                  isActive
                    ? 'border-[#101010] dark:border-white bg-black/[0.04] dark:bg-white/[0.08]'
                    : 'border-black/10 dark:border-white/12'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-[#101010] dark:text-white truncate">
                      {preset.name}
                    </span>
                    {isCustom && (
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            ...settings,
                            editingPresets: (settings.editingPresets || []).filter(
                              (x) => x.id !== preset.id
                            ),
                          })
                        }
                        className="text-[#888888] hover:text-[#101010] dark:hover:text-white"
                        title="Remove custom preset"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] mt-0.5 tabular-nums">
                    {preset.description}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => applyEditingPreset(preset)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border ${
                    isActive
                      ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505] border-transparent'
                      : 'border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[#101010] dark:text-white'
                  }`}
                >
                  {isActive ? 'Active Preset' : 'Apply Preset'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="pt-3 border-t border-black/10 dark:border-white/10">
          <div className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5] mb-2 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5" />
            Pinned Favorite Editor Tools ({favoriteTools.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FAVORITE_TOOL_CANDIDATES.map((t) => {
              const pinned = favoriteTools.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleFavoriteTool(t.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                    pinned
                      ? 'bg-[#101010] text-white dark:bg-white dark:text-[#050505] border-transparent'
                      : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5] hover:text-[#101010] dark:hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </GlassCard>

      {/* Custom Editor Toolbar & Recent Tools */}
      <GlassCard level={3} padding="md" className="space-y-4 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
              Custom Editor Toolbar & Recent Tools
            </h2>
            <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
              Choose which tools remain visible in the desktop Editor top toolbar.
            </p>
          </div>
          {settings.recentTools && settings.recentTools.length > 0 && (
            <button
              type="button"
              onClick={() => onUpdateSettings({ ...settings, recentTools: [] })}
              className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] text-[11px]"
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
                className="flex items-center gap-2 p-2 rounded-lg border border-black/10 dark:border-white/12 cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.05] text-[#101010] dark:text-white"
              >
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => toggleToolVisibility(tool.id)}
                  className="rounded border-black/25 dark:border-white/25"
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
            <Keyboard className="w-4 h-4 text-[#101010] dark:text-white" />
            <div>
              <h2 className="text-sm font-semibold text-[#101010] dark:text-white">
                Keyboard Shortcuts
              </h2>
              <p className="text-[11px] text-[#555555] dark:text-[#B5B5B5]">
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
            className="px-2.5 py-1.5 rounded-lg border border-black/15 dark:border-white/15 hover:bg-black/[0.04] dark:hover:bg-white/[0.08] flex items-center gap-1 text-[#101010] dark:text-white"
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
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-black/10 dark:border-white/12"
              >
                <span className="text-[#555555] dark:text-[#B5B5B5]">
                  {SHORTCUT_LABELS[actionId]}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCapturingAction(isCapturing ? null : actionId)
                  }
                  onBlur={() => {
                    if (isCapturing) setCapturingAction(null);
                  }}
                  onKeyDown={(e) => {
                    if (!isCapturing) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Escape') {
                      setCapturingAction(null);
                      return;
                    }
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
                  className={`px-2.5 py-1 rounded-lg font-mono text-[11px] border min-w-[96px] text-center ${
                    isCapturing
                      ? 'studio-active-surface font-semibold'
                      : 'border-black/15 dark:border-white/15 bg-[#F7F7F7] dark:bg-[#0B0B0B] text-[#101010] dark:text-white'
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
          <div className="font-semibold text-[#101010] dark:text-white">
            Clear Local Project Cache
          </div>
          <p className="mt-0.5 text-[#555555] dark:text-[#B5B5B5]">
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
