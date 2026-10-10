---
id: '0063'
titulo: 'Exportación: fechas del XLSX en hora local, TXT con tablas grandes y fecha local en el fichero de configuración'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

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

## Resultado

(pendiente)
