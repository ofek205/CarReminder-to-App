import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";

/**
 * PopupQueue
 * Renders a sequence of popup items one at a time inside a single Dialog.
 * Dismissing one slides it left and reveals the next.
 *
 * Props:
 *   items: Array<{ id: string, render: (onClose: fn) => ReactNode, onDismiss?: fn }>
 *          Pass only items that SHOULD appear. Falsy values are filtered out.
 */
export default function PopupQueue({ items = [] }) {
  const queue = items.filter(Boolean);
  const [index, setIndex] = useState(0);
  const [slide, setSlide] = useState('idle'); // 'idle' | 'exit' | 'enter'
  const isBusy = useRef(false);

  // Reset index when queue changes (e.g. new session)
  useEffect(() => { setIndex(0); setSlide('idle'); }, [queue.length]);

  const isOpen = queue.length > 0 && index < queue.length;
  const current = queue[index];
  const hasNext = index + 1 < queue.length;

  const advance = () => {
    if (isBusy.current) return;
    current?.onDismiss?.();

    if (hasNext) {
      isBusy.current = true;
      setSlide('exit');
      setTimeout(() => {
        setIndex(i => i + 1);
        setSlide('enter');
        setTimeout(() => {
          setSlide('idle');
          isBusy.current = false;
        }, 220);
      }, 220);
    } else {
      setIndex(i => i + 1); // past end → dialog closes naturally
    }
  };

  const slideStyle = {
    transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.22s ease',
    transform: slide === 'exit'  ? 'translateX(-110%)' :
               slide === 'enter' ? 'translateX(110%)'  :
               'translateX(0)',
    opacity: slide === 'idle' ? 1 : 0,
  };

  return (
    <Dialog open={isOpen} onOpenChange={v => { if (!v) advance(); }}>
      <DialogContent
        dir="rtl"
        className="max-w-md p-0 overflow-hidden gap-0"
        /* hide the default shadcn close button - we render our own */
        onPointerDownOutside={e => e.preventDefault()}
      >
        {/* ── X button - always top-right ── */}
        <button
          onClick={advance}
          aria-label="סגור"
          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Progress dots (only when >1 item) ── */}
        {queue.length > 1 && (
          <div className="flex justify-center gap-1.5 pt-4 pb-0 px-6">
            {queue.map((item, i) => (
              <span
                key={item.id}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-6 bg-[#2D5233]' : i < index ? 'w-1.5 bg-gray-300' : 'w-1.5 bg-gray-200'
                }`}
              />
            ))}
          </div>
        )}

        {/* ── Animated content ── */}
        <div style={slideStyle} className="px-6 pb-6 pt-4">
          {current?.render(advance)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
