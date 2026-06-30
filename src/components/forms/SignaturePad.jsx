import React, { useEffect, useRef, useState } from 'react';
import { X, Eraser, Check } from 'lucide-react';
import { C } from '@/lib/designTokens';

/**
 * SignaturePad — a finger/mouse signature capture overlay (raw canvas, no
 * dependency). Returns a trimmed-ish PNG data URL via onSave. Used by the
 * Forms feature's electronic-signature flow.
 *
 * Pointer events cover mouse + touch + stylus uniformly; touchAction:none
 * stops the page from scrolling while the user draws.
 */
export default function SignaturePad({ title = 'חתימה דיגיטלית', onSave, onClose }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const inked = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = C.gray800;

    const point = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e) => {
      e.preventDefault();
      drawing.current = true;
      const { x, y } = point(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
    };
    const move = (e) => {
      if (!drawing.current) return;
      e.preventDefault();
      const { x, y } = point(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      if (!inked.current) { inked.current = true; setHasInk(true); }
    };
    const up = () => { drawing.current = false; };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    inked.current = false;
    setHasInk(false);
  };

  const save = () => {
    if (!hasInk) return;
    onSave(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" dir="rtl" style={{ paddingInline: '12px' }}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: C.border }}>
          <p className="font-bold" style={{ color: C.text }}>{title}</p>
          <button type="button" onClick={onClose} aria-label="סגור"
            className="w-11 h-11 rounded-full border flex items-center justify-center" style={{ borderColor: C.border }}>
            <X className="h-4 w-4" style={{ color: C.muted }} />
          </button>
        </div>
        <div className="p-4">
          <p className="text-[12px] mb-2" style={{ color: C.muted }}>חתום באצבע או בעכבר בתוך המסגרת</p>
          <canvas
            ref={canvasRef}
            className="w-full rounded-2xl border"
            style={{ height: '180px', borderColor: C.border, background: C.card, touchAction: 'none' }}
          />
        </div>
        <div className="flex gap-2 border-t p-3" style={{ borderColor: C.border }}>
          <button type="button" onClick={clear}
            className="flex-1 h-11 rounded-2xl font-bold inline-flex items-center justify-center gap-2 border"
            style={{ borderColor: C.border, color: C.text }}>
            <Eraser className="h-4 w-4" /> נקה
          </button>
          <button type="button" onClick={save} disabled={!hasInk}
            className="flex-1 h-11 rounded-2xl font-bold text-white inline-flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: C.primary }}>
            <Check className="h-4 w-4" /> אישור חתימה
          </button>
        </div>
      </div>
    </div>
  );
}
