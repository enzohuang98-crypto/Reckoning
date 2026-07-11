export type IconName =
  | 'archive'
  | 'board'
  | 'brain'
  | 'chevronDown'
  | 'details'
  | 'live'
  | 'play'
  | 'redo'
  | 'reset'
  | 'settings'
  | 'sparkles'
  | 'stop'
  | 'target'
  | 'undo'

interface Props {
  name: IconName
  size?: number
  className?: string
}

const paths: Record<IconName, JSX.Element> = {
  archive: (
    <>
      <path d="M4 7h16" />
      <path d="M5 7l1-3h12l1 3" />
      <path d="M6 7v13h12V7" />
      <path d="M9 11h6" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    </>
  ),
  brain: (
    <>
      <path d="M9 4a3 3 0 0 0-5 2.2A3.5 3.5 0 0 0 5 13a3 3 0 0 0 4 4.5V4Z" />
      <path d="M15 4a3 3 0 0 1 5 2.2A3.5 3.5 0 0 1 19 13a3 3 0 0 1-4 4.5V4Z" />
      <path d="M9 8H7M15 8h2M9 13H7M15 13h2" />
    </>
  ),
  chevronDown: <path d="m7 10 5 5 5-5" />,
  details: (
    <>
      <path d="M4 5h16M4 12h16M4 19h16" />
      <circle cx="8" cy="5" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="10" cy="19" r="1.5" />
    </>
  ),
  live: (
    <>
      <path d="M4 14h3l2-7 4 11 2-7 2 3h3" />
      <path d="M4 4h16v16H4z" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  redo: (
    <>
      <path d="m16 5 4 4-4 4" />
      <path d="M20 9h-9a6 6 0 0 0-6 6v2" />
    </>
  ),
  reset: (
    <>
      <path d="M4 7v5h5" />
      <path d="M6.2 17A8 8 0 1 0 5 8.5L4 12" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5L9.2 6a8 8 0 0 0-1.7 1L5 6 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.5-1a8 8 0 0 0 1.7 1l.3 3h5l.3-3a8 8 0 0 0 1.7-1l2.4 1 2-3.5L18.9 13a7 7 0 0 0 .1-1Z" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
      <path d="m18.5 13 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" />
      <path d="m5 13 .8 2.7 2.7.8-2.7.8L5 20l-.8-2.7-2.7-.8 2.7-.8L5 13Z" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" />
    </>
  ),
  undo: (
    <>
      <path d="m8 5-4 4 4 4" />
      <path d="M4 9h9a6 6 0 0 1 6 6v2" />
    </>
  )
}

export function Icon({ name, size = 18, className }: Props): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}
