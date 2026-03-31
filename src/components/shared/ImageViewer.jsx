import React, { useState, useEffect } from 'react';
import { X, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

/**
 * Full-screen image lightbox viewer with download, zoom, and gallery navigation.
 *
 * Usage:
 *   <ImageViewer
 *     images={['url1', 'url2']}       // array of image URLs
 *     initialIndex={0}                 // which image to show first
 *     open={true}                      // controls visibility
 *     onClose={() => setOpen(false)}   // close handler
 *     title="תמונות תאונה"             // optional title
 *   />
 */
export default function ImageViewer({ images = [], initialIndex = 0, open, onClose, title }) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);

  useEffect(() => { if (open) { setIndex(initialIndex); setZoom(1); } }, [open, initialIndex]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'ArrowRight') prev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, index]);

  if (!open || !images.length) return null;

  const current = images[index];
  const hasMultiple = images.length > 1;

  const prev = () => setIndex(i => (i - 1 + images.length) % images.length);
  const next = () => setIndex(i => (i + 1) % images.length);

  const handleDownload = async () => {
    try {
      // For data URIs or same-origin URLs, use fetch+blob
      if (current.startsWith('data:') || current.startsWith('blob:')) {
        const res = await fetch(current);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `image-${index + 1}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        // For external URLs, open in new tab (browser handles download)
        const a = document.createElement('a');
        a.href = current;
        a.download = `image-${index + 1}.jpg`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      window.open(current, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col" style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onClose}
            className="w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-sm"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <X className="w-5 h-5 text-white" />
          </button>
          {title && <span className="text-white text-sm font-bold mr-2">{title}</span>}
        </div>

        <div className="flex items-center gap-2">
          {hasMultiple && (
            <span className="text-white text-xs font-bold px-2 py-1 rounded-lg"
              style={{ background: 'rgba(255,255,255,0.15)' }}>
              {index + 1} / {images.length}
            </span>
          )}
          <button onClick={() => setZoom(z => Math.min(z + 0.5, 3))}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <ZoomIn className="w-4 h-4 text-white" />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.5, 0.5))}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <ZoomOut className="w-4 h-4 text-white" />
          </button>
          <button onClick={handleDownload}
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            <Download className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center overflow-auto px-4 pb-4 relative"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>

        {/* Navigation arrows */}
        {hasMultiple && (
          <>
            <button onClick={prev}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center z-10"
              style={{ background: 'rgba(255,255,255,0.2)' }}>
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <button onClick={next}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center z-10"
              style={{ background: 'rgba(255,255,255,0.2)' }}>
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          </>
        )}

        <img
          src={current}
          alt={`${index + 1}`}
          className="max-w-full max-h-full object-contain rounded-lg transition-transform duration-200"
          style={{ transform: `scale(${zoom})` }}
          draggable={false}
        />
      </div>

      {/* Thumbnail strip */}
      {hasMultiple && (
        <div className="flex items-center justify-center gap-2 px-4 pb-4 shrink-0">
          {images.map((img, i) => (
            <button key={i} onClick={() => { setIndex(i); setZoom(1); }}
              className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${i === index ? 'border-white scale-110' : 'border-transparent opacity-50'}`}>
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
