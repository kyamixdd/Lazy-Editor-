import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { AssetFontItem, PDFProject } from '../types/pdfStudio';
import { generateExportBytes } from '../utils/pdfExporter';
import {
  applyTrueRedactionsToProject,
  inspectPendingRedactions,
  verifyPdfBytesRedactionClean,
} from '../utils/redactionEngine';
import { GlassButton, GlassCard, GlassModal } from './glass';

interface RedactionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: PDFProject;
  customFonts: AssetFontItem[];
  onApplyRedactions: (updatedProject: PDFProject, summary: string) => void;
}

export const RedactionConfirmModal: React.FC<RedactionConfirmModalProps> = ({
  isOpen,
  onClose,
  project,
  customFonts,
  onApplyRedactions,
}) => {
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    clean: boolean;
    foundLeaks: string[];
    extractedCharCount: number;
  } | null>(null);
  const [testedTerms, setTestedTerms] = useState<string[]>([]);

  const summary = useMemo(() => inspectPendingRedactions(project), [project]);

  const handleApplyPermanently = () => {
    const res = applyTrueRedactionsToProject(project);
    if (res.appliedRedactionCount === 0) return;
    setTestedTerms(summary.overlappingTextStrings);
    onApplyRedactions(
      res.updatedProject,
      `Applied True Redaction (${res.appliedRedactionCount} zone(s), stripped ${res.removedElementCount} element(s))`
    );
  };

  const handleExportAndVerify = async () => {
    setVerifying(true);
    setVerificationResult(null);
    try {
      let targetProject = project;
      const termsToAudit =
        summary.overlappingTextStrings.length > 0
          ? summary.overlappingTextStrings
          : testedTerms;

      if (summary.pendingCount > 0) {
        const res = applyTrueRedactionsToProject(project);
        targetProject = res.updatedProject;
        setTestedTerms(termsToAudit);
        onApplyRedactions(
          res.updatedProject,
          `Applied & Verified True Redaction (${res.appliedRedactionCount} zone(s))`
        );
      }

      const exported = await generateExportBytes(targetProject, { customFonts });
      const audit = await verifyPdfBytesRedactionClean(exported.data, termsToAudit);
      setVerificationResult(audit);

      const copy = new Uint8Array(exported.data.byteLength);
      copy.set(exported.data);
      const blob = new Blob([copy.buffer], { type: exported.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${targetProject.name.replace(/\s+/g, '_')}_redacted.${
        exported.mimeType === 'application/zip' ? 'zip' : 'pdf'
      }`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={onClose}
      title="True Redaction & Sanitization Audit"
      subtitle="Distinguishes reversible cover-up masks from irreversible text/layer destruction"
      maxWidthClass="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <GlassButton variant="glass" size="md" onClick={onClose}>
            Close
          </GlassButton>
          <div className="flex flex-wrap items-center gap-2">
            <GlassButton
              variant="glass"
              size="md"
              disabled={summary.pendingCount === 0}
              onClick={handleApplyPermanently}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              Apply Redactions Now ({summary.pendingCount})
            </GlassButton>
            <GlassButton
              variant="primary"
              size="md"
              disabled={
                verifying || (summary.pendingCount === 0 && summary.appliedZoneCount === 0)
              }
              onClick={() => void handleExportAndVerify()}
            >
              {verifying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              Export &amp; Verify Sanitized PDF
            </GlassButton>
          </div>
        </div>
      }
    >
      <div className="p-4 tablet:p-5 space-y-4 text-xs">
        <GlassCard level={2} padding="sm" className="space-y-1.5 border-amber-500/30">
          <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" />
            Visual Mask vs. True Redaction
          </div>
          <p className="text-[#555555] dark:text-[#B5B5B5] leading-relaxed">
            Marking a redaction box initially creates a visual preview zone. Applying True Redaction permanently deletes overlapping text elements from document JSON and bakes opaque sanitized pixels over redacted background PDF zones so no underlying glyphs can be copied or searched in the exported PDF.
          </p>
        </GlassCard>

        <div className="grid grid-cols-3 gap-3 tabular-nums">
          <GlassCard level={2} padding="sm">
            <div className="text-[11px] text-[#888888]">Pending Zones</div>
            <div className="text-lg font-semibold text-[#101010] dark:text-white">
              {summary.pendingCount}
            </div>
          </GlassCard>
          <GlassCard level={2} padding="sm">
            <div className="text-[11px] text-[#888888]">Already Sanitized</div>
            <div className="text-lg font-semibold text-[#101010] dark:text-white">
              {summary.appliedZoneCount}
            </div>
          </GlassCard>
          <GlassCard level={2} padding="sm">
            <div className="text-[11px] text-[#888888]">Overlapping Strings</div>
            <div className="text-lg font-semibold text-[#101010] dark:text-white">
              {summary.overlappingTextStrings.length}
            </div>
          </GlassCard>
        </div>

        {summary.overlappingTextStrings.length > 0 && (
          <GlassCard level={2} padding="sm" className="space-y-2">
            <div className="font-semibold text-[#101010] dark:text-white">
              Strings Covered by Pending Redaction Zones (will be permanently stripped):
            </div>
            <div className="max-h-36 overflow-y-auto flex flex-wrap gap-1.5">
              {summary.overlappingTextStrings.map((s) => (
                <span
                  key={s}
                  className="px-2 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-[11px] text-[#101010] dark:text-white"
                >
                  {s}
                </span>
              ))}
            </div>
          </GlassCard>
        )}

        {verificationResult && (
          <GlassCard
            level={3}
            padding="sm"
            className={`space-y-1.5 ${
              verificationResult.clean
                ? 'border-black/25 dark:border-white/25'
                : 'border-red-500/40'
            }`}
          >
            <div className="font-semibold flex items-center gap-1.5 text-[#101010] dark:text-white">
              {verificationResult.clean ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-red-500" />
              )}
              {verificationResult.clean
                ? 'Sanitization Verified: 0 Redacted Strings Found in Exported PDF Text Layer'
                : `Warning: ${verificationResult.foundLeaks.length} String(s) Still Extractable`}
            </div>
            <div className="text-[11px] text-[#555555] dark:text-[#B5B5B5] tabular-nums">
              PDF.js text extraction audit scanned exported bytes ({verificationResult.extractedCharCount} extractable chars total).
            </div>
          </GlassCard>
        )}
      </div>
    </GlassModal>
  );
};
