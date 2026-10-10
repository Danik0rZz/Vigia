---
id: '0067'
titulo: 'e2e: una etiqueta de zona en cada test, con una guarda que falla si falta'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: flujo-herramientas # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0067-e2e-etiquetas-por-zona
adrs: [6, 13] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

ADR-0013, parte 2, A (aprobada por Dani el 2026-10-10, pedida por el Orquestador): «etiquetas de
los e2e por zona de la app, con un test que falle si algún spec o test queda sin etiqueta».

## Especificación

Primera ficha del lote **flujo-herramientas**. Las etiquetas son la base de la 0070 (partir
`views.spec.ts` por zonas), la 0071 (`locales/` solo a su zona) y la 0075 (cuarentena).

**Etiquetas de Playwright** (opción `tag` de `test()` y de `test.describe()`, Playwright 1.63; se
filtran con `--grep @zona`). Cada test de `e2e/*.spec.ts` lleva **exactamente una** etiqueta de
zona. Puede llevar además etiquetas de recurso (hoy solo `@portapapeles`; la 0075 añade
`@inestable`). Una etiqueta puesta en un `test.describe` cuenta para los tests de dentro.

**La lista de zonas va en `e2e/areas.json`**, en una clave nueva `zones` (zona → descripción de una
línea), y otra `resourceTags` con `@portapapeles`. Zonas iniciales (decisión del Planificador; el
developer puede partir una zona en dos si encuentra tests que no encajan, y lo anota en la ficha):

| Zona                | Qué cubre                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@smoke`            | `smoke.spec.ts`                                                                                            |
| `@shell`            | `shell.spec.ts`: menú, barra superior, tema, idioma, paleta                                                |
| `@tenants`          | `tenants.spec.ts`: clientes, entornos y secretos                                                           |
| `@tls`              | `tls.spec.ts`: certificados y conexión                                                                     |
| `@errors`           | `errors.spec.ts`: pantallas de error                                                                       |
| `@vistas-comun`     | lo común a las vistas: sin entorno, cambiar de entorno, rango personalizado, errores de Dynatrace, ventana |
| `@inicio`           | Inicio (problemas abiertos, SLOs, salud de servicios)                                                      |
| `@problemas`        | la lista de Problemas: tabla, filtros, línea de tiempo, exportación de la lista                            |
| `@problema-detalle` | el detalle del problema: evidencias, descripción, comentarios, mini gráficos                               |
| `@metricas`         | Métricas: consulta, gráfico, consultas guardadas, captura                                                  |
| `@entidad`          | lo común a las páginas de entidad: «Analizar entidad», página genérica, orden de secciones, etiquetas      |
| `@servicio`         | página del servicio y sus canales por IPC                                                                  |
| `@host`             | página del host y del disco, y sus canales                                                                 |
| `@proceso`          | página del proceso y del process group, y sus canales                                                      |
| `@monitor`          | páginas de browser y HTTP monitor, y sus canales                                                           |
| `@aplicacion`       | página de la aplicación web, y sus canales                                                                 |

Regla para los que cruzan zonas: la zona es la de la pantalla donde está lo que se comprueba. Un
test de un canal por IPC va a la zona de su entidad. `@portapapeles` la llevan todos los tests que
leen o escriben el portapapeles del sistema (hoy solo en `views.spec.ts`).

**Guarda:** `scripts/e2e-tags.test.ts` (Vitest, entra en `npm run check`), con el mismo estilo que
`scripts/e2e-ci-window.test.ts`. Lee los specs de `e2e/` sin ejecutarlos (mejor con el compilador
de TypeScript que con expresiones regulares, porque los títulos llevan comillas y paréntesis) y
falla, con el fichero y el título del test, si un test:

- no tiene etiqueta de zona (ni propia ni de su `describe`);
- tiene dos zonas;
- usa una etiqueta que no está en `zones` ni en `resourceTags`;
- llama al portapapeles (`clipboard` en su cuerpo o en una función auxiliar que se sepa que lo
  usa; el developer decide cómo detectarlo y lo comenta) y no lleva `@portapapeles`.

La lógica de la guarda es una función pura (recibe el texto de un spec y la config) para poder
probarla con specs de ejemplo, como `decide` en `affected-e2e.cjs`.

**Sin cambiar ningún test:** solo se añade la etiqueta. Títulos, cuerpos y orden se quedan igual
(los títulos llevan el criterio de su ficha: `e2e/CLAUDE.md`). `affected-e2e.cjs` no cambia en esta
ficha.

**Documentación:** `e2e/CLAUDE.md` (regla: cada test nuevo lleva su zona; cómo lanzar una zona con
`--grep @zona`) y `docs/flujo.md` donde hable de etiquetas.

## Carril

Normal (`ligera: no`). Es M, ya no cumple el requisito de tamaño.

1. No añade componentes, funciones ni cálculos nuevos: **no se cumple**, añade la guarda y su
   función de análisis.
2. No elimina nada visible para el usuario: se cumple; solo cambia `e2e/` y `scripts/`.
3. No toca datos, API ni lógica: se cumple para la app, pero añade lógica de herramientas.
4. No hay ninguna decisión que preguntar a Dani: se cumple; la lista de zonas la fija el
   Planificador.

## Criterios de aceptación

- CA1: en el repositorio, cada test de `e2e/*.spec.ts` tiene exactamente una zona de `zones`, y los
  que usan el portapapeles llevan `@portapapeles` (la guarda pasa sobre los specs reales).
- CA2: con specs de ejemplo, la guarda falla y nombra el fichero y el test cuando un test no tiene
  zona, tiene dos, usa una etiqueta desconocida o usa el portapapeles sin `@portapapeles`.
- CA3: la guarda acepta la zona heredada de un `test.describe` y rechaza la de un `describe` que
  choque con otra zona del test.
- CA4: `e2e/areas.json` tiene `zones` y `resourceTags`, y cada zona que se usa en los specs está en
  la lista (y al revés: una zona de la lista sin ningún test hace fallar la guarda, para no dejar
  zonas muertas).

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Partir `views.spec.ts` (0069 y 0070).
- Usar las etiquetas en `test:e2e:affected` (0071) o para la cuarentena (0075).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
