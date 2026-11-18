import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderPlus,
  Image as ImageIcon,
  Palette,
  Shapes,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import {
  AssetFontItem,
  AssetImageItem,
  AssetLibraryItem,
  AssetPaletteItem,
  AssetShapeItem,
  AssetTextStyleItem,
  PDFProject,
} from '../types/pdfStudio';
import { inspectFontBinary } from '../utils/fontUtils';
import { uint8ArrayToBase64 } from '../utils/pdfRenderer';
import { GlassCard, GlassSegmentedControl } from './glass';

interface AssetLibraryViewProps {
  assets: AssetLibraryItem[];
  activeProject: PDFProject | null;
  onSaveAsset: (asset: AssetLibraryItem) => void;
  onDeleteAsset: (id: string) => void;
  onInsertImageIntoProject: (asset: AssetImageItem) => void;
  onInsertShapeIntoProject: (asset: AssetShapeItem) => void;
}

type AssetTab = 'fonts' | 'images' | 'shapes' | 'styles' | 'palettes';

export const AssetLibraryView: React.FC<AssetLibraryViewProps> = ({
  assets,
  activeProject,
  onSaveAsset,
  onDeleteAsset,
  onInsertImageIntoProject,
  onInsertShapeIntoProject,
}) => {
  const [tab, setTab] = useState<AssetTab>('fonts');
  const fontInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Shape builder form
  const [shapeName, setShapeName] = useState('Invoice Header Box');
  const [shapeKind, setShapeKind] = useState<'rect' | 'circle' | 'line'>('rect');
  const [shapeFill, setShapeFill] = useState('#F1F5F9');
  const [shapeStroke, setShapeStroke] = useState('#1E293B');

  // Text style builder form
  const [styleName, setStyleName] = useState('Section Heading');
  const [styleFont, setStyleFont] = useState('Helvetica');
  const [styleSize, setStyleSize] = useState(14);
  const [styleWeight, setStyleWeight] = useState<'normal' | 'bold'>('bold');
  const [styleColor, setStyleColor] = useState('#0F172A');

  // Palette builder form
  const [paletteName, setPaletteName] = useState('Corporate Navy');
  const [paletteColors, setPaletteColors] = useState(
    '#0F172A, #1D4ED8, #3B82F6, #E2E8F0'
  );

  const handleUploadFonts = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const meta = inspectFontBinary(buf, file.name);
      const item: AssetFontItem = {
        id: `font-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'font',
        name: file.name,
        fontFamily: meta.fontFamily,
        format: meta.format,
        dataBase64: uint8ArrayToBase64(buf),
        fsType: meta.fsType,
        embeddingPermission: meta.embeddingPermission,
        canEmbedInPdf: meta.canEmbedInPdf,
        licenseNote: meta.licenseNote,
        createdAt: new Date().toISOString(),
      };
      onSaveAsset(item);
    }
  };

  const handleUploadImages = async (
    files: FileList | null,
    kind: 'logo' | 'image' = 'logo'
  ) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => {
        const rawUrl = String(reader.result || '');
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 200;
          canvas.height = img.naturalHeight || 150;
          const ctx = canvas.getContext('2d');
          let normalizedUrl = rawUrl;
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            normalizedUrl = canvas.toDataURL('image/png');
          }
          const item: AssetImageItem = {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            kind,
            name: file.name,
            dataUrl: normalizedUrl,
            naturalWidth: img.naturalWidth || canvas.width,
            naturalHeight: img.naturalHeight || canvas.height,
            createdAt: new Date().toISOString(),
          };
          onSaveAsset(item);
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    }
  };

  const fonts = assets.filter((a): a is AssetFontItem => a.kind === 'font');
  const images = assets.filter(
    (a): a is AssetImageItem => a.kind === 'image' || a.kind === 'logo'
  );
  const shapes = assets.filter((a): a is AssetShapeItem => a.kind === 'shape');
  const styles = assets.filter(
    (a): a is AssetTextStyleItem => a.kind === 'text_style'
  );
  const palettes = assets.filter(
    (a): a is AssetPaletteItem => a.kind === 'palette'
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 tablet:p-6 desktop:p-8 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex flex-col tablet:flex-row tablet:items-center justify-between gap-4 pb-5 border-b border-slate-200/80 dark:border-white/10">
        <div>
          <h1 className="text-xl tablet:text-2xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Asset & Font Library
          </h1>
          <p className="mt-1 text-xs tablet:text-sm text-slate-600 dark:text-slate-400">
            Store custom TTF/OTF/WOFF fonts (with PDF embedding license inspection), company logos, reusable shapes, text styles, and color palettes locally across projects.
          </p>
        </div>
      </div>

      {/* Category Tabs */}
      <GlassSegmentedControl
        value={tab}
        onChange={setTab}
        options={[
          { value: 'fonts', label: 'Custom Fonts', count: fonts.length },
          { value: 'images', label: 'Logos & Images', count: images.length },
          { value: 'shapes', label: 'Shapes', count: shapes.length },
          { value: 'styles', label: 'Text Styles', count: styles.length },
          { value: 'palettes', label: 'Color Palettes', count: palettes.length },
        ]}
      />

      {/* CUSTOM FONTS TAB */}
      {tab === 'fonts' && (
        <div className="space-y-4 text-xs">
          <GlassCard level={3} padding="md" className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Upload Custom Fonts (.ttf, .otf, .woff)
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Reads OpenType OS/2 fsType licensing bits automatically before PDF embedding.
              </div>
            </div>
            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              multiple
              className="hidden"
              onChange={(e) => void handleUploadFonts(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fontInputRef.current?.click()}
              className="min-h-[40px] px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Font Files
            </button>
          </GlassCard>

          <GlassCard level={3} padding="none" className="divide-y divide-slate-200/75 dark:divide-white/10 overflow-hidden">
            {fonts.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                No custom fonts imported yet. Uploaded TTF/OTF fonts appear in the Editor Inspector and embed directly into exported PDFs when permitted by font license flags.
              </div>
            ) : (
              fonts.map((font) => (
                <div
                  key={font.id}
                  className="p-4 flex flex-col tablet:flex-row tablet:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        style={{ fontFamily: font.fontFamily }}
                        className="text-sm font-semibold text-slate-900 dark:text-slate-100"
                      >
                        {font.fontFamily}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono uppercase">
                        · {font.format}
                      </span>
                      <span
                        className={`text-[11px] font-medium flex items-center gap-1 ${
                          font.canEmbedInPdf
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {font.canEmbedInPdf ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        )}
                        {font.embeddingPermission.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {font.name} · {font.licenseNote}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteAsset(font.id)}
                    className="p-1.5 text-slate-400 hover:text-red-500 self-end tablet:self-auto"
                    title="Delete font"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </GlassCard>
        </div>
      )}

      {/* LOGOS & IMAGES TAB */}
      {tab === 'images' && (
        <div className="space-y-4 text-xs">
          <GlassCard level={3} padding="md" className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                Logos & Reusable Brand Graphics
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Normalized to lossless PNG with full pixel dimensions recorded for Preflight DPI checks.
              </div>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              multiple
              className="hidden"
              onChange={(e) => void handleUploadImages(e.target.files, 'logo')}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="min-h-[40px] px-4 py-2 rounded-md bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Logos / Images
            </button>
          </GlassCard>

          <div className="grid grid-cols-1 tablet:grid-cols-2 desktop:grid-cols-3 gap-4">
            {images.map((img) => (
              <GlassCard
                key={img.id}
                level={3}
                padding="none"
                className="overflow-hidden flex flex-col"
              >
                <div className="h-32 bg-slate-100 dark:bg-slate-900 flex items-center justify-center p-3 border-b border-slate-200 dark:border-slate-800">
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {img.name}
                    </div>
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      {img.naturalWidth} × {img.naturalHeight} px
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {activeProject && (
                      <button
                        type="button"
                        onClick={() => onInsertImageIntoProject(img)}
                        className="px-2.5 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 flex items-center gap-1"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        Insert
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteAsset(img.id)}
                      className="p-1.5 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}

      {/* REUSABLE SHAPES TAB */}
      {tab === 'shapes' && (
        <div className="space-y-4 text-xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!shapeName.trim()) return;
              onSaveAsset({
                id: `shape-${Date.now()}`,
                kind: 'shape',
                name: shapeName.trim(),
                shapeKind,
                width: shapeKind === 'line' ? 220 : 180,
                height: shapeKind === 'line' ? 12 : 72,
                backgroundColor: shapeKind === 'line' ? 'transparent' : shapeFill,
                borderColor: shapeStroke,
                borderWidth: 1.5,
                opacity: 1,
                createdAt: new Date().toISOString(),
              });
            }}
            className="p-4 rounded-2xl border glass-level-3 flex flex-wrap items-end gap-3"
          >
            <label className="flex-1 min-w-[160px]">
              <span className="text-[11px] text-slate-500">Shape Preset Name</span>
              <input
                type="text"
                value={shapeName}
                onChange={(e) => setShapeName(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
              />
            </label>
            <label className="w-28">
              <span className="text-[11px] text-slate-500">Kind</span>
              <select
                value={shapeKind}
                onChange={(e) =>
                  setShapeKind(e.target.value as 'rect' | 'circle' | 'line')
                }
                className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
              >
                <option value="rect">Rectangle</option>
                <option value="circle">Ellipse</option>
                <option value="line">Divider Line</option>
              </select>
            </label>
            <label>
              <span className="text-[11px] text-slate-500 block">Fill</span>
              <input
                type="color"
                value={shapeFill}
                onChange={(e) => setShapeFill(e.target.value)}
                className="mt-1 w-9 h-8 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
              />
            </label>
            <label>
              <span className="text-[11px] text-slate-500 block">Stroke</span>
              <input
                type="color"
                value={shapeStroke}
                onChange={(e) => setShapeStroke(e.target.value)}
                className="mt-1 w-9 h-8 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
              />
            </label>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Save Shape Preset
            </button>
          </form>

          <div className="grid grid-cols-1 tablet:grid-cols-3 gap-3">
            {shapes.map((s) => (
              <div
                key={s.id}
                className="p-3.5 rounded-2xl border glass-level-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {s.name}
                  </div>
                  <div className="text-[11px] text-slate-500 capitalize">
                    {s.shapeKind} · {s.width}×{s.height}pt
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {activeProject && (
                    <button
                      type="button"
                      onClick={() => onInsertShapeIntoProject(s)}
                      className="px-2.5 py-1 rounded bg-blue-600 text-white font-medium"
                    >
                      Insert
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteAsset(s.id)}
                    className="p-1 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TEXT STYLES TAB */}
      {tab === 'styles' && (
        <div className="space-y-4 text-xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!styleName.trim()) return;
              onSaveAsset({
                id: `style-${Date.now()}`,
                kind: 'text_style',
                name: styleName.trim(),
                fontFamily: styleFont,
                fontSize: styleSize,
                fontWeight: styleWeight,
                fontStyle: 'normal',
                color: styleColor,
                backgroundColor: 'transparent',
                align: 'left',
                createdAt: new Date().toISOString(),
              });
            }}
            className="p-4 rounded-2xl border glass-level-3 flex flex-wrap items-end gap-3"
          >
            <label className="flex-1 min-w-[140px]">
              <span className="text-[11px] text-slate-500">Style Name</span>
              <input
                type="text"
                value={styleName}
                onChange={(e) => setStyleName(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
              />
            </label>
            <label className="w-40">
              <span className="text-[11px] text-slate-500">Font Family</span>
              <select
                value={styleFont}
                onChange={(e) => setStyleFont(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
              >
                <option value="Helvetica">Helvetica</option>
                <option value="Times-Roman">Times-Roman</option>
                <option value="Courier">Courier</option>
                {fonts.map((f) => (
                  <option key={f.id} value={f.fontFamily}>
                    {f.fontFamily} (Custom)
                  </option>
                ))}
              </select>
            </label>
            <label className="w-20">
              <span className="text-[11px] text-slate-500">Size (pt)</span>
              <input
                type="number"
                min="6"
                max="72"
                value={styleSize}
                onChange={(e) => setStyleSize(Number(e.target.value) || 12)}
                className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent tabular-nums"
              />
            </label>
            <label className="w-24">
              <span className="text-[11px] text-slate-500">Weight</span>
              <select
                value={styleWeight}
                onChange={(e) =>
                  setStyleWeight(e.target.value as 'normal' | 'bold')
                }
                className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0E131D]"
              >
                <option value="normal">Regular</option>
                <option value="bold">Bold</option>
              </select>
            </label>
            <label>
              <span className="text-[11px] text-slate-500 block">Color</span>
              <input
                type="color"
                value={styleColor}
                onChange={(e) => setStyleColor(e.target.value)}
                className="mt-1 w-9 h-8 rounded border border-slate-300 dark:border-slate-700 cursor-pointer"
              />
            </label>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Save Text Style
            </button>
          </form>

          <div className="grid grid-cols-1 tablet:grid-cols-2 desktop:grid-cols-3 gap-3">
            {styles.map((st) => (
              <div
                key={st.id}
                className="p-3.5 rounded-2xl border glass-level-3 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div
                    style={{
                      fontFamily: st.fontFamily,
                      fontWeight: st.fontWeight,
                      color: st.color,
                    }}
                    className="text-sm truncate bg-white px-1.5 py-0.5 rounded inline-block"
                  >
                    {st.name}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                    {st.fontFamily} · {st.fontSize}pt · {st.fontWeight}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteAsset(st.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500 shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* COLOR PALETTES TAB */}
      {tab === 'palettes' && (
        <div className="space-y-4 text-xs">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const parsed = paletteColors
                .split(',')
                .map((c) => c.trim())
                .filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c));
              if (!paletteName.trim() || parsed.length === 0) return;
              onSaveAsset({
                id: `pal-${Date.now()}`,
                kind: 'palette',
                name: paletteName.trim(),
                colors: parsed,
                createdAt: new Date().toISOString(),
              });
            }}
            className="p-4 rounded-2xl border glass-level-3 flex flex-wrap items-end gap-3"
          >
            <label className="w-52">
              <span className="text-[11px] text-slate-500">Palette Name</span>
              <input
                type="text"
                value={paletteName}
                onChange={(e) => setPaletteName(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent"
              />
            </label>
            <label className="flex-1 min-w-[220px]">
              <span className="text-[11px] text-slate-500">
                Hex Colors (comma separated)
              </span>
              <input
                type="text"
                value={paletteColors}
                onChange={(e) => setPaletteColors(e.target.value)}
                className="mt-1 w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-transparent font-mono"
              />
            </label>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Save Palette
            </button>
          </form>

          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
            {palettes.map((pal) => (
              <div
                key={pal.id}
                className="p-4 rounded-2xl border glass-level-3 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {pal.name}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    {pal.colors.map((hex) => (
                      <div
                        key={hex}
                        title={hex}
                        style={{ backgroundColor: hex }}
                        className="w-7 h-7 rounded border border-slate-300 dark:border-slate-700"
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteAsset(pal.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
