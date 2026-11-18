import React from 'react';
import { Trash2 } from 'lucide-react';
import { MeasurementUnit, PageSizePreset, StudioSettings } from '../types/pdfStudio';
import { PAGE_PRESETS_PT } from '../utils/units';

interface SettingsViewProps {
  settings: StudioSettings;
  onUpdateSettings: (next: StudioSettings) => void;
  onClearWorkspace: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onClearWorkspace,
}) => {
  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-4xl mx-auto w-full space-y-5 tablet:space-y-6">
      <div className="pb-5 border-b border-slate-200 dark:border-slate-800">
        <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Studio Settings
        </h1>
        <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
          Configure appearance, default measurement units, canvas grid snapping, and OCR preferences.
        </p>
      </div>

      <div className="p-4 tablet:p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] space-y-5 text-xs">
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
          <label className="block">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Appearance Theme
            </span>
            <select
              value={settings.theme}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  theme: e.target.value as 'dark' | 'light',
                })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
            >
              <option value="dark">Dark Mode (Studio Default)</option>
              <option value="light">Light Mode</option>
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
              Grid Spacing (pt)
            </span>
            <input
              type="number"
              min="4"
              max="72"
              value={settings.gridSizePt}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  gridSizePt: Math.max(4, Number(e.target.value) || 10),
                })
              }
              className="min-h-[44px] tablet:min-h-0 mt-1.5 w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
            />
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
        </div>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
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
      </div>

      {/* Storage Management */}
      <div className="p-4 tablet:p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 text-xs">
        <div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Clear Local Project Cache
          </div>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">
            Removes all locally stored PDF binaries and project drafts from IndexedDB.
          </p>
        </div>
        <button
          type="button"
          onClick={onClearWorkspace}
          className="min-h-[44px] tablet:min-h-0 px-3.5 py-2 rounded border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 font-medium flex items-center justify-center gap-1.5 whitespace-nowrap touch-manipulation"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear Cache
        </button>
      </div>
    </div>
  );
};
