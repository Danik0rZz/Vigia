---
id: '0009'
titulo: 'SERVICE: cuatro gráficos (tiempos, actividad OK/KO, tasa de error y errores)'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: servicio
depende_de: ['0006', '0008']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0009-servicio-graficos
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:serviceMetrics` de la 0006)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «servicio» (0006 a 0010). Dani pasó como ejemplo la sección «Request metrics» de Dynatrace:
cuatro gráficos en una rejilla de 2×2. "Tiempos: 3 series, AVG, p90 y p99. Actividad: agrupada por
OK y KO. Errores: actividad KO. Tasa de error." La petición completa está en la ficha 0006.

## Especificación

**Decisiones de Dani (2026-10-07), al aprobar el lote:** tiempos con **mediana**, p90 y p99 (no la
media); OK = total − KO; marcador de tasa de error del rango (KO / total); la franja de problemas
sobre la tasa de error va en este lote (ficha 0010). Dani autoriza las lecturas de solo lectura del
tenant de pruebas que hagan falta para validar (`npm run test:live`).

Debajo de los marcadores (0008), una sección «Métricas de peticiones» con una **rejilla de 2×2**
(una columna si la ventana es estrecha), con `Chart.tsx` y el eje de tiempo de `chart-time.ts`
(0.10.2):

| Gráfico (posición)      | Tipo            | Series                                          | Eje Y     |
| ----------------------- | --------------- | ----------------------------------------------- | --------- |
| Tiempo de respuesta (1) | líneas          | mediana, p90 y p99 (tres colores del tema)      | ms o s    |
| Actividad (2)           | barras apiladas | OK (verde del tema) y KO (rojo del tema) encima | /min      |
| Tasa de error (3)       | línea           | tasa de error                                   | % (0–100) |
| Errores (4)             | barras          | KO (rojo del tema)                              | /min      |

- **Por minuto:** las barras se normalizan a peticiones por minuto con la `resolution` devuelta
  (con `1m` es el valor tal cual; con `5m`, el valor / 5), como hace Dynatrace («2K /min»). El
  tooltip da el valor por minuto y el total del intervalo.
- **Tooltip** con la fecha y hora completas y el valor de cada serie con su unidad. Leyenda
  pulsable para ocultar series.
- **Huecos:** un `null` es un hueco en la línea o una barra que falta, no un 0.
- **Cada gráfico** con su título y, a la derecha, «Abrir en Métricas» (como en las evidencias), que
  abre la consulta de ese gráfico con el rango que se ve. La consulta que se abre la construye la
  interfaz con el id ya validado de la ruta.
- Cada gráfico se carga y falla por su lado (esqueleto; aviso compacto con Reintentar).
- Colores del tema y contraste (el test de contraste de `check`); claro y oscuro.
- Mismo rango global y «Actualizar» que los marcadores; sin refresco solo (ADR-0004). Los cuatro
  gráficos usan una sola llamada a `entities:serviceMetrics` (la misma que los marcadores, compartida
  por TanStack Query).
- Exportar cada gráfico con el `ExportMenu` existente (imagen y XLSX), como el gráfico de Métricas.
- Textos en es y en.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1 (e2e): en la página de un SERVICE del simulador salen los cuatro gráficos en su orden, con
  su título y su `canvas`, y las series de cada uno (atributo `data-series`, como en Métricas):
  `[mediana, p90, p99]`, `[OK, KO]`, `[tasa]` y `[KO]`.
- CA2 (unitario): la opción de ECharts de Actividad apila OK y KO en el mismo `stack` y los valores
  van normalizados por minuto con la resolución (`1m`, `5m` y `1h`).
- CA3 (unitario): los `null` de una serie quedan como hueco (`null` en la opción), no como 0.
- CA4 (unitario): eje Y de tiempos en ms o s según el máximo, de la tasa en % y de las barras con
  «/min», en es y en.
- CA5 (e2e): «Abrir en Métricas» de cada gráfico abre Métricas con la consulta de ese gráfico y el
  rango que se ve.
- CA6 (e2e): con la ventana estrecha, una columna; con la normal, dos.
- CA7 (e2e): si el canal falla, los cuatro gráficos enseñan el aviso con Reintentar; los
  problemas de los marcadores siguen.
- CA8 (e2e): la exportación XLSX de un gráfico trae sus series y la hoja Info con el rango.
- CA9 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con un servicio real, que los cuatro gráficos se parecen a los de Dynatrace en el mismo rango
  (forma, unidades y escala) y se leen bien en claro y en oscuro.
- «Abrir en Métricas» desde cada gráfico.

## Fuera de alcance

- La franja de los problemas encima de la tasa de error: ficha 0010, del mismo lote.
- Los menús «⋮» y los «Analyze …» de Dynatrace (aquí, «Abrir en Métricas» y exportar).
- Desglose por endpoint, por código HTTP o por clave de petición.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

**Tests (commit `123b4fa`).** Fallan porque el código aún no existe, no por el propio test
(vitest: `./service-charts` no existe y faltan `entities.service.charts.*`; e2e: no aparece
`service-charts`).

- CA1 → `e2e/views.spec.ts`, «CA1 (0009): en la página de un SERVICE salen los cuatro gráficos…»
  (`SERVICE-00000000000E2E01`: orden, título, `canvas` y `data-series` leído con espera; además,
  dos consultas al simulador: una sola llamada al canal).
- CA2 → `src/renderer/src/pages/entities/service-charts.test.ts`, describe «CA2 (0009)» (mismo
  `stack`, OK y después KO; `1m`, `5m` y `1h`; y Errores, que también son barras por minuto).
- CA3 → mismo fichero, describe «CA3 (0009)» (hueco en los cuatro gráficos; las líneas sin
  `connectNulls`).
- CA4 → mismo fichero, describe «CA4 (0009)» (ms o s según el máximo, %, «/min»; es y en).
- CA5 → `e2e/views.spec.ts`, «CA5 (0009): «Abrir en Métricas» de cada gráfico…» (con 2 h: hasta
  ahora y 2 h exactas; con un rango personalizado, el `from`/`to` exactos del canal en los cuatro;
  la consulta lleva las métricas de ese gráfico y el id, y ninguna de los otros).
- CA6 → `e2e/views.spec.ts`, «CA6 (0009): con la ventana estrecha…».
- CA7 → `e2e/views.spec.ts`, «CA7 (0009): si el canal falla…» (`sim.serviceMetricsFail`; aviso con
  `role="alert"` y Reintentar en cada gráfico; problemas 1 y 2; Reintentar recupera).
- CA8 → `e2e/views.spec.ts`, «CA8 (0009): la exportación XLSX de un gráfico…» (Tiempo de
  respuesta, leído tras «Guardado»: valores en ms y nombres de sus tres series, ninguno de
  Actividad; Info con «Rango» `now-2h` y Desde/Hasta a 2 h).
- CA9 → `src/renderer/src/locales/service-charts.test.ts`, describe «CA9 (0009)».

**Nombres que fijan los tests (la ficha no los daba).**

- Opción de ECharts en `src/renderer/src/pages/entities/service-charts.ts`:
  `serviceChartOption(kind: ServiceChartKind, data: ServiceMetricsResult, context: { colors:
ChartColors; language: string; t: TFunction }): EChartsCoreOption`, con
  `ServiceChartKind = 'responseTime' | 'activity' | 'errorRate' | 'errors'`. Series en el orden de
  la ficha (Tiempos: tres `line`; Actividad: dos `bar`, OK y KO; Tasa: una `line`; Errores: una
  `bar`); puntos como `[tiempo, valor]` (también vale el valor suelto o `{ value }`). La unidad del
  eje Y va en `yAxis.axisLabel.formatter` (función o plantilla con `{value}`): «800 ms», «1,5 s»
  (en «1.5 s»), «25 %» y «… /min». Los colores del test llevan `success` por si el tema añade el
  verde.
- Textos en `entities.service.charts` de common: `title` («Métricas de peticiones»),
  `responseTime`, `activity`, `errorRate` y `errors` (en es, los de la tabla de la ficha). Nombres
  de serie: los de `data-series` deben casar con /mediana/i, /p90/i, /p99/i; /\bOK\b/, /\bKO\b/;
  /tasa/i; /\bKO\b/ (en español).
- Testids: sección `service-charts`; cada gráfico en `service-chart-panel` con `data-kind`
  (`response-time`, `activity`, `error-rate`, `errors`, en ese orden en el DOM), título en un
  encabezado (`role="heading"`); dentro, el `Chart` con testid `service-chart-<kind>` (que es
  también el `target` de su `ExportMenu`) y el botón `service-chart-open` («Abrir en Métricas»).
  Con el canal caído, el panel sigue, sin `service-chart-<kind>`, con `role="alert"` y
  «Reintentar».
- CA6: «estrecha» es la ventana más pequeña que permite la app (960 de ancho, `minWidth`) y
  «normal» la de los e2e (1024, `FIXED_WINDOW`; el CI no da más). El cambio de columnas tiene que
  estar entre los dos (por ejemplo, `lg:` de Tailwind, 1024 px). El test fija solo el ancho
  (`withContentWidth`, nuevo): espera al ancho exacto y no al alto, que no influye en las columnas.
  Con `withContentSize` fallaría en esta VPS por el escalado al 150 % (alto de 601 o 602 px, como
  los de la 0005); así no depende de ese redondeo, sin tolerancias en lo que se comprueba.

**Decisiones del developer.**

- Colores: mediana con `--accent`, p90 y p99 con dos tokens nuevos (`--chart-2`, `--chart-3`, claro
  y oscuro) y OK con `--status-closed` (verde ya existente). `ChartColors` gana `success`,
  `series2` y `series3`; `src/main/env-colors.test.ts` comprueba ≥ 3:1 frente a `--background`
  y que las tres series de tiempos se distinguen.
- Exportación con `module: metrics` (no hay módulo de exportación de entidades y añadirlo tocaba
  el esquema del canal); columnas Fecha, Serie, Valor y Unidad (ms, % o /min), con la consulta del
  gráfico en Info.
- «Abrir en Métricas»: la consulta la construye `serviceChartSelector` (`service-charts.ts`) con
  el mismo filtro que main; Actividad abre peticiones y errores (Métricas no resta OK). El rango
  relativo se cuenta desde que llegaron los datos (`dataUpdatedAt`), como la hoja Info.
- Sin acceso al módulo de Métricas no se pinta la sección (los marcadores ya enseñan «—»).
- Eje Y de las barras en notación compacta del idioma («2K /min», «2 mil /min»).

## Resultado

(pendiente)
