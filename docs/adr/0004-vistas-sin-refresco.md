# ADR-0004: Las vistas no se refrescan solas

Estado: aceptado (Fase 6, registrado el 2026-10-06)

## Contexto

Cada petición a Dynatrace gasta cuota de la API del tenant del cliente.

## Decisión

Las vistas de datos usan TanStack Query con `staleTime: Infinity` y `refetchOnMount: false`. Solo
"Actualizar" o una clave nueva (entorno, filtros, rango) piden datos.

## Alternativas descartadas

- Refresco periódico o al volver a la vista: multiplica las peticiones sin que nadie las pida.

## Consecuencias

Los cambios hechos por IPC directo no actualizan la interfaz: los e2e recargan tras preparar datos
por IPC.
