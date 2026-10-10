import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Ficha 0059: el React Compiler está instalado (dependencia de desarrollo con versión exacta) y
 * activo en el build del renderer. No se lee el texto de `electron.vite.config.ts`: se carga la
 * configuración real, se toma el plugin de Babel de `@vitejs/plugin-react` del renderer y se le
 * pasa un componente pequeño, como haría `electron-vite build`. Con el compilador, la salida
 * importa su runtime (`react/compiler-runtime`) y usa su caché (`_c(`); sin él, el plugin ni
 * siquiera transforma (no hay plugins de Babel que aplicar).
 */

const ROOT = resolve(__dirname, '..')
const COMPILER = 'babel-plugin-react-compiler'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as PackageJson

/** Lo mínimo de un plugin de Vite que se usa aquí. */
interface VitePluginLike {
  name?: string
  configResolved?: (config: unknown) => void
  transform?:
    | ((code: string, id: string, options?: unknown) => unknown)
    | { handler: (code: string, id: string, options?: unknown) => unknown }
}

function flatten(plugins: unknown): VitePluginLike[] {
  if (Array.isArray(plugins)) return plugins.flatMap(flatten)
  return plugins !== null && typeof plugins === 'object' ? [plugins as VitePluginLike] : []
}

/** El plugin de Babel de @vitejs/plugin-react en la configuración del renderer. */
async function rendererBabelPlugin(): Promise<VitePluginLike> {
  const module = (await import('../electron.vite.config')) as {
    default: { renderer?: { plugins?: unknown } }
  }
  const plugins = flatten(module.default.renderer?.plugins)
  const babel = plugins.find((plugin) => plugin.name === 'vite:react-babel')
  expect(babel, 'el renderer usa @vitejs/plugin-react').toBeDefined()
  return babel as VitePluginLike
}

/** Transforma `code` con el plugin como en un build de producción. */
async function transformForBuild(code: string, id: string): Promise<string | undefined> {
  const plugin = await rendererBabelPlugin()
  plugin.configResolved?.({
    base: '/',
    root: ROOT,
    isProduction: true,
    command: 'build',
    experimental: {},
    server: { hmr: false },
    plugins: []
  })
  const transform = plugin.transform
  if (transform === undefined) return undefined
  const handler = typeof transform === 'function' ? transform : transform.handler
  const result = (await handler.call({}, code, id, { ssr: false })) as
    { code: string } | undefined | null
  return result?.code
}

const SAMPLE = `
export function Sample({ items }: { items: string[] }) {
  const sorted = [...items].sort()
  return <ul>{sorted.map((item) => <li key={item}>{item}</li>)}</ul>
}
`

describe('CA3 (0059): React Compiler instalado y activo en el renderer', () => {
  it('CA3 (0059): babel-plugin-react-compiler es dependencia de desarrollo con versión exacta', () => {
    const version = pkg.devDependencies?.[COMPILER]
    expect(version, `${COMPILER} en devDependencies`).toBeDefined()
    // Exacta: sin ^, ~, rangos ni etiquetas (ni «latest»); admite un sufijo de prelanzamiento.
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
    expect(pkg.dependencies?.[COMPILER], 'no va en dependencies').toBeUndefined()
  })

  it('CA3 (0059): el plugin de React del renderer compila los componentes con el React Compiler', async () => {
    const id = resolve(ROOT, 'src/renderer/src/components/Sample.tsx')
    const code = await transformForBuild(SAMPLE, id)
    expect(code, 'el plugin de Babel transforma el componente').toBeDefined()
    expect(code).toContain('react/compiler-runtime')
    expect(code).toMatch(/\b_c\(\d+\)/)
  })
})
