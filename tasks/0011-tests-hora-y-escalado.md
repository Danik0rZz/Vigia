---
id: '0011'
titulo: Tests que dependen de la zona horaria o del escalado del escritorio
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
