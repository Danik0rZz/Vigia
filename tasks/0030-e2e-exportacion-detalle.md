---
id: '0030'
titulo: El e2e de la exportación del detalle de un problema lee el fichero cuando ya tiene contenido
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
