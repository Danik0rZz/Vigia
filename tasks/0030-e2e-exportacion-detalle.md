---
id: '0030'
titulo: El e2e de la exportación del detalle de un problema lee el fichero cuando ya tiene contenido
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: Orquestador # en nombre de Dani: Dani delegó en el Orquestador las decisiones refinables mientras dormía (2026-10-07)
rama: fix/0030-e2e-exportacion-detalle
adrs: [6]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Ninguna de Dani: la abre el Orquestador porque el CI del push de la 0018 (run 37709717379, sobre
`af28a1e`) salió en rojo por este test, que no tiene que ver con la 0018. Dani pidió, al irse a dormir,
que la cola siguiera y que lo que se pudiera refinar se arreglara con fix pequeños. Decisión del
Orquestador en su nombre (2026-10-08).

## Especificación

`e2e/views.spec.ts`, «v0.9.0: exportación del detalle: XLSX con sus hojas e Info, en es y en; CSV
solo con las principales», falla de forma intermitente: en el CI con «End of data reached (data
length = 0, asked index = 4). Corrupted zip ?», y una vez en la VPS durante la 0014. Es la misma causa
que la 0005 arregló en otro test: `exportTo` da el fichero por listo en cuanto aparece su nombre, y
main lo escribe con `writeFile` directo, así que a veces se lee vacío.

- El test pasa a leer cada fichero con `exportSaved` (espera al aviso «Guardado: <fichero>» y a que el
  fichero tenga contenido), o con la misma espera dentro de su `workbook()`.
- Se buscan los demás usos de `exportTo` que lean el fichero justo después y se pasan igual a
  `exportSaved`. Si `exportTo` ya no tiene usos que lean el contenido, se deja solo para lo que no lo
  lee (o se quita) y se anota.
- Las comprobaciones del test no cambian. La app no cambia.

**Decisiones del developer (2026-10-08, delegadas por Dani; refinables):**

- **Todos los usos que leen el fichero, a `exportSaved`:** los once `readFileSync` de
  `exportTo(...)` de `e2e/views.spec.ts` y también las dos capturas PNG que lee `pngInfo`
  (lee el fichero con `nativeImage`; CA2 no las vigila). `exportTo` queda solo dentro de
  `exportSaved`, con un comentario que lo dice.
- **`exportSaved` acepta el aviso en es o en en:** el test del detalle exporta también con la
  interfaz en inglés, y con el texto español fijo fallaba siempre. La espera pasa a un
  `expect.poll` sobre los dos textos.
- **CA2** (`scripts/e2e-export-read.test.ts`): con el AST de TypeScript marca un `readFileSync` cuyo
  argumento es `await exportTo(...)` o una variable declarada con él (la declaración más cercana por
  bloques, para no confundir el `file` de un test con el de otro).
- **Espera copiada a mano (decisión del Orquestador, 2026-10-08):** los dos tests del mini gráfico de
  evidencias («v0.9.2: exportar las series del mini gráfico…» y «v0.10.2: «Abrir en Métricas» y la
  exportación del mini gráfico usan el rango visible») leían el fichero sin esperar al aviso. Pasan a
  `exportSaved`, que con `exportTo` y `exportNotice` acepta también el locator del menú dentro de
  su contenedor; sus comprobaciones no cambian. CA2 lo vigila: marca también un `readFileSync` cuyo
  argumento usa `exportDir` o llama a una función propia del spec que busca en `exportDir` (salvo
  `exportSaved`).
- El nombre del test de CA1 no cambia (no lleva «CA1 (0030)»): la ficha pide no tocarlo.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): el test de la exportación del detalle, sin cambiar ninguna comprobación, pasa con
  `--repeat-each 10 --workers=1`.
- CA2 (unitario): un test recorre `e2e/*.spec.ts` y falla si un `readFileSync` lee el resultado de
  `exportTo(...)` (en vez de `exportSaved(...)`).
- CA3 (verifier): `npm run check` y el e2e completo pasan sin fallos, y el CI del push sale en verde.

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Escritura atómica de las exportaciones en main (fuera de alcance ya en la 0005).

## Ideas surgidas (fuera de alcance)

(ninguna: la del mini gráfico de evidencias entró en la ficha por decisión del Orquestador)

## Notas del revisor

### Ronda 1: APROBADO (ficha ligera)

- CA1: solo cambian las lecturas (`exportTo` → `exportSaved`); ninguna comprobación cambia, tampoco en los dos
  tests del mini gráfico. `exportTo` solo se usa dentro de `exportSaved`.
- `exportSaved` no se ablanda: aviso exacto (es o en) en el contenedor del menú y fichero no vacío.
- CA2 detecta las lecturas sin `exportSaved`; `b9329a7` lo endurece por la decisión del Orquestador.
- Opcionales: CA2 no ve `let f; f = await exportTo(...)`; `usesExportDir` marcaría una lectura legítima de
  `exportDir` tras un `exportSaved` (hoy no existe).

## Verificación

(pendiente)

## Resultado

(pendiente)
