/** Hand-drawn icon set (no third-party assets). Single-color strokes. */

import type { ReactNode } from 'react';

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function svg(size: number | undefined, children: ReactNode) {
  return (
    <svg width={size ?? 15} height={size ?? 15} viewBox="0 0 16 16" {...S}>
      {children}
    </svg>
  );
}

export const MenuIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M2 4h12" />
      <path d="M2 8h12" />
      <path d="M2 12h12" />
    </>,
  );
export const OpenIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M2 13V4h4l1.5 2H14v7z" />);
export const SaveIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M3 3h8l2 2v8H3z" />
      <path d="M5 3v4h5V3" />
      <path d="M5 13v-4h6v4" />
    </>,
  );
export const UndoIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M6 4 3 7l3 3" />
      <path d="M3 7h7a3 3 0 0 1 0 6H8" />
    </>,
  );
export const RedoIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="m10 4 3 3-3 3" />
      <path d="M13 7H6a3 3 0 0 0 0 6h2" />
    </>,
  );
export const SelectIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M4 2l8 7-3.5.5L10 13l-2 1-1.5-3.5L4 12z" />);
export const TranslateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M8 2v12M2 8h12" />
      <path d="m8 2-1.5 2M8 2l1.5 2M8 14l-1.5-2m1.5 2 1.5-2M2 8l2-1.5M2 8l2 1.5M14 8l-2-1.5m2 1.5-2 1.5" />
    </>,
  );
export const RotateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M13 8a5 5 0 1 1-2-4" />
      <path d="M11 1v3h3" />
    </>,
  );
export const ScaleIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2" y="7" width="7" height="7" />
      <path d="M9 7h5V2H7v5" />
      <path d="m10 6 3-3" />
    </>,
  );
export const ShearIcon = ({ size }: { size?: number }) => svg(size, <path d="M5 3h9l-3 10H2z" />);
export const CreateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="4" cy="12" r="1.6" />
      <path d="m5 11 7-7" />
      <path d="M12 4l2-2" />
    </>,
  );
export const SetupIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="3.2" r="1.7" />
      <path d="M8 5v5M8 10l-2.5 4M8 10l2.5 4M8 6.5 4.5 8M8 6.5l3.5 1.5" />
    </>,
  );
export const AnimateIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="10" cy="3.2" r="1.7" />
      <path d="M10 5 7 8l-3 1M7 8l1 3-2 3M8 11l4 1 1.5 2M10 5l3 2" />
    </>,
  );
export const EyeIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </>,
  );
export const TagIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M2 2h5l7 7-5 5-7-7z" />
      <circle cx="5.5" cy="5.5" r="1" />
    </>,
  );
export const CursorIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M5 2l7 6-3 .5L11 12l-1.7 1L7.5 9.6 5 11z" />);
export const KeyIcon = ({ size }: { size?: number }) => svg(size, <path d="M8 3l4 5-4 5-4-5z" />);
