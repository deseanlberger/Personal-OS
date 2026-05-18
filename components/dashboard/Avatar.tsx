'use client';

import { useState } from 'react';

/**
 * Shows /profile.jpg if available, otherwise the initials fallback.
 * Use sizeClass to control dimensions (e.g. "size-9", "size-10").
 */
export function Avatar({
  initials,
  sizeClass = 'size-9',
  src = '/profile.jpg',
  className = '',
}: {
  initials: string;
  sizeClass?: string;
  src?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className={`relative flex ${sizeClass} items-center justify-center overflow-hidden rounded-md border border-white/10 bg-white/[0.04] text-[11px] font-medium text-white/60 ${className}`}
    >
      <span className="absolute inset-0 flex items-center justify-center">{initials}</span>
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={initials}
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
