import React, { useEffect, useRef, useState } from 'react';
import { Eraser, PenTool, Stamp } from 'lucide-react';
import { DocumentElement } from '../types/pdfStudio';
import { GlassButton, GlassCard, GlassModal, GlassSegmentedControl } from './glass';

interface SignatureStampModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPage: number;
  initialTab?: 'signature' | 'stamp';
  onInsertElement: (el: DocumentElement, historyLabel: string) => void;
  onSaveSignatureToLibrary?: (
    name: string,
    dataUrl: string,
    width: number,
    height: number
  ) => void;
}

const STAMP_PRESETS = [
  'APPROVED',
  'PAID',
  'CONFIDENTIAL',
  'DRAFT',
  'VOID',
  'COPY',
  'RECEIVED',
];

export const SignatureStampModal: React.FC<SignatureStampModalProps> = ({
  isOpen,
  onClose,
  currentPage,
  initialTab = 'signature',
  onInsertElement,
  onSaveSignatureToLibrary,
}) => {
  const [tab, setTab] = useState<'signature' | 'stamp'>(initialTab);
  const [strokeWidth, setStrokeWidth] = useState(2.5);
  const [inkColor, setInkColor] = useState('#101010');
  const [hasInk, setHasInk] = useState(false);

  const [stampLabel, setStampLabel] = useState('APPROVED');
  const [includeDate, setIncludeDate] = useState(true);
  const [stampAngle, setStampAngle] = useState<0 | -12>(-12);
  const [stampColor, setStampColor] = useState('#101010');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, isOpen]);

  const getPt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = getPt(e);
    lastPtRef.current = pt;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = inkColor;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, strokeWidth * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    setHasInk(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !canvasRef.current || !lastPtRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const pt = getPt(e);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = strokeWidth * 1.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    lastPtRef.current = pt;
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPtRef.current = null;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  };

  const exportTrimmedSignature = (): {
    dataUrl: string;
    width: number;
    height: number;
  } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const { width, height } = canvas;
    const img = ctx.getImageData(0, 0, width, height);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = img.data[(y * width + x) * 4 + 3];
        if (a > 8) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return null;
    const pad = 10;
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(width - sx, maxX - minX + pad * 2);
    const sh = Math.min(height - sy, maxY - minY + pad * 2);
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    const dataUrl = out.toDataURL('image/png');
    out.width = 0;
    out.height = 0;
    return { dataUrl, width: sw, height: sh };
  };

  const handleInsertSignature = (alsoSaveLibrary: boolean) => {
    const trimmed = exportTrimmedSignature();
    if (!trimmed) return;
    const wPt = 160;
    const hPt = Math.max(28, Number(((trimmed.height / trimmed.width) * wPt).toFixed(1)));
    const el: DocumentElement = {
      id: `sig-${Date.now()}`,
      type: 'signature',
      pageNumber: currentPage,
      x: 72,
      y: 620,
      width: wPt,
      height: hPt,
      rotation: 0,
      text: 'Signature',
      fontFamily: 'Helvetica',
      fontSize: 10,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: inkColor,
      backgroundColor: 'transparent',
      align: 'left',
      opacity: 1,
      editable: true,
      locked: false,
      visible: true,
      confidence: 1,
      needsReview: false,
      isUserAdded: true,
      lockAspectRatio: true,
      sourceOrigin: 'user_overlay',
      imageDataUrl: trimmed.dataUrl,
      imageNaturalWidth: trimmed.width,
      imageNaturalHeight: trimmed.height,
    };
    if (alsoSaveLibrary && onSaveSignatureToLibrary) {
      onSaveSignatureToLibrary(
        `Signature ${new Date().toLocaleDateString()}`,
        trimmed.dataUrl,
        trimmed.width,
        trimmed.height
      );
    }
    onInsertElement(el, 'Insert Signature');
    onClose();
  };

  const handleInsertStamp = () => {
    const cleanLabel = stampLabel.trim().toUpperCase() || 'APPROVED';
    const today = new Date().toISOString().slice(0, 10);
    const el: DocumentElement = {
      id: `stp-${Date.now()}`,
      type: 'stamp',
      pageNumber: currentPage,
      x: 340,
      y: 120,
      width: 148,
      height: includeDate ? 48 : 36,
      rotation: stampAngle,
      text: cleanLabel,
      stampText: cleanLabel,
      stampDate: includeDate ? today : undefined,
      fontFamily: 'Helvetica',
      fontSize: 13,
      fontWeight: 'bold',
      fontStyle: 'normal',
      color: stampColor,
      borderColor: stampColor,
      borderWidth: 2,
      backgroundColor: 'transparent',
      align: 'center',
      opacity: 0.9,
      editable: true,
      locked: false,
      visible: true,
      confidence: 1,
      needsReview: false,
      isUserAdded: true,
      sourceOrigin: 'annotation',
    };
    onInsertElement(el, `Insert Stamp "${cleanLabel}"`);
    onClose();
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="Signatures & Document Stamps"
      subtitle={`Place transparent monochrome signature or dated stamp onto Page ${currentPage}`}
      maxWidthClass="max-w-xl"
    >
      <div className="p-4 tablet:p-5 space-y-4 text-xs">
        <GlassSegmentedControl
          value={tab}
          onChange={setTab}
          options={[
            { value: 'signature', label: 'Signature Pad' },
            { value: 'stamp', label: 'Document Stamps' },
          ]}
        />

        {tab === 'signature' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[#555555] dark:text-[#B5B5B5]">Ink:</span>
                {['#101010', '#334155', '#000000'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setInkColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-6 h-6 rounded-full border-2 ${
                      inkColor === c
                        ? 'border-black dark:border-white scale-110'
                        : 'border-transparent'
                    }`}
                  />
                ))}
                <span className="ml-2 text-[#555555] dark:text-[#B5B5B5]">Weight:</span>
                {[1.5, 2.5, 4].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setStrokeWidth(w)}
                    className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono ${
                      strokeWidth === w
                        ? 'studio-active-surface'
                        : 'border-black/15 dark:border-white/15'
                    }`}
                  >
                    {w}px
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={clearCanvas}
                className="px-2.5 py-1 rounded-lg border border-black/15 dark:border-white/15 flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/10"
              >
                <Eraser className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>

            <div className="rounded-2xl border border-black/15 dark:border-white/15 bg-white overflow-hidden touch-none">
              <canvas
                ref={canvasRef}
                width={520}
                height={180}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                className="w-full h-44 cursor-crosshair block"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {onSaveSignatureToLibrary && (
                <GlassButton
                  variant="glass"
                  size="md"
                  disabled={!hasInk}
                  onClick={() => handleInsertSignature(true)}
                >
                  Save to Library &amp; Insert
                </GlassButton>
              )}
              <GlassButton
                variant="primary"
                size="md"
                disabled={!hasInk}
                onClick={() => handleInsertSignature(false)}
              >
                <PenTool className="w-3.5 h-3.5" />
                Insert Signature
              </GlassButton>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {STAMP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setStampLabel(preset)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold tracking-wide ${
                    stampLabel === preset
                      ? 'studio-active-surface'
                      : 'border-black/15 dark:border-white/15 text-[#555555] dark:text-[#B5B5B5]'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                  Custom Stamp Text
                </span>
                <input
                  type="text"
                  value={stampLabel}
                  onChange={(e) => setStampLabel(e.target.value)}
                  className="mt-1 w-full min-h-[38px] px-3 py-1.5 rounded-xl studio-input uppercase font-semibold"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-medium text-[#555555] dark:text-[#B5B5B5]">
                  Tilt Angle
                </span>
                <select
                  value={stampAngle}
                  onChange={(e) => setStampAngle(Number(e.target.value) as 0 | -12)}
                  className="mt-1 w-full min-h-[38px] px-2.5 py-1.5 rounded-xl studio-select"
                >
                  <option value={-12}>Angled (-12°)</option>
                  <option value={0}>Horizontal (0°)</option>
                </select>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeDate}
                  onChange={(e) => setIncludeDate(e.target.checked)}
                  className="accent-[#101010] dark:accent-white"
                />
                <span className="text-[#101010] dark:text-white font-medium">
                  Include Today&apos;s Date ({new Date().toISOString().slice(0, 10)})
                </span>
              </label>

              <div className="flex items-center gap-1.5">
                {['#101010', '#555555'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setStampColor(c)}
                    style={{ backgroundColor: c }}
                    className={`w-5 h-5 rounded-full border-2 ${
                      stampColor === c ? 'border-black dark:border-white' : 'border-transparent'
                    }`}
                  />
                ))}
              </div>
            </div>

            <GlassCard level={2} padding="md" className="flex items-center justify-center bg-white">
              <div
                style={{
                  transform: `rotate(${stampAngle}deg)`,
                  borderColor: stampColor,
                  color: stampColor,
                }}
                className="px-4 py-1.5 border-2 rounded text-center font-bold tracking-widest"
              >
                <div className="text-sm">{(stampLabel || 'APPROVED').toUpperCase()}</div>
                {includeDate && (
                  <div className="text-[10px] font-mono font-normal">
                    {new Date().toISOString().slice(0, 10)}
                  </div>
                )}
              </div>
            </GlassCard>

            <div className="flex justify-end">
              <GlassButton variant="primary" size="md" onClick={handleInsertStamp}>
                <Stamp className="w-3.5 h-3.5" />
                Place Stamp on Page {currentPage}
              </GlassButton>
            </div>
          </div>
        )}
      </div>
    </GlassModal>
  );
};
