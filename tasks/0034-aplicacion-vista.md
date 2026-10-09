---
id: '0034'
titulo: 'APPLICATION: página con marcadores, gráficos, acciones de usuario e información'
estado: tests_escritos # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote: aplicacion
depende_de: ['0033', '0036', '0037']
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0034-aplicacion-vista
adrs: [4]
adr_nuevo:
api: ninguna nueva (usa `entities:applicationMetrics` de la 0033, `entities:get`/`entities:names` y los canales de problemas)
migracion: no
rondas_revision: 0
---

## Petición original

Lote «aplicacion» (0033 y 0034). La petición completa está en la ficha 0031.

## Especificación

En `WebApplicationEntityPage.tsx` se quita «Página en construcción». Mismos componentes que el
servicio y el orden de página de las fichas 0036 y 0037. Lo que no tenga métrica según la 0033 no
se pinta.

- **Marcadores:** Apdex (con su categoría: excelente ≥ 0,94, buena ≥ 0,85, aceptable ≥ 0,70, pobre
  ≥ 0,50, inaceptable; color y texto), Acciones (total), Duración (mediana o media), Errores
  (total; color de error si > 0) y Problemas.
- **Gráficos** (2×2, sin rejilla): Apdex (con la franja de problemas), Acciones (barras), Duración
  (línea) y Errores (barras).
- **Tabla «Acciones de usuario» (top 10 por volumen):** nombre, acciones, duración media (con
  barra); orden por columna.
- **Tarjeta «Información»** al final: las claves de `properties` que la 0033 vio en vivo (vistas
  antes en APPLICATION: `applicationType`, `applicationInjectionType`, `customizedName`,
  `detectedName`…), relaciones «Llama a» (servicios), «Monitores sintéticos» y «Otras», con «Ver
  nombres».
- Rango global, «Actualizar», errores por panel. Textos en es y en.

## Criterios de aceptación

- CA1 (e2e): la página de una aplicación del simulador enseña marcadores, gráficos y la tabla de
  acciones con sus valores; no enseña «Página en construcción».
- CA2 (unitario): categoría y color del Apdex en los cortes (0,94; 0,85; 0,70; 0,50), con texto.
- CA3 (e2e): con papeles `null`, sus marcadores y gráficos no salen y el resto sí.
- CA4 (e2e): la franja de problemas sale sobre el Apdex y abre el problema.
- CA5 (e2e): la tarjeta «Información» sale la última, con sus relaciones y enlaces.
- CA6 (unitario): textos nuevos en es y en (paridad de `check`).

## Pruebas a mano para Dani

- Con aplicaciones reales, que marcadores, gráficos y acciones cuadran con Dynatrace.

## Fuera de alcance

- Desglose por navegador, país o tipo de acción.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

Tests escritos en `d2005f7` (`test(aplicacion): criterios de la ficha 0034 (#0034)`). Fallan por
lo que falta, no por el test: los 6 e2e de la 0034 porque la página no tiene sus secciones
(`application-*`: `element(s) not found`), CA2 porque no existe `lib/application-format.ts` y CA6
porque no existe `entities.application` en los locales. Con el simulador ampliado siguen en verde
`CA6 (0033)` y `CA7 (0008)` (de esta se quita APPLICATION de la lista de páginas en construcción,
que ya no lo es).

| Criterio | Test                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CA1      | `e2e/views.spec.ts` › `CA1 (0034): la página de una aplicación enseña sus marcadores, sus cuatro gráficos y la tabla de acciones…` y `CA1 (0034), nota del Orquestador: sin acciones de usuario en el rango (lo habitual en vivo)…` |
| CA2      | `src/renderer/src/lib/application-format.test.ts` › `CA2 (0034): categoría, color y texto del Apdex en los cortes (0,94; 0,85; 0,70; 0,50)`                                                                                         |
| CA3      | `e2e/views.spec.ts` › `CA3 (0034): con papeles sin datos (Apdex y errores), sus marcadores y gráficos no salen y el resto sí`                                                                                                       |
| CA4      | `e2e/views.spec.ts` › `CA4 (0034): la franja de problemas sale sobre el gráfico del Apdex…`                                                                                                                                         |
| CA5      | `e2e/views.spec.ts` › `CA5 (0034): la tarjeta «Información» de la aplicación sale la última, con sus filas, sus relaciones…`                                                                                                        |
| CA6      | `src/renderer/src/locales/application-page.test.ts` › `CA6 (0034): textos de la página de la aplicación en es y en`                                                                                                                 |

**Decisiones del test-writer (delegadas por Dani, refinables):**

- **«Papeles `null`» (CA3):** en el canal de la 0033 los cinco papeles tienen métrica y un papel
  sin datos llega con la serie vacía y el total `null` (no hay papeles `null` en la salida). CA3 se
  prueba así: con el Apdex y los errores sin datos (flag `sim.applicationEmpty`), sus marcadores y
  gráficos no salen (ni un «—»), y los demás, la tabla y el marcador de problemas sí, sin avisos.
- **Lista de acciones vacía** (nota del Orquestador, por lo visto en la 0033): flag
  `sim.applicationActionsEmpty`; la tarjeta sale con su título y el aviso
  `application-actions-empty` (texto en `entities.application.actions.empty`), sin filas ni
  aviso de error.
- **Apdex (CA2):** `apdexCategory(valor)` (`excellent`, `good`, `fair`, `poor`, `unacceptable`,
  o `null` sin dato) y `apdexLevel(valor)` en `src/renderer/src/lib/application-format.ts`.
  Color con los tokens que ya hay: excelente y buena, `success` (verde); aceptable, `warning`;
  pobre e inaceptable, `error`; sin dato, `normal`. Textos: Excelente, Buena, Aceptable, Pobre e
  Inaceptable. El marcador enseña el valor con dos decimales (0,88) y el texto de su categoría.
- **Marcadores:** Apdex, Acciones, Duración, Errores (`data-level="error"` si > 0) y Problemas; las
  sesiones no tienen marcador ni gráfico (la ficha no los pide).
- **Tabla:** columnas `name`, `count` y `duration`, de más a menos acciones al entrar; ordenar por
  duración y al revés.
- **«Información»:** grupos `calls` («Llama a»: `fromRelationships.calls`), `synthetic`
  («Monitores sintéticos»: `toRelationships.monitors` y `fromRelationships.isApplicationOfSyntheticTest`)
  y `other` («Otras»: `isApplicationMethodOf` e `isGroupOf`). Filas `applicationType`,
  `applicationInjectionType`, `customizedName` y `detectedName`. «Ver nombres» se prueba en
  «Llama a» (un solo tipo; en «Monitores sintéticos» se mezclan dos y hay que agrupar por tipo).
- **Nombres** (testids, en el comentario del bloque de la 0034 de `e2e/views.spec.ts`): los del
  process group con el prefijo `application`. Textos en `entities.application` (`markers`,
  `charts`, `apdex`, `actions` e `info`).
- **Simulador:** la aplicación de la 0033 (`APPLICATION_METRICS_ID`) con dos problemas (P-E2E85
  abierto y P-E2E86 cerrado), su cuerpo de `/entities/{id}` y los flags
  `applicationMetricsFail` (400, para errores por panel; ningún CA lo exige), `applicationEmpty`
  y `applicationActionsEmpty`.
- Barras o línea y «sin rejilla» no se ven en el DOM; ningún CA los exige: quedan para la revisión.

## Resultado

(pendiente)
