import React from "react";

/** Atlas monogram: an angular "A" made of two flat strokes. The right stroke's top is cut
 *  parallel to the left stroke, leaving the open apex. Flat, transparent, currentColor. */
export function AtlasMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={(size * 28) / 40} viewBox="0 0 40 28" fill="currentColor" aria-hidden className={className}>
      <path d="M0 28 L13 0 H21 L8 28 Z" />
      <path d="M23.6 5.2 L39 28 H29.6 L19.9 13.2 Z" />
    </svg>
  );
}

export function AtlasWordmark({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-ink select-none">
      <AtlasMark size={compact ? 24 : 34} />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="text-[21px] font-semibold tracking-[-0.01em]">Atlas</span>
        </span>
      )}
    </span>
  );
}
