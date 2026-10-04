import { useSyncExternalStore, type JSX } from 'react'
import { motion, type Transition } from 'motion/react'

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReduce(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * Movimiento reducido: la preferencia del sistema, leída en cada render y con
 * su cambio. Ni useReducedMotion ni useReducedMotionConfig de Motion sirven:
 * guardan el valor del primer uso. (La app usa MotionConfig con "user", que
 * sigue esta misma preferencia.)
 */
function useStill(): boolean {
  return useSyncExternalStore(subscribeReduce, () => window.matchMedia(REDUCE_QUERY).matches)
}

export type LighthouseScene = 'sweep' | 'bulb' | 'search' | 'shake'

/** Centro de la linterna: el haz gira alrededor de este punto. */
const LAMP = { x: 60, y: 44 }
const AROUND_LAMP = {
  transformBox: 'view-box',
  transformOrigin: `${LAMP.x}px ${LAMP.y}px`
} as const
const LOOP: Transition = { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }

/** El haz de luz, desde la linterna hacia la derecha. */
function Beam({ scene, still }: { scene: LighthouseScene; still: boolean }): JSX.Element | null {
  if (scene === 'shake') return null
  const shape = (
    <polygon
      points={`${LAMP.x},${LAMP.y} 118,${LAMP.y - 14} 118,${LAMP.y + 14}`}
      fill="url(#lighthouse-beam)"
    />
  )
  if (still) return <g opacity={0.8}>{shape}</g>
  // Barre de lado a lado y se funde un instante en cada vuelta; buscando, más bajo y despacio.
  const rotate = scene === 'search' ? [-5, 30, -5] : [-30, 25, -30]
  const opacity = scene === 'bulb' ? [0.8, 0.8, 0, 0, 0.8] : [0.85, 0.85, 0.2, 0.85]
  return (
    <motion.g
      style={AROUND_LAMP}
      animate={{ rotate, opacity }}
      transition={{ ...LOOP, duration: scene === 'search' ? 4 : 3.2 }}
    >
      {shape}
    </motion.g>
  )
}

/** La bombilla: en 'bulb' se apaga y entra una nueva desde arriba. */
function Bulb({ scene, still }: { scene: LighthouseScene; still: boolean }): JSX.Element {
  const lit = <circle cx={LAMP.x} cy={LAMP.y} r={3.5} fill="#facc15" />
  if (still || scene !== 'bulb') return lit
  return (
    <>
      <motion.circle
        cx={LAMP.x}
        cy={LAMP.y}
        r={3.5}
        fill="#facc15"
        animate={{ opacity: [1, 0.15, 1, 0, 0, 1] }}
        transition={{ ...LOOP, times: [0, 0.1, 0.2, 0.3, 0.7, 0.8] }}
      />
      <motion.circle
        cx={LAMP.x}
        r={3.5}
        fill="#fde68a"
        stroke="#a16207"
        strokeWidth={0.6}
        animate={{ cy: [10, 10, LAMP.y, LAMP.y], opacity: [0, 1, 1, 0] }}
        transition={{ ...LOOP, times: [0, 0.35, 0.65, 0.8] }}
      />
    </>
  )
}

/** Una gaviota que cruza, en el barrido. */
function Gull({ still }: { still: boolean }): JSX.Element | null {
  if (still) return null
  return (
    <motion.path
      d="M0 0 q3 -3 6 0 q3 -3 6 0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      animate={{ x: [-10, 125], y: [18, 12, 20, 14] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
    />
  )
}

/** Interrogación que flota junto al faro, buscando. */
function Question({ still }: { still: boolean }): JSX.Element {
  const mark = (
    <g fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <path d="M86 70 q0 -7 6 -7 q6 0 6 6 q0 4 -5 6 q-1 1 -1 4" />
      <circle cx={92} cy={84} r={0.9} fill="currentColor" />
    </g>
  )
  if (still) return mark
  return (
    <motion.g animate={{ y: [0, -4, 0], opacity: [0.6, 1, 0.6] }} transition={LOOP}>
      {mark}
    </motion.g>
  )
}

/**
 * El faro de Vigía en las pantallas de error. Cada escena es suave y de 2-4 s:
 * el haz que barre (con una gaviota), cambiar la bombilla, buscar con una
 * interrogación y una sacudida para lo compacto. Con movimiento reducido, quieto.
 * SVG en línea sin estilos externos (la CSP no cambia); decorativo.
 */
export function Lighthouse({
  scene,
  size = 120
}: {
  scene: LighthouseScene
  size?: number
}): JSX.Element {
  const still = useStill()
  const tower = (
    <>
      {/* Mar */}
      <path
        d="M0 104 q10 -4 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V120 H0 Z"
        fill="currentColor"
        opacity={0.15}
      />
      {/* Torre con franjas */}
      <polygon points="52,102 68,102 65,52 55,52" fill="#f8fafc" stroke="currentColor" />
      <polygon points="53.3,86 66.7,86 66.1,78 53.9,78" fill="#dc2626" />
      <polygon points="54.4,70 65.6,70 65.1,62 54.9,62" fill="#dc2626" />
      {/* Linterna y techo */}
      <rect x={52} y={38} width={16} height={14} rx={1.5} fill="none" stroke="currentColor" />
      <polygon points="50,38 70,38 60,30" fill="#dc2626" stroke="currentColor" />
    </>
  )
  return (
    <svg
      data-testid="lighthouse"
      data-scene={scene}
      data-reduced={still ? 'true' : 'false'}
      aria-hidden="true"
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className="text-muted-foreground"
    >
      <defs>
        <linearGradient id="lighthouse-beam" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#fde68a" stopOpacity={0.9} />
          <stop offset="1" stopColor="#fde68a" stopOpacity={0} />
        </linearGradient>
      </defs>
      {scene === 'shake' && !still ? (
        <motion.g
          style={{ transformBox: 'view-box', transformOrigin: '60px 102px' }}
          animate={{ rotate: [0, -5, 5, -3, 3, 0, 0] }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            times: [0, 0.08, 0.16, 0.24, 0.32, 0.4, 1]
          }}
        >
          {tower}
          <Bulb scene={scene} still={still} />
        </motion.g>
      ) : (
        <>
          <Beam scene={scene} still={still} />
          {tower}
          <Bulb scene={scene} still={still} />
        </>
      )}
      {scene === 'sweep' && <Gull still={still} />}
      {scene === 'search' && <Question still={still} />}
    </svg>
  )
}
