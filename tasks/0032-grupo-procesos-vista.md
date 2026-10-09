---
id: '0032'
titulo: 'PROCESS_GROUP: página con marcadores, gráficos, instancias e información'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: grupo-procesos
depende_de: ['0031', '0036', '0037']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0032-grupo-procesos-vista
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:processGroupMetrics` de la 0031, `entities:get`/`entities:names` de la 0014 y los canales de problemas de las fichas 0007 y 0010)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «grupo-procesos» (0031 y 0032). "Haz lo mismo para process_group". La petición completa está
en la ficha 0031.

## Especificación

En `ProcessGroupEntityPage.tsx` se quita «Página en construcción». Mismos componentes que el
proceso (0028) y el orden de página que dejan las fichas 0036 y 0037 (etiquetas arriba, información
abajo):

- **Marcadores:** Instancias (cuántas), CPU (media del grupo; debajo, máxima), Memoria (media),
  Red (entrada; debajo, salida) y Problemas. Umbrales de CPU como en el host (80/90 %, con texto).
- **Gráficos** (2×2, sin rejilla): CPU (con la franja de problemas), Memoria, Red y CPU por
  instancia (una línea por instancia, como mucho 5, las de más CPU).
- **Tabla «Instancias»:** nombre, host, CPU media (con barra) y memoria; ordenada por CPU; cada
  instancia enlaza a su página de proceso y su host a la del host.
- **Tarjeta «Información»** (al final, como todas tras la 0036): claves vistas en vivo en
  PROCESS_GROUP (`detectedName`, `listenPorts`, `softwareTechnologies` y `metadata`), con el mismo
  filtro de seguridad que la 0029 (nada de línea de comandos, argumentos, variables de entorno ni
  rutas completas); relaciones «Instancias», «Hosts», «Servicios» y «Otras», con «Ver nombres».
- Rango global, «Actualizar», errores por panel. Textos en es y en.

**Nota del Orquestador (2026-10-09, por la revisión de la 0031, refinable):** el canal recorta las
instancias por encima de unas 498 (tope de 1000 series) y lo avisa en `partial`. Si `partial` no
viene vacío, la página enseña el aviso de recorte (como el desglose del host) y el marcador
«Instancias» no presenta `instances.total` como el total real del grupo (por ejemplo, «498+» o el
número con la nota «como mínimo»). Quedarse con las de más CPU queda para Dani (BACKLOG).

## Criterios de aceptación

- CA1 (e2e): la página de un process group del simulador enseña sus marcadores, los cuatro gráficos
  y la tabla de instancias con sus valores; no enseña «Página en construcción».
- CA2 (e2e): pulsar una instancia abre su página de proceso y «Volver» regresa al grupo; pulsar su
  host abre la del host.
- CA3 (e2e): la franja de problemas sale sobre la CPU y abre el problema.
- CA4 (unitario, main): una entidad PROCESS_GROUP inventada con línea de comandos y rutas en
  `metadata` sale de `entities:get` sin esos valores.
- CA5 (e2e): la tarjeta «Información» sale la última y sin el valor de línea de comandos del
  simulador en ningún sitio de la página.
- CA6 (e2e): rango global, «Actualizar» y errores por panel como en el proceso.
- CA7 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con process groups reales, que marcadores, gráficos e instancias cuadran con Dynatrace.

## Fuera de alcance

- Métricas de tecnología.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `8801a71` (`test(grupo-procesos): criterios de la ficha 0032 (#0032)`). Fallan
por lo que falta, no por el test: los 7 e2e de la 0032 porque la página no tiene sus secciones
(`process-group-*`: `element(s) not found`) y los 3 unitarios de CA7 porque no existe
`entities.processGroup` en los locales. **CA4 ya pasa:** el filtro de main de la 0029
(`entity-secrets.ts`, en `toEntityData` para todas las entidades) ya quita `COMMAND_LINE_ARGS` y
`EXE_PATH` de un PROCESS_GROUP; queda como salvaguarda. Con el simulador ampliado siguen en verde
`CA6 (0031)`, `CA3 (0028)`, `CA3 (0029)` y `CA1 (0036)`.

| Criterio | Test                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0032): la página de un process group enseña sus marcadores, sus cuatro gráficos y la tabla de instancias…` y `CA1 (0032), nota del Orquestador: con las instancias recortadas (partial), la tabla avisa…` |
| CA2      | `e2e/views.spec.ts` › `CA2 (0032): pulsar una instancia abre su página de proceso y «Volver» regresa al grupo; pulsar su host abre la del host`                                                                                       |
| CA3      | `e2e/views.spec.ts` › `CA3 (0032): la franja de problemas sale sobre el gráfico de CPU con los problemas del grupo, y pulsar un tramo abre el problema`                                                                               |
| CA4      | `src/main/ipc/handlers/entity-detail.test.ts` › `CA4 (0032): entities:get de un process group sale sin la línea de comandos ni las rutas de metadata`                                                                                 |
| CA5      | `e2e/views.spec.ts` › `CA5 (0032): la tarjeta «Información» del process group sale la última, con sus filas y relaciones, y sin la línea de comandos…`                                                                                |
| CA6      | `e2e/views.spec.ts` › `CA6 (0032): cambiar el rango global vuelve a pedir los datos; …` y `CA6 (0032): si falla el canal de métricas, sus marcadores, cada gráfico y la tabla enseñan el aviso…`                                      |
| CA7      | `src/renderer/src/locales/process-group-page.test.ts` › `CA7 (0032): textos de la página del process group en es y en`                                                                                                                |

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **Simulador:** un process group nuevo para la página, `PROCESS_GROUP_PAGE_ID`, con siete
  instancias en tres hosts (para «como mucho 5, las de más CPU»), los mismos totales que el de la
  0031 y dos problemas (P-E2E83 abierto y P-E2E84 cerrado). El de la 0031 (dos instancias) no
  cambia. Flags nuevos: `processGroupMetricsFail` (400) y `processGroupTruncated`
  (`dimensionCountRatio` 1.5 en las expresiones por instancia → `partial`).
- **«CPU por instancia»:** el canal de la 0031 no trae series por instancia y la ficha no dice de
  dónde salen. El simulador las da de dos formas: en `entities:processGroupMetrics`, una expresión
  de `cpu.usage` partida por `dt.entity.process_group_instance` sin `resolution=Inf` (de más a
  menos CPU, con nombre si lleva `:names` y recortada si lleva `:limit(N)`), o en
  `entities:processMetrics` de cada instancia. El test solo mira el gráfico: cinco series con el
  nombre de las cinco de más CPU. Ojo: `CA6 (0031)` exige dos consultas al canal y que la de series
  no lleve `:parents:splitBy(…):avg:names`.
- **Marcadores:** los `totals` del canal; la CPU es la media del total del grupo (suma de las
  instancias, 64,5 %) y debajo la máxima (112,5 %); red en bit/s como el proceso.
- **Recorte (nota del Orquestador):** con `partial`, aviso `process-group-instances-partial` (texto
  con «incomplet» o «recort») y el marcador «Instancias» no puede ser «7» a secas: «7+», «como
  mínimo» o «al menos».
- **Relaciones de «Información»** (vistas en vivo en PROCESS_GROUP, informe de
  `entities-explore`): «Instancias» = `isInstanceOf` de to, «Hosts» = `runsOn` de from,
  «Servicios» = `runsOn` de to, «Otras» = el resto (en el simulador, `isNetworkClientOfProcessGroup`).
  Filas exigidas: `technologies`, `listenPorts` y `detectedName`.
- **Nombres** (testids, en el comentario del bloque de la 0032 de `e2e/views.spec.ts`): los del
  proceso con el prefijo `process-group`; gráficos `cpu`, `memory`, `network` y `cpu-instances`;
  tabla `process-group-instances` con columnas `name`, `host`, `cpu` y `memory`. Textos en
  `entities.processGroup` (`markers`, `charts`, `instances`, `info.rows` e `info.groups`).

## Resultado

(pendiente)
