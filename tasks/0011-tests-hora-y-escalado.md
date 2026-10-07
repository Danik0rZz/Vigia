---
id: '0011'
titulo: Tests que dependen de la zona horaria o del escalado del escritorio
estado: verificada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio-2
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0011-tests-hora-y-escalado
adrs: [6]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Lote «servicio-2» (0011 a 0015). El Orquestador avisó a Dani (por Telegram) de dos fallos de tests
y recomendó una ficha ligera que los arregle, por delante del resto:

- El CI está en rojo desde la ficha 0009 por un test que supone la hora de Madrid (el runner de
  GitHub está en UTC).
- Tres e2e de la 0005 que usan `withContentSize` (CA1, CA2 y CA4) fallan solo en la VPS: con el
  escritorio remoto al 150 %, Windows deja la ventana en 960×602 en lugar de 960×600 (mejora anotada
  en el BACKLOG, surgida en la 0006).

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «servicio-2»:** separador de miles siempre que
el número tenga 4 cifras o más, con punto en español («9.907», no «9907»; Dani: "más elegante y
cuidado"); la información de la entidad, breve, bonita y ágil, pero con el detalle a mano.

**1. Zona horaria.** El developer localiza el test en el log del CI rojo
(`gh run view <id> --log-failed`, el último run rojo de `main`) y lo hace independiente de la zona
horaria de la máquina: lo esperado se calcula con la misma zona en la que se formatea, o el test
fija la zona de forma explícita en su propio código. No se cambia la zona de todo el proceso de
tests (`TZ` global en la configuración), porque escondería fallos reales con otras zonas. Si al
buscarlo aparecen otros tests con el mismo supuesto, entran aquí.

**2. Escalado.** `withContentSize` (`e2e/views.spec.ts`) espera hoy el tamaño exacto pedido. Pasa a
aceptar el redondeo de Windows al escalar: hasta **2 px** de diferencia en ancho y en alto, y en ese
caso usa el tamaño real para lo que venga después. Las comprobaciones de los tests no cambian (no
es una tolerancia para que pasen, sino la precondición de tamaño de ventana). El margen de 2 px es
el máximo observado (602 frente a 600).

**Al terminar:** se quita la mejora anotada del escalado del BACKLOG.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (unitario): el test de la zona horaria pasa ejecutado con `TZ=UTC` y con
  `TZ=Europe/Madrid` (el verifier lanza los dos y lo copia en "Verificación").
- CA2 (unitario): un test de la función de tamaño (sacada a una función pura si hace falta) acepta
  600×602 y 601×600 para 600×600 pedido, y rechaza 600×603.
- CA3 (e2e): los tres e2e de la 0005 con `withContentSize` (CA1, CA2 y CA4) pasan en la VPS al
  150 %, con `--repeat-each 5 --workers=1`.
- CA4 (verifier): `npm run check` y el e2e completo pasan en la VPS sin fallos.

## Pruebas a mano para Dani

- Que el CI del push de esta ficha sale en verde.

## Fuera de alcance

- Otros e2e intermitentes anotados en el BACKLOG (por ejemplo, `views.spec.ts:2482`).
- Cambiar el escalado de la VPS.

## Ideas surgidas (fuera de alcance)

- (developer) Decisión: las ayudas puras viven en `e2e/local-time.ts` y `e2e/window-size.ts`
  (las usa Playwright) y se prueban en `src/test/e2e-support.test.ts`, porque Vitest solo recoge
  `src/` y `scripts/` y Playwright recogería un `*.test.ts` dentro de `e2e/`. Al no tener
  área en `e2e/areas.json` (como `hover.ts`), tocarlas lanza el e2e completo.
- (developer) Decisión: el CA5 (0009) calcula lo esperado con la zona del renderer
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`), que es en la que la app lee el campo
  `datetime-local`. No se fija `TZ` en el lanzamiento de la app.
- (developer) Electron en Windows sí respeta `TZ` (main y renderer; probado con UTC, Asia/Tokyo y
  America/New_York). Ojo: desde Git Bash, `TZ=Europe/Madrid` (con barra) no llega al proceso
  (MSYS lo descarta y queda la zona del sistema); `TZ=UTC` sí. Para otra zona, lanzarlo desde
  Node (`spawnSync(..., { env: { ...process.env, TZ } })`) o PowerShell.
- (developer) CA1 en Vitest: `vitest.config.ts` fija `TZ=Europe/Madrid` para todo el proceso,
  así que `TZ=UTC npx vitest` no cambia nada. El test cambia `process.env.TZ` él mismo (Node la
  relee) y comprueba en UTC y en Europe/Madrid, incluido que coincide con `new Date(local)`.

## Notas del revisor

### Ronda 1: APROBADO (ficha ligera)

- Los tests del developer (`4644e49`) cubren CA1 y CA2 tal como están escritos y fallaban sin el código;
  no se tocan después. CA3 y CA4 los confirma el verifier.
- Escalado: el margen solo afecta a la espera del tamaño; ninguna aserción de los cuerpos se ablanda;
  `body` recibe el tamaño real.
- Zona horaria: lo esperado se calcula en la zona del renderer; no se fija `TZ`; no esconde un fallo de
  la app. No queda otro test que suponga Madrid.
- Ayudas en `e2e/` probadas desde `src/test/`: razonable.
- Opcionales: el verifier lanza también el e2e CA5 (0009) con `TZ=UTC` y `TZ=Europe/Madrid` (desde
  Node o PowerShell); comentario en `withContentSize` de que hoy ningún cuerpo usa `actual`.

## Verificación

- Tests (ficha ligera): commit 4644e49. Arreglo: 0f290bb.
- CA1 → `src/test/e2e-support.test.ts`, «CA1 (0011): …» (UTC y Europe/Madrid dentro del test).
- CA2 → `src/test/e2e-support.test.ts`, «CA2 (0011): …».
- CA3 → los e2e «(0005)» de `e2e/views.spec.ts` con `withContentSize` (CA1 ×2, CA2 ×2, CA4 ×2).
- Developer (VPS al 150 %): `-g "(0005)" --repeat-each 5 --workers=1`: 40 passed. e2e completo:
  197 passed; con `TZ=UTC`: 197 passed. CA5 (0009) con `TZ=America/New_York` (desde Node): ok.
  `npm run check`: 2134 tests en verde.

### Verifier, 2026-10-07, commit `b96b7fc`, rango `main..b96b7fc`: VERDE

- check: 2134 tests en 106 ficheros, cobertura ok.
- CA4: e2e completo en la VPS al 150 % de escalado: **197/197, sin ningún fallo**.
- CA3: `views.spec.ts -g "(0005)" --repeat-each 5 --workers=1`: 40/40.
- CA1: e2e «CA5 (0009)» desde PowerShell con `$env:TZ=UTC` 1/1 y `$env:TZ=Europe/Madrid` 1/1; el
  unitario cambia la zona él mismo y comprueba las dos.

## Resultado

(pendiente)
