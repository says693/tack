interface BrandMarkProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * The fold: two leaves, one turned corner, a vermilion crease.
 * Drawn rather than imported so it stays crisp at 20–54 px.
 */
export function BrandMark({ size = 23, className = 'brand-mark', title }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path
        d="M7.4 3.6h13.9l5.3 5.3v19.5H7.4z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path
        d="M21.3 3.6v5.3h5.3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M21.3 3.6l5.3 5.3h-5.3z" fill="var(--accent)" opacity="0.9" />
      <path
        d="M11.8 14.4h9.9M11.8 18.2h7.7M11.8 22h5.6"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity="0.46"
      />
      <path
        d="M7.4 28.4c3.7-2.5 6.5-6.3 8.1-11.3"
        stroke="var(--accent)"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.72"
      />
    </svg>
  );
}
