---
id: '0063'
titulo: 'Exportación: fechas del XLSX en hora local, TXT con tablas grandes y fecha local en el fichero de configuración'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-exportacion
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0063-exportacion-hora-local-y-txt-grande
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Lote «auditoria-exportacion», de la revisión de código del 2026-10-09 (hallazgos C-01, C-02 y C-11).
A la pregunta de si las fechas del XLSX van en hora local o en UTC, Dani (2026-10-10): "Hora local".

## Especificación

**1. Fechas del XLSX (C-01).** `src/main/export/xlsx.ts` escribe objetos `Date` con ExcelJS, que los
convierte a número de Excel en **UTC**; Excel enseña la hora UTC. En la hoja Info, la fila «Zona
horaria» dice la zona local del equipo: quien abre el fichero ve horas desplazadas una o dos horas.
CSV y TXT escriben ISO con la `Z` y no tienen el problema.

- Decisión de Dani: **hora local**. Una función `toExcelLocal(d)` que construye el instante con los
  componentes locales de la fecha (año, mes, día, hora, minuto y segundo locales, pasados a
  `Date.UTC`), usada en las celdas de datos y en las filas de fecha de Info.
- Prueba a mano para Dani: abrir un XLSX en Excel (va a `docs/pendiente-dani.md` al cerrar versión).

**2. TXT con tablas grandes (C-02).** `src/main/export/txt.ts` calcula el ancho de cada columna con
`Math.max(...array)` de `filas + 1` elementos; el máximo de filas exportables es 100 000, y por
encima de unos 120 000 argumentos Node lanza `RangeError` (el margen es del 20 % y depende de la
pila). Se cambia por un bucle.

**3. Fecha del fichero de configuración (C-11).** `config:export` nombra el fichero con
`toISOString().slice(0, 10)` (UTC): entre las 00:00 y las 02:00, hora peninsular, sale la fecha del
día anterior. `src/main/export/file-name.ts` ya usa hora local: se exporta de ahí
`localDateStamp(date)` y se usa en los dos sitios.

## Criterios de aceptación

- CA1 (unitario): con `TZ` fijado en el test, una fecha exportada a XLSX tiene el número de Excel que
  enseña la hora local (y las filas de fecha de Info también).
- CA2 (unitario): `buildTxt` con 100 000 filas y tres columnas no lanza y produce la cabecera y la
  regla esperadas.
- CA3 (unitario): el nombre del fichero de configuración a las 00:30 locales lleva la fecha local.

## Pruebas a mano para Dani

- Abrir un XLSX exportado en Excel y comprobar que las horas cuadran con la zona de la hoja Info.

## Fuera de alcance

- CSV y TXT (ya van en ISO con zona).

## Ideas surgidas (fuera de alcance)

- (developer) `csv.ts` construye las líneas con spread en literales de array (`[header, ...lines]`).
  No es el fallo de C-02 (el spread en un literal no pasa argumentos y no tiene ese límite), pero
  para ser coherente con el TXT se podría pasar a `concat`.

## Notas del revisor

### Ronda 1: APROBADO

CA1 a CA3 con su test (más el complemento de 300 000 filas), con lo esperado sacado de `Intl` con
zona explícita; sin tocarlos tras `7133a34`. Las dos adaptaciones de tests anteriores (`09d021f`,
`527d9d5`) solo cambian la zona esperada por la decisión de Dani y siguen probando el mismo instante;
el e2e del mini gráfico lee la zona del renderer y usa `wallTimeToEpoch`, así que vale en el CI (UTC)
y en la VPS (Madrid). `toExcelLocal` parte de un instante real con los getters locales (la hora que
no existe no puede salir; la repetida da la misma hora de pared). TXT sin spread de la tabla como
argumentos. El CSV sigue en ISO UTC con `Z`, fuera de alcance y sin ambigüedad. Sin IPC, API,
dependencias, esquema ni permisos; nada del tenant.

Opcional: en el e2e, una exportación justo en la hora repetida de una zona con cambio de hora puede
salirse una hora (no en el CI; en la VPS, una hora al año).

## Verificación

Tests escritos en `7133a34` (`test(export): criterios de la ficha 0063`). Los tres hallazgos seguían
en main al escribirlos (`xlsx.ts` escribe el `Date` tal cual, `txt.ts` con `Math.max(...)` y
`config:export` con `toISOString().slice(0, 10)`). La zona se fija en cada test con
`process.env.TZ` y lo esperado se calcula con `Intl` y zona explícita.

- CA1 → `src/main/export/xlsx.test.ts`, `CA1 (0063): las fechas del XLSX llevan el número de Excel
de la hora local`: celdas de datos (número y texto ISO) y filas Exportado, Desde y Hasta en
  Europe/Madrid, America/New_York, Asia/Kolkata y UTC (verano, invierno, día del cambio de hora y
  cambio de día local), más el número de Excel de un caso en Madrid. Se han actualizado a hora local
  de Madrid las aserciones UTC de los tests ya existentes del mismo fichero (datos, Info, rango y
  fecha ISO como texto): con la decisión de Dani dejan de ser ciertas.
- CA2 → `src/main/export/export.test.ts`, `CA2 (0063): buildTxt con tablas grandes`: 100 000 filas
  y tres columnas, cabecera y regla exactas. **Ojo:** tal como está escrito, CA2 ya pasa con el
  código actual (Node admite el spread con 100 001 argumentos; falla hacia 120 000-130 000). Se
  añade un complemento con 300 000 filas que sí reproduce el `RangeError` y que comprueba lo mismo;
  decisión razonable del test-writer, refinable.
- CA3 → `src/main/ipc/handlers/tenants.test.ts`, `CA3 (0063): el nombre del fichero de
configuración lleva la fecha local`: 00:30 en Madrid (verano e invierno), en Nueva York y control
  en UTC, mirando el nombre que `config:export` propone al diálogo.

Ejecución al escribirlos: 14 fallan por el comportamiento actual (CA1, complemento de CA2 con
`RangeError` y CA3 en Madrid y Nueva York); CA2 literal y los controles en UTC pasan.

### Verifier, 2026-10-10, commit `a976ac0`, rango `main..feat/0063-exportacion-hora-local-y-txt-grande`: VERDE

- check: 3437 tests en 197 ficheros, cobertura ok.
- Con `TZ=UTC` (zona del CI): exportación, `export.test.ts` y `tenants.test.ts`, 220/220.
- e2e afectados: 299/299.
- Mini gráfico y exportaciones de `views.spec.ts` ×3 con `--workers=1`: 27/27.

## Resultado

Desarrollo (developer):

- C-11: `localDateStamp(date)` en `src/main/export/file-name.ts` (exportada en `index.ts`), usada
  por `exportFileName` y por `config:export` (`src/main/ipc/handlers/tenants.ts`).
- C-02: en `src/main/export/txt.ts`, el ancho de cada columna sale de un bucle, y las líneas se
  juntan con `concat` en vez de hacer spread de la tabla.
- C-01: `toExcelLocal(date)` en `src/main/export/xlsx.ts`, para las celdas de fecha y para las filas
  Exportado, Desde y Hasta de Info. Usa los getters locales, que ya aplican el horario de verano que
  correspondía en esa fecha. `workbook.created` (metadato del fichero, no una celda) sigue siendo el
  instante real.

Decisiones razonables, refinables (la cola sigue delegada):

- `toExcelLocal` también conserva los milisegundos, aunque la especificación solo enumera hasta los
  segundos: no cambia lo que se ve (formato `hh:mm:ss`) y no recorta el valor.
- Dos tests anteriores a la ficha comprobaban las fechas del XLSX en UTC y dejaban de ser ciertos con
  la decisión de Dani. Se adaptan en commits propios sin cambiar qué prueban (qué instante va en cada
  fila): en `src/main/ipc/handlers/export.test.ts`, lo esperado pasa a la hora de pared de Madrid (la
  zona de `vitest.config.ts`) con `Intl`; en el e2e `v0.10.2: «Abrir en Métricas» y la exportación
del mini gráfico…` (`e2e/views.spec.ts`), las fechas leídas se pasan a instante con
  `wallTimeToEpoch` en la zona del renderer (pierden los segundos, dentro del margen de un minuto
  que ya tenía el test).

Cierre: 10 commits en `main..HEAD` (tests `7133a34`; correcciones `750c966`, `f913f71`, `4ea7cab`; adaptación de tests anteriores `09d021f` y `527d9d5`; más los de ficha). Ficheros principales: `src/main/export/xlsx.ts`, `txt.ts`, `file-name.ts`, `src/main/ipc/handlers/tenants.ts`. 1 ronda de revisión (APROBADO). ADR nuevo: ninguno. Sin migraciones.
