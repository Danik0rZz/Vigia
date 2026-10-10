---
id: '0067'
titulo: 'e2e: una etiqueta de zona en cada test, con una guarda que falla si falta'
estado: en_revision # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 1
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

## Notas del developer

- Zonas: las 16 de la tabla, sin partir ninguna. Casos que cruzan, por la regla de la pantalla
  donde se comprueba: «Copiar detalles» de la pantalla de error (en `views.spec.ts`) va a
  `@errors`; los «Abrir en Métricas» que comprueban Métricas, a `@metricas`; `capture:region`,
  «sin auto-refresco», AUD-08, BAD_REQUEST y AUD-10 (datos descartados al guardar un secreto), a
  `@vistas-comun`; el separador de miles de los comentarios (0012), a `@problema-detalle`; las
  páginas en construcción (CA7 0008) y «las tarjetas del servicio y del host siguen igual»
  (CA4 0026), a `@entidad`; CA5 (0020), que mira la tarjeta del servicio, a `@servicio`.
- Portapapeles: la guarda lo detecta por un identificador `clipboard` en el cuerpo del test o en
  una función de nivel superior del spec que el test llame, directa o indirectamente (como
  `clipboardText`); los hooks no cuentan. Un test que solo pulsa un «Copiar» sin leer el
  portapapeles no se detecta: CA15 (0001) se ha etiquetado a mano (anotado en `e2e/CLAUDE.md`).
- Una etiqueta desconocida en un `describe` se avisa una vez, con el título del describe.
- Al añadir la opción `tag`, Prettier ya no aplica a esos tests el formato de «llamada de test» y
  reparte en varias líneas los que no caben: el diff es grande, pero quitando las etiquetas los
  tokens de los seis specs son idénticos a los de antes (comprobado con el compilador de
  TypeScript).

## Notas del revisor

### Ronda 1: APROBADO

- Criterios: CA1 a CA4 con su test en `scripts/e2e-tags.test.ts`; sin tocar tras `d68f89c` y
  fallarían sin `scripts/e2e-tags.cjs`.
- Specs sin cambios de fondo: comparados `main` y `HEAD` sin espacios ni las opciones `{tag: …}`,
  idénticos en los seis specs; el resto del diff es el reformateo de Prettier.
- Guarda pura sobre el compilador de TypeScript; solo cuenta tests y describes con título literal y
  función; una etiqueta no literal sale como sin zona (falla visible). Portapapeles por
  `clipboard` en el cuerpo o en auxiliares de nivel superior, con cierre transitivo.
- `e2e/areas.json`: las 16 zonas y `@portapapeles`; `affected-e2e.cjs` no lee las claves nuevas.
  Repasadas las asignaciones de los seis specs; encajan con «la pantalla donde está lo que se
  comprueba».

Opcional:

1. «Abrir en Métricas» sin regla clara (unos a `@metricas`, otros a `@problema-detalle` o
   `@servicio`): dejar escrita la regla antes de la 0070 y la 0071, por ejemplo «a `@metricas` si se
   comprueba lo que pinta Métricas; a la zona de origen si se comprueba la consulta del gráfico».
2. `usesClipboard` cruza nombres sin mirar el ámbito: una variable local con el nombre de una
   auxiliar con portapapeles daría un falso positivo (seguro: pide una etiqueta de más).

## Verificación

Tests (test-writer): commit d68f89c, `scripts/e2e-tags.test.ts`. Fallan al cargar porque aún no
existe `scripts/e2e-tags.cjs`.

Contrato que fijan los tests (la ficha no lo concretaba): `scripts/e2e-tags.cjs` exporta
`checkTags(specs: { file, code }[], config: { zones, resourceTags })`, con `zones` y `resourceTags`
como objeto etiqueta → descripción, y devuelve la lista de problemas
`{ kind, file?, test?, tag?, message }` en el orden en que aparecen los tests. `kind` es
`sin-zona`, `dos-zonas`, `desconocida`, `portapapeles` o `zona-muerta`, y `message` nombra el
fichero y el título (o la zona muerta). En el ejemplo de función auxiliar, la auxiliar se llama
`clipboardText`, como en `views.spec.ts`.

- CA1: «CA1 (0067): cada test de e2e/\*.spec.ts tiene una zona conocida y @portapapeles si lo usa».
- CA2: los cinco «CA2 (0067): …» de «checkTags (la propia comprobación)»: válido, sin zona, dos
  zonas, etiqueta desconocida, portapapeles en el cuerpo y por función auxiliar.
- CA3: «CA3 (0067): zona heredada de test.describe»: hereda (también anidado), choque con el
  describe y describe sin zona.
- CA4: «CA4 (0067): zonas de la lista»: zona muerta, y forma de `zones` y `resourceTags` en
  `e2e/areas.json`.

## Resultado

(pendiente)
