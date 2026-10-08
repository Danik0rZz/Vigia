---
id: '0039'
titulo: 'HOST: memoria total y memoria recuperable en el marcador y el gráfico de memoria'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host-2
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0039-host-memoria-total-recuperable
adrs: [2, 4]
adr_nuevo:
api: v2, `GET /metrics/{metricId}` y `GET /metrics/query` con `builtin:host.mem.total` (confirmada en vivo en la 0016) y `builtin:host.mem.recl` (la dio Dani; a confirmar); `..\API\Dynatrace Environment APIv2\APIv2.json`. Scope `metrics.read`.
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host-2» (0039 a 0042). Dani (2026-10-09), sobre la página del host: "Tenemos la de la memoria
en uso, pero creo que es interesante plasmar además la memoria total (`builtin:host.mem.total`) y
`builtin:host.mem.recl` (lee la descripción)", filtradas por el host.

## Especificación

- **Paso 0 (en vivo, solo lectura):** descriptor de `builtin:host.mem.recl` (si existe, unidad,
  agregaciones y su `description`) y que tiene datos en los hosts de muestra de la 0016. Si no
  existe, se busca con `GET /metrics?text=reclaimable` y se anota.
- **Canal `entities:hostMetrics`:** añade a las series `memoryBytes` con `used`, `reclaimable` y
  `total` (bytes), y a los totales la memoria total y la recuperable (último dato).
- **Marcador «Memoria»:** valor principal, el % usado (como hoy); debajo, «usada / total» y
  «recuperable».
- **Gráfico «Memoria»:** pasa a bytes (GB adaptados): usada y recuperable apiladas en área y la
  total como línea discontinua. El % sigue en el tooltip.
- **Qué es la recuperable:** un icono de ayuda junto a la palabra con un tooltip, en es y en,
  redactado a partir de la `description` del descriptor (la memoria que el sistema puede liberar si
  hace falta, como cachés), sin copiarla tal cual si está en inglés.

## Criterios de aceptación

- CA1 (live, solo lectura): el informe dice si `builtin:host.mem.recl` existe, su unidad y si hay
  datos. Se salta sin `.env.live.local`.
- CA2 (unitario, main): las consultas llevan `builtin:host.mem.total` y la recuperable confirmada,
  y la salida trae `memoryBytes` y los totales nuevos.
- CA3 (e2e): el marcador enseña usada / total y recuperable; el gráfico de memoria tiene las series
  usada, recuperable y total (`data-series`).
- CA4 (e2e): el tooltip de ayuda de «recuperable» sale con el ratón y con el foco.
- CA5 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un host real, que total, usada y recuperable cuadran con Dynatrace.

## Fuera de alcance

- Swap y memoria por proceso.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
