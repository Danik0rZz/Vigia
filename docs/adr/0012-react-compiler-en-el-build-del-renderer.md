# ADR-0012: React Compiler en el build del renderer

Estado: aceptado (2026-10-10). Ficha: 0059

## Contexto

`DataGrid.tsx` envolvía las filas en `memo`, y los comentarios y `src/renderer/CLAUDE.md` hablaban
del React Compiler como si estuviera activo, pero no estaba instalado: `electron.vite.config.ts`
usaba `react()` sin plugins de Babel. Solo estaban sus reglas de lint (`eslint-plugin-react-hooks` 7).
Las páginas crean `columns`, `status` y `onActivate` en cada render, así que `memo` nunca acertaba:
al hacer scroll en Problemas (hasta unas 200 filas montadas) o al escribir en el buscador de
evidencias, se volvían a pintar todas las filas. Dani decidió (2026-10-10) instalarlo antes que
optimizar a mano.

## Decisión

- `babel-plugin-react-compiler` 1.0.0 (MIT, versión exacta, en devDependencies) como plugin de Babel
  de `@vitejs/plugin-react` en la configuración del renderer. Solo existe en el build; el runtime es
  `react/compiler-runtime`, de React 19. Main y preload no lo usan.
- **Qué se compila:** todo el renderer. El compilador memoiza por sí mismo componentes y valores.
- **Qué se salta:** `DataGrid` (usa `useVirtualizer` de TanStack Virtual, incompatible; el lint ya lo
  avisa con `react-hooks/incompatible-library`) y los componentes con valores condicionales dentro de
  un `try/catch` o con `try`/`finally` (`ExportMenu`, `EnvironmentForm`, `TenantsSection`,
  `SecretsPanel`). Los salta sin romperlos y funcionan igual que antes. `GridRow` sí se compila y
  conserva su `memo`, porque al no compilarse `DataGrid` nadie memoiza por él los elementos de las
  filas.
- **Excluir un componente** que el compilador rompa: la directiva `"use no memo"` como primera
  sentencia de la función, con un comentario del motivo. Hoy no hay ninguno.
- **Contador de renders solo en e2e:** `src/renderer/src/lib/render-count.ts` (`useRenderCount`). Con
  `VIGIA_E2E`, cada fila principal del DataGrid lleva `data-render-count`, las veces que se ha
  pintado desde que se montó. Lo enciende `main.tsx` con el dato que ya existe del disparador de
  errores (`errorTrigger` de `app:getInfo`, falso en la app empaquetada), sin tocar el contrato IPC.
  El atributo se escribe en un efecto. Es un interruptor en tiempo de ejecución y no una constante de
  compilación porque los e2e corren sobre `out/` (ADR-0006) y comparten build.
- **Regla de código:** una función en línea pasada a una tabla dentro de una rama condicional del JSX
  se memoiza con los datos de esa rama y cambia con ellos; se saca a una constante antes del `return`
  (`toggleRow` en `EvidenceSection.tsx`).

## Alternativas descartadas

- Optimizar a mano (`useMemo`, `useCallback` en cada página): frágil, y cada página nueva tendría
  que acordarse. Dani prefirió el compilador.
- Quitar el `memo` de las filas: sin compilador no resuelve nada y con él sobra para el resto.
- Contador por IPC de pruebas: más piezas que un atributo del DOM que el e2e lee directamente.
- Contador como constante de compilación: obligaría a dos builds para los e2e.

## Consecuencias

- Los repintados de tablas bajan a las filas que cambian (comprobado en e2e: scroll de Problemas y
  buscador de evidencias).
- Hay una dependencia de desarrollo nueva y el build es algo más lento.
- Si un componente se comporta raro tras una subida del compilador, se aísla con `"use no memo"`. Los
  `useMemo` y `useCallback` existentes se dejan: no estorban.
- En el zip no hay contador: el atributo solo existe con `VIGIA_E2E` y sin empaquetar.
