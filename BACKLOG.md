# Backlog

Qué viene. Lo mantienen el Planificador (fichas nuevas) y el doc-writer (al cerrar una ficha). Lo
que ya se hizo está en `CHANGELOG.md`; las fichas, en `tasks/`. Nada pasa a "Próximo" sin el visto
bueno de Dani o de peticiones en su nombre.

## En curso

- [0003](tasks/0003-pagina-analisis-entidad.md): «Analizar entidad» en el detalle de las evidencias,
  con una página en construcción por tipo de entidad. Aprobada por Dani el 2026-10-06. La 0002
  (que también toca el detalle de la evidencia) ya está hecha.

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
  Líneas del spec tras la ficha 0001 (en el `main` anterior eran `:1605`, `:1413`, `:3857` y
  `:3962`):
  - `:1721` (300 filas virtualizadas): espera la fila 150 y ve la 146 en el CI y la 140 en la VPS.
  - `:1529` (Problemas, detalle): la cabecera arrastrable (`app-drag`) intercepta el clic en la
    ruta de la barra superior.
  - `:3978` (i18n con el gráfico de Métricas): la serie llega vacía. También falla aislado de
    forma intermitente (2/3 en la rama de la ficha 0002 y 1/3 en `main`), así que no depende solo
    del orden. Deducción del verifier en la ficha 0001, sin comprobar: lee `data-series` sin `expect.poll` justo después de `runMetric`, mientras aún se
    rehace el gráfico del test anterior.
  - `:4083` (SLO de Inicio): se agota la espera de 5 s.
    Apuntan a la geometría de la ventana y a los tiempos del runner. Mientras no se arreglen, el CI
    sale en rojo. De paso: `actions/checkout` y `actions/setup-node` a una versión con Node 24 (aviso
    de deprecación de Node 20).

- Las vistas usan solo el token clásico; usar OAuth y el platform token en SaaS (ver la spec,
  "Funcionalidades").
- Particiones de red sin liberar (AUD-21, ADR-0003): cada `reset` deja la sesión anterior hasta
  cerrar la app. Es una limitación de Electron; solo se anota.
- Guarda de las pruebas en vivo (`src/test/live-usage.test.ts`): limitar los patrones de módulos de
  red a `from`, `import(` y `require(`, y prohibir en `*.live.test.ts` un `import(` o `require(` con
  argumento no literal. Quita falsos positivos (tomaba los literales `'http'` y `'https'` de un test
  por un import de red) y cierra el atajo del nombre calculado. (surgió en 0001)
- Descripción del evento: si algún día aparecen descripciones de más de 5 000 caracteres, la nota
  de recorte podría ofrecer pedir la descripción entera a main bajo demanda. (surgió en 0001)
- El recorte de la descripción del evento (`slice`) puede partir un emoji por la mitad: retroceder
  una posición si cae en un sustituto alto. Poco probable con el tope de 5 000. (surgió en 0001)
- `remark-gfm` pinta las notas al pie con textos fijos en inglés (`Footnotes` y su aria-label): se
  pueden pasar sus etiquetas con `t()`. (surgió en 0001)
- El aviso de «Copiado» de la descripción no se borra hasta plegar la fila (coherente con las
  pantallas de error); valorar que desaparezca solo. (surgió en 0001)
- e2e de la descripción del evento: activar «Copiar» también con Espacio, no solo con Enter (antes
  se probaba sobre los botones del conmutador). (surgió en 0002)

## Aparcado

- Monaco (fases 5 y 7): no se implementa ni se pregunta por él hasta que Dani lo retome.
- Sin definición cerrada, no se implementan: Service flows avanzados, Vista de negocio,
  notificaciones, Favoritos y variación de los KPI.

## Hecho

- Fases 1, 2, 3, 4 y 6 (primera versión, aceptada por Dani el 2026-10-04) y versiones 0.7.0 a
  0.10.2: ver `CHANGELOG.md`.
- CI en GitHub Actions sobre Windows (propuesta 5), montado con el flujo de agentes (ADR-0007).
- [0001](tasks/0001-descripcion-evento-markdown.md): descripción del evento con formato Markdown en
  el detalle del problema, con «Copiar» (ADR-0008).
- [0002](tasks/0002-descripcion-siempre-markdown.md): la descripción del evento siempre con
  formato; se quitó el conmutador de la 0001 y se queda «Copiar».
