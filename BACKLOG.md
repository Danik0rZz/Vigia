# Backlog

Qué viene. Lo mantienen el Planificador (fichas nuevas) y el doc-writer (al cerrar una ficha). Lo
que ya se hizo está en `CHANGELOG.md`; las fichas, en `tasks/`. Nada pasa a "Próximo" sin el visto
bueno de Dani o de peticiones en su nombre.

## En curso

- [0001](tasks/0001-descripcion-evento-markdown.md): descripción del evento
  (`dt.event.description`) con formato Markdown en el detalle del problema, con «Con formato ·
  Texto original» y «Copiar». Aprobada por Dani el 2026-10-06.

## Próximo

(vacío: Dani elige de "Propuestas")

## Propuestas

Con su análisis (API, scopes, esfuerzo, riesgos y decisiones que necesitan de Dani) en
`docs/propuestas-siguientes.md`.

- Eventos en el detalle del problema (propuesta 2, S). Necesita antes una prueba en vivo de solo
  lectura de `evidenceDetails`.
- Agrupar Problemas por clúster (propuesta 3, S). Reabre la decisión de "sin agrupar".
- Gráfico de las evidencias de métrica METRIC (propuesta 4 bis, S o M).
- Unidad en los mini gráficos y en Métricas (propuesta 4 ter, S).
- Fusible de integridad del asar (propuesta 6, S). Necesita un perfil o una máquina virtual de
  prueba para arrancar el zip.
- Vista de Entidades (propuesta 1, L). Pide `entities.read`.
- Fase 8: DQL y Logs (propuesta 4, L). Coste por GiB escaneado; incluye el streaming de
  exportaciones y el aviso de filas de Excel en CSV.

## Mejoras anotadas

- **e2e de `views.spec.ts` que dependen de la máquina** (primer candidato a ficha). Fallan en el
  primer CI (`windows-latest`, run 37506732054, 2026-10-06) y en la VPS, sin cambios de código:
  - `:1605` (300 filas virtualizadas): espera la fila 150 y ve la 146 en el CI y la 140 en la VPS.
  - `:1413` (Problemas, detalle): la cabecera arrastrable (`app-drag`) intercepta el clic en la
    ruta de la barra superior.
  - `:3857` (i18n con el gráfico de Métricas): la serie llega vacía.
  - `:3962` (SLO de Inicio): se agota la espera de 5 s.
    Apuntan a la geometría de la ventana y a los tiempos del runner. Mientras no se arreglen, el CI
    sale en rojo. De paso: `actions/checkout` y `actions/setup-node` a una versión con Node 24 (aviso
    de deprecación de Node 20).

- Las vistas usan solo el token clásico; usar OAuth y el platform token en SaaS (ver la spec,
  "Funcionalidades").
- Particiones de red sin liberar (AUD-21, ADR-0003): cada `reset` deja la sesión anterior hasta
  cerrar la app. Es una limitación de Electron; solo se anota.

## Aparcado

- Monaco (fases 5 y 7): no se implementa ni se pregunta por él hasta que Dani lo retome.
- Sin definición cerrada, no se implementan: Service flows avanzados, Vista de negocio,
  notificaciones, Favoritos y variación de los KPI.

## Hecho

- Fases 1, 2, 3, 4 y 6 (primera versión, aceptada por Dani el 2026-10-04) y versiones 0.7.0 a
  0.10.2: ver `CHANGELOG.md`.
- CI en GitHub Actions sobre Windows (propuesta 5), montado con el flujo de agentes (ADR-0007).
