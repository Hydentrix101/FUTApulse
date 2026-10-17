import { useId } from 'react'

const HEART_PATH = 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'

const BRAND_STOPS = [
  ['0%', '#8b5cf6'],
  ['52%', '#c026d3'],
  ['100%', '#ef4444'],
]

const ON_RED_STOPS = [
  ['0%', '#4c1d95'],
  ['52%', '#831843'],
  ['100%', '#991b1b'],
]

export default function BrandHeart({ className = '', size = 20, variant = 'brand' }) {
  const gradientId = `futapulse-brand-gradient-${useId().replaceAll(':', '')}`
  const stops = variant === 'on-red' ? ON_RED_STOPS : BRAND_STOPS

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          {stops.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </linearGradient>
      </defs>
      <path
        d={HEART_PATH}
        fill={`url(#${gradientId})`}
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
