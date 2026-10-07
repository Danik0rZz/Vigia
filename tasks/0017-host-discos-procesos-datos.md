---
id: '0017'
titulo: 'HOST: canal con el detalle por disco y los procesos que más consumen'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: host
depende_de: ['0016']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0017-host-discos-procesos-datos
adrs: [2, 4, 5]
adr_nuevo:
api: v2, `GET /metrics/{metricId}`, `GET /metrics` (`text`) y `GET /metrics/query` (`metricSelector`, `entitySelector` con criterios de relación, `resolution`, `from`, `to`); `..\API\Dynatrace Environment APIv2\APIv2.json` y "Entity selector" / "Metrics selector transformations" de la documentación oficial. Scope `metrics.read` (ya en uso).
migracion: no
rondas_revision: 0
---

## Petición original

Lote «host» (0016 a 0020). La petición completa está en la ficha 0016: el host tiene "disco, red,
memoria, CPU, procesos…".

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote «host»:** umbrales de color del 80 % (aviso) y
90 % (error) en CPU, memoria y disco, siempre con texto; los 10 procesos con más CPU.

**Métricas candidatas** (a confirmar en el paso 0, con la misma regla que la 0016: ninguna sin
confirmar; si no existe, la integrada equivalente con `GET /metrics?text=` o se quita y se anota):

| Para                          | Candidata                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Uso de cada disco             | `builtin:host.disk.usedPct`, `builtin:host.disk.avail`, `builtin:host.disk.used` (dimensión `dt.entity.disk`) |
| Lectura y escritura por disco | `builtin:host.disk.bytesRead` y `builtin:host.disk.bytesWritten`                                              |
| CPU por proceso               | `builtin:tech.generic.cpu.usage` (dimensión `dt.entity.process_group_instance`)                               |
| Memoria por proceso           | `builtin:tech.generic.mem.workingSetSize`                                                                     |

**Paso 0 (solo lectura),** en la prueba en vivo de la 0016 o en una propia, con los mismos 3 hosts:
descriptores de las candidatas; cómo limitar los procesos a los del host (con `entitySelector` por
relación, por ejemplo `type("PROCESS_GROUP_INSTANCE"),fromRelationships.isProcessOf(entityId("<id>"))`,
o con un filtro por la dimensión del host si la métrica la trae: se prueban las dos y se elige la
que funcione); si la respuesta trae el nombre de cada disco y proceso (`dimensionMap` con
`dt.entity.disk.name` o equivalente) o hace falta resolverlo; y tramos de número de discos y
procesos por host. Solo comportamientos en el informe.

**Canal `entities:hostBreakdown`** (Zod):

- Entrada: `environmentId`, `entityId` (`^HOST-…`, como la 0016) y `timeRange`.
- Salida:
  - `disks`: por disco, `id`, `name`, `usedPct` (último dato y máximo del rango), `used` y `avail`
    (bytes, último dato), `read` y `write` (bytes/s medios del rango). Ordenados del más lleno al
    menos; todos (se espera pocos por host).
  - `processes`: los **10** procesos del host con más CPU media del rango: `id`, `name`, `cpu`
    (media y máxima, %) y `memory` (media, bytes). `total` con cuántos procesos había.
- Main construye los selectores con el id validado. Errores con `reason`. Sin datos: listas vacías.
- El simulador de los e2e responde.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (live, solo lectura): el informe sale sin ids ni nombres y dice qué forma de limitar los
  procesos al host funciona. Se salta sin `.env.live.local`.
- CA2 (unitario, main): con `fetch` simulado, las consultas llevan las métricas confirmadas, el id
  del host (en el selector elegido) y el rango.
- CA3 (unitario, main): de una respuesta simulada con 3 discos y 15 procesos salen los discos
  ordenados por uso y los 10 procesos con más CPU, con `total` 15.
- CA4 (unitario, main): nombres sacados de `dimensionMap`; si falta, el id.
- CA5 (unitario, main): 400 o 404 → error con `reason`; sin datos → listas vacías.
- CA6 (e2e): el simulador responde y un test por IPC recibe lo esperado.

## Pruebas a mano para Dani

(en la 0019)

## Fuera de alcance

- Interfaces de red una a una (la red va sumada en la 0016).
- Procesos más allá de los 10 primeros o su detalle (su página de entidad, de momento en
  construcción).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
