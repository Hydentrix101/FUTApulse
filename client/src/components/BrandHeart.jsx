import { useId } from 'react'

const HEART_PATH = 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'

const BRAND_STOPS = [
  ['0%', '#f8f7ff'],
  ['14%', '#ffffff'],
  ['32%', '#a78bfa'],
  ['55%', '#6d28d9'],
  ['73%', '#ffffff'],
  ['84%', '#ddd6fe'],
  ['100%', '#5b21b6'],
]

export default function BrandHeart({ className = '', size = 20 }) {
  const gradientId = `futapulse-brand-gradient-${useId().replaceAll(':', '')}`

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
        <radialGradient id={gradientId} cx="38%" cy="22%" r="120%">
          {BRAND_STOPS.map(([offset, color]) => <stop key={offset} offset={offset} stopColor={color} />)}
        </radialGradient>
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
