---
id: '0021'
titulo: Todos los e2e con la ventana del tamaño del CI, también en la VPS
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0021-e2e-ventana-ci
adrs: [6]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Propuesta del Orquestador (2026-10-07), que el Planificador le ofrece a Dani: "una ficha pequeña
para que el e2e completo se pueda lanzar con la ventana del tamaño del CI y que el verifier lo haga
siempre. Ya van tres tests que pasan en la VPS y fallan en el CI; dos por el tamaño de la ventana.
Encaja delante del lote «host», que tiene mucha interfaz nueva."

## Especificación

**El problema.** La app abre la ventana a 1280×800 (`src/main/window.ts`). En la VPS cabe; en el
runner del CI (pantalla de 1024×768) Windows la recorta. Solo los tests que usan `withContentSize`
fijan el tamaño (`FIXED_WINDOW` de la 0005: 1024×720 de contenido, que cabe en el CI). El resto
corre con ventanas distintas en cada sitio, y lo que pasa en la VPS puede fallar en el CI.

**El arreglo, solo en los tests** (la app no cambia):

- Una función común en `e2e/window-size.ts` (por ejemplo `useCiWindow(electronApp)`) que, nada más
  arrancar la app en cada spec, fija el contenido de la ventana a `FIXED_WINDOW` (1024×720) desde
  main con `setContentSize` y espera a tenerlo (con el margen de 2 px de la 0011 por el escalado).
  `FIXED_WINDOW` y `SMALL_WINDOW` pasan a ese fichero, de donde los importan los specs.
- Todos los specs que arrancan la app la llaman (`errors`, `shell`, `smoke`, `tenants`, `tls` y
  `views`). `withContentSize` sigue para los tests que necesitan otro tamaño y, al acabar, vuelve a
  `FIXED_WINDOW`.
- Los tests que hoy pasan solo porque la ventana es más grande se ajustan para que comprueben lo
  mismo con 1024×720 (scroll hasta el elemento, por ejemplo), sin quitar comprobaciones. Si alguno
  destapa un fallo de la app con esa ventana, se arregla la app y se le avisa a Dani (regla de la
  0005).
- Así el e2e completo del verifier en la VPS ya corre con la ventana del CI; no hace falta un modo
  aparte. `e2e/CLAUDE.md` lo dice en una línea (doc-writer).

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario): un test recorre `e2e/*.spec.ts` y falla si un spec arranca la app
  (`_electron.launch` o el lanzador común) sin llamar a `useCiWindow` justo después.
- CA2 (e2e): en cada spec, un test comprueba al empezar que el contenido de la ventana mide
  1024×720 (con el margen de 2 px).
- CA3 (e2e): tras un `withContentSize(SMALL_WINDOW)`, el test siguiente vuelve a tener 1024×720.
- CA4 (verifier): el e2e completo pasa en la VPS sin fallos, y el CI del push sale en verde.

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Cambiar el tamaño por defecto de la ventana de la app.
- Probar con varias resoluciones o escalados en el CI.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO (ficha ligera)

- Tests del developer (`14e74a1`) por criterio; sin tocar después (solo imports y llamadas). CA2 es el primer
  test de cada spec; CA3 parte de 1000×650 para distinguir "vuelve a FIXED_WINDOW" de "vuelve a como
  estaba"; CA4 es del verifier.
- CA1 lee los specs con el AST de TypeScript (robusto ante el formato), cubre el relanzamiento de
  `tenants` y rechaza los casos malos; `LAUNCHING_SPECS` evita que pase en vacío.
- La excepción de lint `react-hooks/rules-of-hooks` en `e2e/**` se acepta: el CA1 nombra `useCiWindow`.
- Opcionales: renombrar y quitar la excepción en otra ficha; reflujo de dos JSDoc en `views.spec.ts`
  (1747-1749, 5970); `isUseCiWindow` no comprueba el argumento; actualizar la línea 22 de
  `e2e/CLAUDE.md`. El campo `rama` ya está corregido.

## Verificación

(pendiente)

## Resultado

- (developer) `useCiWindow(app)` en `e2e/window-size.ts`, junto a `FIXED_WINDOW`, `SMALL_WINDOW` y `viewportSize(page)`; los seis specs lo llaman justo después de `electron.launch` (en tenants, dentro de su lanzador `launch()`, que cubre el relanzamiento). `withContentSize` y `withContentWidth` vuelven a `FIXED_WINDOW` al acabar, no al tamaño de antes.
- (developer) CA1 en `scripts/e2e-ci-window.test.ts` (vitest ya recoge `scripts/**`): lee cada spec con el AST de TypeScript y exige que la sentencia siguiente al `launch` del `_electron` de Playwright sea `await useCiWindow(...)`; también fija la lista de specs que arrancan la app, para que no pase en vacío.
- (developer) CA3 en dos tests seguidos de `views`: el primero parte de 1000×650 (otro tamaño dentro de los mínimos) para distinguir «vuelve a FIXED_WINDOW» de «vuelve a como estaba»; el segundo comprueba al empezar que hereda 1024×720.
- (developer) `eslint.config.mjs`: `react-hooks/rules-of-hooks` desactivada en `e2e/**` (sin React); si no, marca `useCiWindow` dentro del `launch()` de tenants por empezar por «use».
- (developer) Con la ventana a 1024×720 no falló ningún test que hubiera que ajustar ni salió ningún fallo de la app: e2e completo en la VPS, 209 de 209, dos veces.
