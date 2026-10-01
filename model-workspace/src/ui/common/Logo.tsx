/** Brand mark: a diamond carrying the floor's X grid. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d3a074" />
          <stop offset="1" stopColor="#7d5134" />
        </linearGradient>
        <clipPath id="lg-clip">
          <path d="M16 2 30 16 16 30 2 16Z" />
        </clipPath>
      </defs>
      <path d="M16 2 30 16 16 30 2 16Z" fill="url(#lg-a)" />
      <g clipPath="url(#lg-clip)" stroke="rgba(255,255,255,0.75)" strokeWidth="1">
        <path d="M2 16 16 2M9 23 23 9M16 30 30 16" />
        <path d="M2 16 16 30M9 9 23 23M16 2 30 16" />
      </g>
      <path d="M16 2 30 16 16 30 2 16Z" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
    </svg>
  );
}
