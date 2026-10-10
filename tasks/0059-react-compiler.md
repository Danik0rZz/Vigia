---
id: '0059'
titulo: 'Instalar el React Compiler para que las tablas no se vuelvan a pintar enteras'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-codigo-comun
depende_de: ['0058']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0059-react-compiler
adrs: [1]
adr_nuevo: React Compiler en el build del renderer
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Lote «auditoria-codigo-comun» (0057 a 0059), de la revisión de código del 2026-10-09 (hallazgo
M-03). A la pregunta de si se instala el React Compiler o se optimiza a mano, Dani (2026-10-10):
"Sí" (instalarlo).

## Especificación

**El problema.** `DataGrid.tsx` envuelve las filas en `memo` y los comentarios y
`src/renderer/CLAUDE.md` hablan del React Compiler como si estuviera activo, pero **no está
instalado**: `electron.vite.config.ts` usa `react()` sin plugins de Babel y no hay
`babel-plugin-react-compiler`. Solo están sus **reglas de lint** (`eslint-plugin-react-hooks` 7). Las
páginas crean `columns`, `status` y `onActivate` en cada render, así que `memo` nunca acierta: al
hacer scroll en Problemas (hasta unas 200 filas montadas) o al escribir en el buscador de evidencias,
se vuelven a pintar todas las filas.

**Arreglo:**

- `npm install --save-exact babel-plugin-react-compiler` (dependencia de desarrollo) y
  `react({ babel: { plugins: ['babel-plugin-react-compiler'] } })` en la configuración del renderer
  (`electron.vite.config.ts`). La versión, la estable más reciente, comprobada en npm.
- Vigilar los componentes que el lint ya marca como incompatibles (`DataGrid` con TanStack Virtual,
  `Chart` con refs mutables): si el compilador los rompe, se excluyen con la directiva del propio
  compilador (`"use no memo"`) y su motivo.
- Revisar los comentarios que hablan del compilador para que digan la verdad; los `memo` y
  `useCallback` que sobren se pueden quitar.
- **Medición:** un contador de renders de fila en `DataGrid`, activo solo con `VIGIA_E2E`
  (expuesto en un atributo o por IPC de pruebas), para el e2e.
- ADR nuevo (doc-writer): por qué se instala y qué componentes quedan fuera.

## Criterios de aceptación

- CA1 (e2e): en Problemas con muchas filas del simulador, hacer scroll de diez filas no vuelve a
  pintar las filas que ya estaban montadas y no han cambiado (el contador lo demuestra); falla sin
  el compilador.
- CA2 (e2e): escribir en el buscador de evidencias solo vuelve a pintar las filas que cambian.
- CA3 (unitario): la dependencia va con versión exacta y el plugin está en la configuración del
  renderer.
- CA4 (verifier): `check` y el e2e completo pasan.

## Pruebas a mano para Dani

- Que el scroll de Problemas y el buscador de evidencias van igual o más fluidos con muchos datos.

## Fuera de alcance

- Optimizaciones a mano fuera de lo que pida el compilador.

## Ideas surgidas (fuera de alcance)

- (developer) El compilador se salta, sin romperlos, `ExportMenu`, `EnvironmentForm`,
  `TenantsSection` (valores condicionales dentro de un `try/catch`) y `SecretsPanel` (`try` con
  `finally`). Funcionan igual que antes; si algún día pesan, sacar la lógica del `try` a una función.

## Notas del revisor

### Ronda 1: APROBADO

CA1 y CA2 en `e2e/views.spec.ts` y CA3 en `scripts/react-compiler.test.ts` (carga la config real y
pasa un componente por el plugin), y fallarían sin el compilador; los e2e exigen que una fila que
cambia suba su contador. Sin tocar tests tras `4d499eb`. CA4, para el verifier (e2e completo).
`babel-plugin-react-compiler` 1.0.0 exacta en devDependencies, MIT, solo trae `@babel/types`. El
contador solo se enciende con `errorTrigger`, que en la app empaquetada es siempre falso
(`e2e-mode.test.ts`): no puede aparecer en el zip; se escribe en un efecto. `toggleRow` equivale a
las dos funciones que sustituye. Los componentes que el compilador se salta no usan `DataGrid`. Sin
CSP, `harden`, IPC, API ni esquema.

Opcional: un test unitario de `useRenderCount` (sin `enableRenderCount()` no escribe el atributo; con
él cuenta).

## Verificación

Tests escritos en el commit 4d499eb (`test(renderer): criterios de la ficha 0059 (#0059)`); fallan
porque falta el código (CA3: no está la dependencia ni el plugin; CA1 y CA2: las filas no llevan
`data-render-count`).

- CA1 → `e2e/views.spec.ts`, `CA1 (0059): en Problemas con 300 filas, hacer scroll de diez filas no
vuelve a pintar las que ya estaban montadas y no han cambiado` (con `sim.many`).
- CA2 → `e2e/views.spec.ts`, `CA2 (0059): escribir en el buscador de evidencias solo vuelve a pintar
las filas que cambian` (las 300 evidencias de P-778).
- CA3 → `scripts/react-compiler.test.ts` (versión exacta en devDependencies; carga
  `electron.vite.config.ts`, pasa un componente por el plugin de Babel del renderer como en un build
  y exige `react/compiler-runtime` y `_c(`).
- CA4 → verifier.

Decisiones del test-writer (Dani delegó; refinables):

- **Contrato del contador:** con `VIGIA_E2E`, cada fila principal del DataGrid (el elemento con
  `rowTestId`) lleva `data-render-count` = veces que se ha pintado desde que se montó. Se eligió
  el atributo frente al IPC de pruebas por ser lo más simple de leer desde el DOM.
- Los e2e guardan el elemento de cada fila: una fila desmontada y vuelta a montar cuenta como
  repintada (su contador vuelve a empezar y si no podría coincidir).
- CA2 se prueba escribiendo letra a letra un texto que cumplen las 300 evidencias («Evidencia»):
  ninguna fila cambia, así que ninguna se repinta. Los dos e2e comprueban además que una fila que sí
  cambia (foco en Problemas, desplegar en evidencias) sube su contador, para que no pasen con un
  contador congelado.
- CA3 va en `scripts/` porque prueba la configuración de la raíz (`electron.vite.config.ts`,
  `package.json`), como los demás tests de configuración.

Decisiones del developer (Dani delegó; refinables):

- **Versión y licencia:** `babel-plugin-react-compiler` 1.0.0 (la `latest` de npm el 2026-10-10;
  las demás etiquetas son beta, rc o experimental), en `devDependencies` con versión exacta.
  Licencia **MIT** (la de su `package.json`), compatible; solo trae `@babel/types` (MIT), que ya
  estaba por Babel. Va solo en el build: el runtime es `react/compiler-runtime`, de React 19.
- **Contador solo en e2e:** `src/renderer/src/lib/render-count.ts` (`useRenderCount`). Lo activa
  `main.tsx` con el mismo dato que el disparador de errores (`errorTrigger` de `app:getInfo`, que
  main da solo sin empaquetar y con `VIGIA_E2E=1`), así que no se toca el contrato IPC. El
  atributo se escribe en un efecto (no en el render, para cumplir las reglas de React); en la app
  empaquetada el efecto sale en su primera línea y el atributo no existe. Un solo build sirve para
  los dos casos (los e2e corren sobre `out/`, ADR-0006), por eso es un interruptor en tiempo de
  ejecución y no una constante de compilación.
- **Sin `"use no memo"`:** ningún componente se ha roto. `DataGrid` el compilador se lo salta solo
  (useVirtualizer, como ya decía el lint); `GridRow` sí se compila y conserva su `memo` (hace falta:
  como DataGrid no se compila, nadie memoiza por él los elementos de las filas). `Chart` se compila
  sin errores. Las salidas del compilador las comprobé con su `logger` sobre todo el renderer
  (las que se salta, en «Ideas surgidas»).
- **Arreglo en `EvidenceSection`:** el `onActivate` en línea dentro de la rama condicional de la
  tabla, el compilador lo memoizaba junto con `rows` y cambiaba con cada letra del buscador (CA2
  fallaba con 1 → 10 renders). Se sacó a `toggleRow`, antes del JSX. En `ProblemsTable` el mismo
  patrón sí queda memoizado aparte (sin rama), así que no se tocó.
- Los `useMemo` y `useCallback` existentes se dejan: no estorban al compilador y quitarlos no lo
  pide ningún criterio.

## Resultado

(pendiente)
