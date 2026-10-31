import type { ComponentChildren } from 'preact';

// Icons aus dem abgenommenen Design (24er Raster, Strichstärke je Icon).

interface IconProps {
  size?: number;
  class?: string;
}

function Svg({ size = 18, sw = 2.2, children, cls, cap = true }: { size?: number; sw?: number; children: ComponentChildren; cls?: string; cap?: boolean }) {
  return (
    <svg
      class={cls}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={sw}
      stroke-linecap={cap ? 'round' : undefined}
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Logo = ({ size = 22 }: IconProps) => (
  <Svg size={size} sw={2}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="m7 16 3.5-4 2.5 3 2-2 2 3" />
    <circle cx="15.5" cy="8.5" r="1.3" />
  </Svg>
);

export const WifiOn = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <path d="M12 20h.01" />
  </Svg>
);

export const WifiOff = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <path d="M2 2l20 20" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
    <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
    <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
    <path d="M5 13a10 10 0 0 1 5.24-2.76" />
    <path d="M12 20h.01" />
  </Svg>
);

export const Power = ({ size = 19 }: IconProps) => (
  <Svg size={size} sw={2.4}>
    <path d="M12 2v10" />
    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
  </Svg>
);

export const Restart = ({ size = 19 }: IconProps) => (
  <Svg size={size} sw={2.4}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);

export const Check = ({ size = 14, sw = 3.6 }: IconProps & { sw?: number }) => (
  <Svg size={size} sw={sw}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);

export const Clock = ({ size = 14 }: IconProps) => (
  <Svg size={size} sw={2.6}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const Refresh = ({ size = 14, sw = 2.6, class: cls }: IconProps & { sw?: number }) => (
  <Svg size={size} sw={sw} cls={cls}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </Svg>
);

export const Pencil = ({ size = 14 }: IconProps) => (
  <Svg size={size} sw={2.6}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </Svg>
);

export const Sliders = ({ size = 18 }: IconProps) => (
  <Svg size={size} sw={2}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </Svg>
);

export const ChevronRight = ({ size = 16, sw = 2.2 }: IconProps & { sw?: number }) => (
  <Svg size={size} sw={sw}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const ChevronLeft = ({ size = 18 }: IconProps) => (
  <Svg size={size} sw={2.4}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const AutoIcon = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const ManualIcon = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <path d="m8 12 3 3 5-6" />
  </Svg>
);

export const Search = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const Calendar = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </Svg>
);

export const Minus = ({ size = 18 }: IconProps) => (
  <Svg size={size} sw={2.6}>
    <path d="M5 12h14" />
  </Svg>
);

export const Plus = ({ size = 18 }: IconProps) => (
  <Svg size={size} sw={2.6}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Info = ({ size = 16 }: IconProps) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);

export const Close = ({ size = 20 }: IconProps) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const GridIcon = ({ size = 16 }: IconProps) => (
  <Svg size={size} cap={false}>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </Svg>
);

export const ListIcon = ({ size = 16 }: IconProps) => (
  <Svg size={size}>
    <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);

export const ImageIcon = ({ size = 12 }: IconProps) => (
  <Svg size={size} sw={2.4}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-5-5L5 21" />
  </Svg>
);
