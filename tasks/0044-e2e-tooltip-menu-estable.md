---
id: '0044'
titulo: e2e estable del tooltip del menú plegado
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: peticiones (el Orquestador, por la delegación de Dani del 2026-10-09; ver la especificación)
rama: fix/0044-e2e-tooltip-menu-estable
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Sin petición de Dani: la abre el Orquestador. Dani delegó las decisiones mientras duerme («Si hay
que tomar decisiones, las tienes que tomar tú») y el test inestable frena la cola: cada CI rojo
obliga a relanzar antes de integrar la siguiente ficha.

## Especificación

El e2e `e2e/shell.spec.ts` › «maquetación del menú: icono y nombre en la misma fila, desplegado y
plegado; el activo se distingue» falló dos veces en el CI de `main` en la línea
`await expect(tooltip).toBeVisible()` tras `hoverFresh(page, page.getByTestId('nav-problems'))`,
con el menú recién plegado (run 37733715700, intento 1, push de la 0027; run 37861610406, intento
1, push de la 0037). Relanzado, pasó las dos veces; en local no falla.

Hipótesis a comprobar por el developer: al plegar el menú hay una transición de anchura; el hover
llega al centro del enlace mientras aún se mueve (o Radix aún no tiene el disparador en su sitio) y
el tooltip no se abre, o se abre y se cierra. Arreglo en el test o en `e2e/hover.ts`, no en la app:
esperar a que el menú esté quieto (por ejemplo, que la anchura del `aside` o la caja del enlace no
cambie entre dos lecturas) antes del hover, y, si no basta, reintentar el hover con
`expect.toPass` en un tiempo acotado. No se suben timeouts globales ni se añaden reintentos a
Playwright (`retries`). Si el developer encuentra que la causa es de la app (el tooltip no sale de
verdad tras plegar), lo dice y se para: eso sería otra ficha.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): el test del menú (o el bloque del tooltip, si se separa con su número) pasa 30 veces
  seguidas con `--repeat-each 30 --workers=1` y otras 30 con la ventana del CI y `--workers` por
  defecto.
- CA2 (e2e): el resto de `e2e/shell.spec.ts` y los e2e que usan `hoverFresh` siguen en verde.

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Cambiar el comportamiento del tooltip o del menú en la app.

## Reproducción (developer)

- Con el test tal cual, 30 de 30 en verde en local (`--repeat-each 30 --workers=1`): en local no
  falla.
- Medido en el test: `hoverFresh` lee la caja del enlace unos 85 ms después del clic en
  `sidebar-toggle`, con el `aside` aún a unos 110 px de los 56 finales (la transición de anchura dura
  200 ms). En local, el centro leído a esa anchura aún cae dentro del enlace plegado; si en el runner
  la lectura llega antes, cae fuera.
- Reproducción determinista: leer la caja de `nav-problems` justo tras el clic (222 px de ancho) y
  llevar el ratón a su centro deja el puntero a unos 128 px, fuera del menú ya plegado: el tooltip no
  sale (5 de 5 fallan). La causa es del test, no de la app: con el puntero dentro del enlace, el
  tooltip sale.
- Primer arreglo en `e2e/hover.ts`: `hoverFresh` y `moveToNeutral` leen la caja con `stableBox`.
  Esperar solo a que la caja no cambie entre dos lecturas no basta: con 4 workers a la vez, el
  renderer puede no pintar en la pausa y las dos lecturas dan la caja de antes de la transición. Por
  eso `stableBox` espera antes a que acaben las animaciones CSS finitas del documento
  (`document.getAnimations()`) y después a dos lecturas iguales separadas 50 ms (máximo 3 s). La
  reproducción determinista pasa 20 de 20.
- Segundo fallo, destapado por el primer arreglo: con `shell.spec.ts --repeat-each 5` y 4 workers,
  el test «tooltips del menú» falló en 3 de 10 tandas en `hoverFresh(nav-metrics)` con el menú recién
  plegado (en `main`, 8 de 8 en verde: ahí el punto neutro se leía a mitad de la transición, lejos
  del menú). Registrado en la página: el puntero sale del punto neutro, ya junto al menú plegado,
  cruza `nav-topology`; con la máquina cargada, cada paso tarda tanto que pasan los 300 ms de retardo
  y su tooltip se abre; al salir de él, Radix marca el puntero «en tránsito» e ignora los
  `pointermove` sobre `nav-metrics` hasta cerrar el de Topología, cosa que ocurre después del último
  paso. El puntero queda sobre el enlace (`:hover`) y el tooltip, cerrado. Es el mismo mecanismo que
  pudo darse en el CI en la línea del test del menú. Arreglo: al llegar, `hoverFresh` mueve el ratón
  1 px mientras siga abierto el tooltip de otro disparador y una vez más al final. Con él,
  `shell.spec.ts --repeat-each 5` pasa 12 de 12 tandas y `--repeat-each 30` (720 tests), en verde.
  No hizo falta `expect.toPass`.

## Ideas surgidas (fuera de alcance)

- (developer) `e2e/smoke.spec.ts` › «VIGIA_E2E: la ventana de la prueba se ve, pero no le quita el
  foco…» falló una vez en local en `npm run test:e2e:affected` con `visible: false` (la ventana aún
  no se veía al leerla, con 4 workers); relanzado, 280 de 280, y el spec solo con `--repeat-each 3`,
  en verde. No usa `hoverFresh`: si vuelve a salir, merece su propia ficha.

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
