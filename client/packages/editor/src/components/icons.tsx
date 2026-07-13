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
export const BoneIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M4 12 12 4M3 13a1.6 1.6 0 1 0 2-2m6-6a1.6 1.6 0 1 0 2-2" />);
export const SlotIcon = ({ size }: { size?: number }) =>
  svg(size, <rect x="3" y="3" width="10" height="10" rx="1.5" />);
export const ImageIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="m3 11 3-3 3 3 2-2 2 2" />
      <circle cx="6" cy="6" r="1" />
    </>,
  );
export const MeshIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M3 3h10v10H3z" />
      <path d="M3 8h10M8 3v10M3 3l10 10" />
    </>,
  );
export const BBoxIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M3 3h3M10 3h3M3 3v3M3 10v3M3 13h3M10 13h3M13 3v3M13 10v3" />);
export const PointIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14" />
    </>,
  );
export const ClipIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="4.5" cy="11.5" r="1.6" />
      <circle cx="4.5" cy="4.5" r="1.6" />
      <path d="m6 10 8-6.5M6 6l8 6.5" />
    </>,
  );
export const CurveIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M2 12c4 0 3-8 7-8 2.5 0 3 2 5 2" />);
export const IkIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <path d="M3 13 8 8l4-1" />
      <circle cx="12.5" cy="6.5" r="1.6" />
      <circle cx="3" cy="13" r="1" />
    </>,
  );
export const TransformIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2.5" y="2.5" width="7" height="7" />
      <rect x="6.5" y="6.5" width="7" height="7" />
    </>,
  );
export const PhysicsIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <path d="M3 3c0 3 2 3 2 6s-2 3-2 4m5-13c0 3 2 3 2 6s-2 3-2 4m5-13c0 3 2 3 2 6s-2 3-2 4" />,
  );
export const EventIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M4 2h8l-2 4 2 0-6 8 1.5-6H4z" />);
export const AnimationIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="m6.5 5.5 4 2.5-4 2.5z" />
    </>,
  );
export const SkeletonIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <circle cx="8" cy="3" r="1.6" />
      <path d="M8 5v4M8 9l-3 4M8 9l3 4M4 6.5 8 8l4-1.5" />
    </>,
  );
export const SkinIcon = ({ size }: { size?: number }) =>
  svg(size, <path d="M5 3 3 5v3h2v5h6V8h2V5l-2-2-2 1.5h-2z" />);
export const ChevronIcon = ({ size, collapsed }: { size?: number; collapsed?: boolean }) =>
  svg(size, <path d={collapsed ? 'M6 3l5 5-5 5' : 'M3 6l5 5 5-5'} />);
export const RulerIcon = ({ size }: { size?: number }) =>
  svg(
    size,
    <>
      <rect x="2" y="2" width="12" height="12" />
      <path d="M2 5h2M2 8h3M2 11h2M5 2h2M8 2h3M11 2h2" />
    </>,
  );
