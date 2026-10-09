---
id: '0064'
titulo: '«Reintentar» de un panel solo vuelve a pedir lo suyo (y arreglos pequeños de la interfaz)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: auditoria-interfaz
depende_de: ['0058']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0064-reintentar-solo-su-panel
adrs: [4]
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 0
---

## Petición original

Lote «auditoria-interfaz», de la revisión de código del 2026-10-09 (hallazgos C-03, C-08, C-09, C-10,
C-13 y C-14). La revisión no se guarda en el repositorio: esta ficha lleva lo necesario. El
principal es C-03.

## Especificación

**1. «Reintentar» (C-03, el importante).** `components/PanelBoundary.tsx` hace
`queryClient.refetchQueries({ type: 'active' })`: un panel que falla y un clic en «Reintentar»
vuelven a pedir **todas** las consultas activas de la app (en un problema con quince evidencias con
métrica, el detalle y quince consultas de métricas; en un host, todos sus canales). Gasta cuota del
cliente en contra del ADR-0004, justo cuando algo falla.

- `PanelBoundary` recibe `onRetry` opcional. Por defecto, «Reintentar» solo limpia el error y vuelve
  a pintar con la caché. Quien deba recargar datos pasa su `refetch`: el gráfico de entidad, el de
  Métricas, el mini gráfico de cada evidencia, la línea de tiempo y la tabla de Problemas.
  `app/RouteError.tsx` igual.

**2. Arreglos pequeños:**

- **C-08:** `settings/SecretsPanel.tsx`: el efecto que avisa al formulario de que un secreto está
  «sucio» no se limpia al desmontarse; al pasar un entorno a Managed y guardar, sale «Hay secretos
  sin guardar» por un campo que ya no existe. Añadir la limpieza
  (`return () => onDirtyChange?.(kind, false)`).
- **C-09:** el token guardado con `secrets:set` se queda unos minutos en la caché de mutaciones de
  TanStack Query (`reset()` no la borra). `useTenantMutation` acepta `gcTime` y la fila del secreto
  pasa `0`.
- **C-10:** `main.tsx` espera a `app:getInfo` sin tiempo máximo antes del primer render. Un
  `Promise.race` con unos 2 s y valores por defecto; y sembrar la caché para que la barra lateral no
  repita la llamada.
- **C-13:** `DataGrid.tsx`: el `requestAnimationFrame` del scroll no se cancela al desmontar; añadir
  la limpieza.
- **C-14:** `MarkdownText.tsx`: los títulos del Markdown del tenant salen como `h1`…`h6` reales y
  entran en la jerarquía de la página (lectores de pantalla). Comprobar si las fichas 0038 y 0043 ya
  lo resolvieron; si no, pintarlos como `p` con `role="heading"` y `aria-level` de 5 o 6
  (`Math.min(6, 4 + nivel)`), con las mismas clases.

## Criterios de aceptación

- CA1 (e2e): en un problema del simulador con varias evidencias con métrica, se provoca el fallo de
  un panel y, al pulsar «Reintentar», el simulador no recibe ninguna `GET /api/v2/metrics/query`
  nueva (comportamiento por defecto).
- CA2 (e2e): en un gráfico de entidad cuyo canal falló, «Reintentar» pide solo ese canal una vez.
- CA3 (e2e): escribir en un secreto de plataforma, pasar el entorno a Managed, guardar y confirmar no
  muestra «Hay secretos sin guardar».
- CA4 (unitario): tras guardar un secreto y `reset()`, la caché de mutaciones no contiene ninguna con
  el valor.
- CA5 (unitario): sin respuesta de `app:getInfo`, el primer render ocurre a los ~2 s con los valores
  por defecto.
- CA6 (unitario de componente): `# a` sale con nivel 5 y `###### b` con nivel 6, sin `h1`…`h6` (si
  no lo resolvió ya la 0038).

## Pruebas a mano para Dani

(ninguna)

## Fuera de alcance

- Otros cambios de la interfaz.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
