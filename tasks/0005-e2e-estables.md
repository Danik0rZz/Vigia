---
id: '0005'
titulo: e2e de views.spec.ts que dependen de la máquina, sustituidos por tests estables
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | bloqueada
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0005-e2e-estables
adrs: [6, 7]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

"Vamos a solucionar los test que fallan por unos nuevos."

Se refiere a la mejora anotada en el BACKLOG «e2e de `views.spec.ts` que dependen de la máquina»
(primer candidato a ficha): fallan en el CI (`windows-latest`) y en la VPS sin cambios de código, y
mientras sigan así el CI sale en rojo.

## Especificación

**Objetivo:** que el e2e completo pase igual en la VPS y en el CI, sustituyendo los cinco tests por
versiones nuevas que comprueben **lo mismo** de forma estable. No se borra cobertura: cada
comprobación del test viejo está en el nuevo o se dice en "Resultado" por qué ya no aplica.

**Regla para todos (decisión del Planificador, que Dani aprueba con la ficha):** primero se busca la
causa y se reproduce. Si la causa está en el test (esperas, tiempos, geometría de la ventana), se
arregla el test. **Si la causa es un fallo real de la app, se arregla la app** y el test nuevo se
queda tan estricto como el viejo. Nunca se sube un tiempo de espera, se añade tolerancia o se quita
una comprobación solo para que pase. La causa de cada uno queda en "Resultado".

Los cinco (líneas de `e2e/views.spec.ts` en `main` tras la ficha 0004; si se han movido, se buscan
por nombre):

1. **«v0.9.0: volver del detalle conserva los filtros y la fila visible, con 300 filas
   virtualizadas»** (`:1724`). Espera la fila 150 al volver y ve la 146 (CI) o la 140 (VPS). Hay
   que saber si la lista restaura mal la fila de arriba con otra geometría (fallo de la app: Dani pidió
   «la fila que se veía», `docs/pendiente-dani.md`, v0.9.0) o si es el test el que mide antes de que
   termine de restaurar o con una ventana distinta.
2. **`Problemas: tabla, línea de tiempo y página de detalle con las entidades afectadas`**
   (`:1532`). La cabecera arrastrable (`app-drag` de `TopBar.tsx`) intercepta el clic en
   `breadcrumb-section`, aunque el enlace ya lleva `app-no-drag`. Si con la ventana del CI la ruta
   queda tapada (por ejemplo, por los botones nativos de la barra de título), un usuario con una
   ventana así tampoco puede pulsarla: fallo de la app.
3. **`i18n: cambiar de idioma con el gráfico de Métricas abierto lo rehace con el locale nuevo`**
   (`:3981`). La serie llega vacía, también aislado e intermitente. Deducción sin comprobar (verifier
   de la 0001): lee `data-series` sin `expect.poll` justo después de `runMetric`.
4. **`Inicio: estado de cada SLO (con texto y color), sin evaluar y problemas relacionados`**
   (`:4086`). Se agota una espera de 5 s; hay que saber en qué paso (probablemente el tooltip con
   `hoverFresh`).
5. **`exporta problemas a XLSX con su hoja Info, y a TXT alineado y con tabuladores`** (`:3620`).
   Intermitente, lee el fichero vacío. Causa probable: `exportTo` da el fichero por listo en cuanto
   aparece su nombre y main lo escribe con `writeFile` directo. Arreglo en el test: esperar a que el
   fichero tenga contenido y no cambie de tamaño. La app no cambia: avisa de «exportado» cuando
   `writeFile` ya ha terminado.

**Ventana de tamaño fijo en los e2e de `views`.** Si la geometría es parte de la causa (1 y 2), los
tests fijan el tamaño del contenido de la ventana al empezar (desde Playwright, por ejemplo con
`BrowserWindow.setContentSize` en `electronApp.evaluate`), no la app. Lo que dependa de la ventana
se prueba con ese tamaño fijo, y si el arreglo de la app es para ventanas pequeñas, con una pequeña
también.

**De paso, en el CI** (`.github/workflows/ci.yml`): `actions/checkout` y `actions/setup-node` a la
versión mayor que ya corre con Node 24 (quita el aviso de deprecación de Node 20). La versión se
comprueba en las notas de versión oficiales de cada acción; no se supone.

**Si los tests destapan un fallo de la app** (en estos cinco o en lo que se toque para
arreglarlos), se arregla en esta ficha y **se le informa a Dani**: en "Resultado" queda qué fallaba,
cómo se veía y qué se ha cambiado; cada arreglo añade su prueba a mano concreta en "Pruebas a mano
para Dani" (pasos para verlo), y el Orquestador lo destaca en su resumen y en el aviso de Telegram
(«Arreglado en la app, pruébalo: …»). Decisión de Dani (2026-10-07).

**Al terminar:** se quita la mejora anotada del BACKLOG. Si aparece otro e2e inestable al repetir,
se anota como mejora nueva (no entra en esta ficha salvo que sea de los mismos cinco).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.
"Estable" quiere decir que pasa con
`npx playwright test e2e/views.spec.ts -g "<nombre>" --repeat-each 5 --workers=1` en la VPS (el
verifier lo ejecuta y lo copia en "Verificación"). Son 5 repeticiones, más que las 3 de
`e2e/CLAUDE.md`, por decisión de Dani (2026-10-07): uno de los fallos salía 1 de cada 3 veces y con
5 la probabilidad de no verlo baja al 13 %.

- CA1 (e2e, sustituye a `:1724`): con 300 filas, filtro y scroll a mitad, al volver del detalle con
  el botón y con la flecha atrás del historial se conservan el filtro, la primera fila visible
  (mismo índice, sin tolerancia) y la fila abierta marcada; además, la fila abierta queda dentro de
  la vista. Estable.
- CA2 (e2e, sustituye a `:1532`): la página de detalle con las entidades afectadas, «Volver a
  Problemas» y el enlace «Problemas» de la barra superior, pulsado con un clic normal (sin `force`
  ni `dispatchEvent`). Estable. Si el arreglo es de la app, otro e2e comprueba que con una ventana
  pequeña el enlace sigue recibiendo el clic.
- CA3 (e2e, sustituye a `:3981`): la serie del gráfico es la misma antes y después de cambiar a
  inglés y de volver a español, y el locale cambia, leyendo `data-series` con espera (nunca una
  lectura suelta tras `runMetric`). Estable.
- CA4 (e2e, sustituye a `:4086`): los cuatro estados de SLO con su texto y su color, «Sin
  evaluar», los problemas relacionados con su plural y el tooltip con el ratón y con el foco.
  Estable.
- CA5 (e2e, sustituye a `:3620`): XLSX con Datos e Info, TXT alineado y TXT con tabuladores, cada
  fichero leído cuando ya tiene contenido. Estable.
- CA6 (unitario): un test lee `.github/workflows/ci.yml` y comprueba que `actions/checkout` y
  `actions/setup-node` van en la versión mayor elegida (la que se anota en "Resultado").
- CA7 (verifier): `npm run check` y el e2e completo (`npm run test:e2e`) pasan en la VPS sin ningún
  fallo.

## Pruebas a mano para Dani

- Que el CI del push de esta ficha sale en verde (el enlace lo da el Orquestador en el resumen y en
  el aviso de Telegram). Si sale en rojo, decir qué test.
- Cada fallo de la app que se arregle en esta ficha, con sus pasos (los añade el developer al
  arreglarlo; el doc-writer los lleva a `docs/pendiente-dani.md` al cerrar la versión). Si se
  arregla el 1 o el 2, como mínimo: con la ventana pequeña, que la ruta de la barra superior se
  pulsa y que al volver de un problema la lista queda en la misma fila.
- **Ruta de la barra superior con la ventana pequeña (arreglo de la app, CA2).** Con un entorno
  activo, hacer la ventana lo más pequeña que deje (960×600) o de unos 1024 px de ancho. Ir a
  Problemas y abrir uno. En la barra superior debe verse «Problemas › P-…» entero; «Cliente ›
  Entorno» se recorta o desaparece de la ruta (sigue en el selector de entorno, que también se
  recorta) y la búsqueda queda solo con la lupa (al pasar el ratón dice «Buscar»; Ctrl+K sigue
  igual). Pulsar «Problemas» en la ruta: vuelve a la lista. Con la ventana a 1280 px o más, la barra
  se ve como antes (con «Buscar Ctrl K»).
- **Volver por la ruta deja la lista en la misma fila (mínimo que pide la ficha; ningún e2e lo
  cubre).** Con la ventana pequeña y una lista de Problemas larga, desplazarla hasta la mitad, abrir
  un problema y volver pulsando «Problemas» en la ruta de la barra superior: la lista queda en la
  misma fila que se veía y con el problema abierto marcado.
- **Volver a exportar desde Inicio con la ventana pequeña (arreglo de la app, CA4).** Con la ventana
  a 960×600 (o unos 1024 px de ancho), en Inicio, exportar los SLOs a XLSX desde el botón de
  descarga de su tarjeta. Debe salir «Guardado: …» junto al botón, recortado con «…» si no cabe (al
  pasar el ratón se ve entero), y el botón debe seguir dentro de la tarjeta. Pulsarlo otra vez y
  exportar de nuevo: se guarda un segundo fichero.

## Fuera de alcance

- Otros tests o specs que no sean los cinco (si aparece otro inestable, se anota en el BACKLOG).
- Reintentos de Playwright (`retries`): siguen en 0.
- Cambiar los workers, el orden o el reparto de los specs.
- Escritura atómica de las exportaciones en main.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1-CA6 con su test (CA1, CA2 y CA4 también a 960×600); CA7 lo hace el verifier. Tests
  sin tocar después de `a128516`.
- Ningún test nuevo es más blando que el viejo: sin tiempos mayores, tolerancias, `force` ni
  `dispatchEvent`; CA1 sigue con el índice exacto y añade comprobaciones; CA3 lee con espera; CA5
  espera el aviso y el contenido. La causa de CA5 es correcta (`export.ts` responde tras `writeFile`).
- Arreglos de la app: la ruta conserva sección y detalle (`min-w-fit`) y el selector baja a 64 px;
  desde 1280 px la barra se ve como antes; la búsqueda solo con la lupa sigue llamándose «Buscar»
  (`sr-only` y `title`). El aviso de exportar no saca el botón de la tarjeta y sigue siendo
  `role="status"` con el texto entero en el DOM y en `title`.
- CI en v7 con las mismas entradas. Sin IPC, dependencias, CSP, permisos ni datos del tenant.
- Opcionales: comprobar en el test pequeño de CA2 que el botón «Buscar» se ve (al BACKLOG); añadir la
  prueba a mano de volver por la ruta a la misma fila (añadida por el Orquestador: la ficha la pide
  como mínimo).

## Verificación

Tests escritos en `875cb9b` (`test(e2e): criterios de la ficha 0005 (#0005)`). Los cinco viejos
se han quitado de `e2e/views.spec.ts` y los nuevos van en su sitio. Ayudas nuevas en el mismo spec:
`withContentSize` (fija el contenido de la ventana con `setContentSize` desde main y la deja como
estaba), `FIXED_WINDOW` 1024×720 (cabe en la pantalla 1024×768 del runner `windows-latest`; con
1280×800 el CI recorta la ventana y por eso veía otra geometría que la VPS), `SMALL_WINDOW` 960×600
(`minWidth`/`minHeight` de `src/main/window.ts`), `receivesClick`, `settledBox`, `clickInPlace`,
`fullyVisibleRows`, `nextFrames` y `exportSaved`.

Reproducción de los viejos (`--repeat-each 5 --workers=1`, VPS, 1280×800): solo falla `:1724`
(5/5, «Expected 150, Received 140» en la vuelta con el historial). Los otros cuatro pasan 15/15
aislados, también con la CPU del renderer frenada ×20. Con la ventana a 1024×728 (la del CI) fallan
siempre `:1724` (141), `:4086` (espera de 5 s en el `expect.poll` de la segunda exportación) y
`:1532` (la cabecera `app-drag` intercepta el clic en la ruta).

| CA  | Test                                                                                                                                                                              | Causa                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Resultado (`--repeat-each 5 --workers=1`)                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| CA1 | `CA1 (0005): con 300 filas virtualizadas, volver del detalle (botón e historial) … (1024×720)` y `(960×600)`                                                                      | **Test.** Abría la fila del borde (la que queda pegada a la cabecera fija) justo al volver, mientras la página aún se recoloca (a `main` le sale la barra de scroll y la fila cambia de ancho, 679 → 664 px). El primer intento de `locator.click` no acierta y Playwright reintenta haciendo scroll para alinear la fila abajo (`main` y la lista se mueven: 6600 → 6372 px). La lista guarda bien esa nueva primera fila (140 en la VPS, 146 en el CI: depende del alto de la ventana) y es la que restaura. Con un clic de ratón en el sitio, la app vuelve a la fila 150. El nuevo abre una fila del centro de las que se ven enteras, con `clickInPlace` (espera a que no se mueva, comprueba que nada la tapa y hace clic donde está), y comprueba además `data-selected` en las dos vueltas y que la fila abierta queda a la vista. | 10/10 en verde (5 por tamaño)                                                                                   |
| CA2 | `CA2 (0005): Problemas: tabla, línea de tiempo y página de detalle …` (1024×720) y `CA2 (0005): con la ventana más pequeña que permite la app, el enlace «Problemas» …` (960×600) | **App.** `src/renderer/src/components/TopBar.tsx:47-49`: el `<nav>` de la ruta es `flex min-w-0 flex-1 … truncate` y los hermanos de la cabecera (`EnvSelector`, `TimeRangeSelector`, búsqueda, tema, idioma y el hueco de `titlebar-inset` de los botones nativos, `:46`) no encogen. A 1024 px de ancho el `nav` queda en **0 px**: el enlace «Problemas» se recorta entero (`overflow: hidden`) y en su punto está la propia `<header class="app-drag">` o el `EnvSelector`. Un usuario con una ventana así no ve ni puede pulsar la ruta. A 1280 px el `nav` mide 244 px y sí se ve.                                                                                                                                                                                                                                                   | 0/5 y 0/5: fallan siempre en `receivesClick(crumbSection)` (el enlace no recibe el clic)                        |
| CA3 | `CA3 (0005): i18n: cambiar de idioma con el gráfico de Métricas abierto lo rehace con el locale nuevo y la misma serie`                                                           | **Test.** `runMetric` espera al canvas, pero `Chart` lo crea al montar (`echarts.init`) y `MetricChartPanel` lo monta con `series = []` mientras la consulta no ha respondido (`result?.series ?? []`): la lectura suelta de `data-series` podía ver `[]`. El nuevo lee `data-series` con `toHaveAttribute` (con espera) antes, en inglés y de vuelta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 5/5 en verde                                                                                                    |
| CA4 | `CA4 (0005): Inicio: estado de cada SLO …` (1024×720) y `CA4 (0005): con la ventana más pequeña que permite la app, tras exportar los SLOs el aviso no tapa el menú …` (960×600)  | **App.** La espera de 5 s que se agotaba es el `expect.poll` de la exportación tras «Actualizar» (`:4086` viejo, la línea `expect.poll(async () => (await exported())…)`), no el tooltip. Tras la primera exportación, el aviso «Guardado: <fichero>» (`src/renderer/src/components/ExportMenu.tsx:247-251`, `max-w-60`) entra en la cabecera de la tarjeta (`src/renderer/src/pages/HomePage.tsx:53`, `flex items-center justify-between` sin `min-w-0` ni salto), que no cabe en la columna del grid de tres (`HomePage.tsx:106`, `md:grid-cols-3`) con la ventana a 1024 px o menos: el botón de exportar se sale de la tarjeta y queda debajo de «Salud de servicios», que lo tapa. Un usuario no puede volver a exportar los SLOs hasta recargar.                                                                                     | 0/5 y 0/5: el grande falla siempre en ese `expect.poll`; el pequeño, en `receivesClick(exportMenu('kpi-slos'))` |
| CA5 | `CA5 (0005): exporta problemas a XLSX con sus hojas Datos e Info, a TXT alineado y a TXT con tabuladores, cada fichero leído ya escrito`                                          | **Test.** `exportTo` da el fichero por listo en cuanto aparece su nombre, y main lo crea al empezar `writeFile` (`src/main/ipc/handlers/export.ts:95` y `:104`). `exportSaved` espera además el aviso «Guardado: <fichero>», que el renderer pone cuando main ha terminado `writeFile`, y que el fichero no esté vacío.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 5/5 en verde                                                                                                    |
| CA6 | `scripts/ci-workflow.test.ts` › `CA6 (0005): acciones del CI en la versión mayor con Node 24`                                                                                     | Versión elegida: **v7** para las dos, decisión del Orquestador (2026-10-07). Comprobada en las releases oficiales: `actions/checkout` v7.0.1 y `actions/setup-node` v7.0.0, las dos con `runs.using: node24`, sin cambios incompatibles para nuestro uso (el bloqueo de PR de forks de checkout v7 no afecta a un workflow de `push`); `setup-node` v5 no tiene versiones desde 2025-09. Node 24 llegó en la v5.0.0 de las dos (checkout #2226, setup-node #1325). La primera versión del test (`875cb9b`) pedía v5.                                                                                                                                                                                                                                                                                                                       | Falla: `expected [ 'v4' ] to deeply equal [ 'v7' ]` en las dos                                                  |

Comprobaciones que cambian respecto a los viejos: ninguna se pierde. CA1 abre la fila del centro de
las visibles (antes, `before + 1` y `before`) y añade `data-selected` en la vuelta con el historial
y la fila abierta a la vista. CA4 lee el texto del estado con `toHaveText(/S/)` en vez de
`textContent` suelto. CA5 comprueba además la extensión de los dos TXT.

`npx playwright test e2e/views.spec.ts --workers=1` (spec entero, una vez): 87 en verde y los 4 de CA2
y CA4 en rojo por la app; el cambio de tamaño de la ventana no afecta a los demás.
`npx vitest run scripts/ci-workflow.test.ts`: 2 en rojo (CA6) y 1 en verde (la propia comprobación).

### Verifier, 2026-10-07, commit `82d2ed8`, rango `main..feat/0005-e2e-estables`: VERDE

- check: 1989 tests en 94 ficheros, cobertura ok.
- CA7: `npm run test:e2e` completo, 179 passed, **ningún fallo**.
- Estable (`-g "0005" --repeat-each 5 --workers=1`): 40 passed, 0 fallos. CA1 1024×720 5/5 y 960×600
  5/5; CA2 5/5 y ventana pequeña 5/5; CA3 5/5; CA4 5/5 y ventana pequeña 5/5; CA5 5/5.

## Resultado

Fallos de la app arreglados (para Dani):

- **CA2, ruta de la barra superior.** Qué fallaba: con la ventana a 1024 px de ancho o menos, el
  `<nav>` de la ruta se quedaba en 0 px (los demás controles de la cabecera no encogían) y la ruta
  no se veía: «Problemas» quedaba recortado y en su sitio estaba la cabecera arrastrable, así que no
  se podía pulsar. Cambio (`TopBar.tsx`, `EnvSelector.tsx`): la sección y el detalle no encogen y
  marcan el mínimo de la ruta; lo que se recorta es «Cliente › Entorno» (que también está en el
  selector); el selector de entorno puede encoger hasta 64 px (recorta el nombre, deja el distintivo
  y la flecha), y la búsqueda queda solo con la lupa por debajo de 1280 px (su nombre accesible y el
  `title` siguen siendo «Buscar»). Medido: a 960 px la ruta mide 125 px y se ve entera; a 1280 px,
  como antes.
- **CA4, exportar de nuevo desde Inicio.** Qué fallaba: tras exportar, el aviso «Guardado:
  <fichero>» ensanchaba la cabecera de la tarjeta de SLOs más que su columna (a 1024 px o menos) y
  el botón de exportar se salía de la tarjeta y quedaba debajo de «Salud de servicios»: no se podía
  volver a exportar hasta recargar. Cambio (`ExportMenu.tsx`, `HomePage.tsx`): el aviso se queda,
  pero encoge y se recorta con «…» (texto entero en el `title`); el botón y el título de la tarjeta
  no encogen. Medido: la cabecera de la tarjeta ocupa 196 de 211 px a 960 px.

CI: `actions/checkout@v7` y `actions/setup-node@v7` (versión elegida en "Verificación", CA6).

Developer: `npm run check` en verde (94 ficheros, 1989 tests); `npm run test:e2e` 179 en verde;
`npx playwright test e2e/views.spec.ts -g "0005" --repeat-each 5 --workers=1` 40 en verde (8 tests
× 5).
