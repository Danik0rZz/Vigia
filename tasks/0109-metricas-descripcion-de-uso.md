---
id: '0109'
titulo: Descripción breve de cómo se usa la página de Métricas
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0109-metricas-descripcion-de-uso
adrs: [] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Dani (2026-10-12): «Vamos a poner en la página de métricas una descripción breve de cómo usarlo».

## Especificación

Hoy la página de Métricas (`src/renderer/src/pages/MetricsPage.tsx`) solo tiene el título. Debajo
van el buscador, el selector con la resolución y los botones, el gráfico con su exportación y, a la
derecha, las consultas guardadas.

**Dónde va** (propuesta del Planificador; **Dani la aprobó el 2026-10-12**): un párrafo corto debajo del
título, siempre visible, con el `subtitle` que ya tiene `PageHeader` (lo usan las páginas de
entidad). En gris (`text-muted-foreground`), tamaño de texto normal de la app, alineado a la
izquierda. Se descartan un bloque plegable o un icono de ayuda con tooltip: añaden un componente y
un clic más para algo de dos líneas.

**Texto** (aprobado por Dani tal cual el 2026-10-12), en `metrics.howTo` de `es` y `en`:

- es: «Busca una métrica por su nombre o escribe un selector, por ejemplo
  `builtin:host.cpu.usage:avg`. Elige la resolución y pulsa Consultar: se usa el rango de tiempo de
  la barra superior. Puedes exportar el gráfico y guardar la consulta para este entorno; las
  guardadas se abren también con Ctrl+K.»
- en: la traducción, la escribe el developer con el mismo contenido.

El ejemplo del selector, en monoespaciada (`<code>` con `Trans` de i18next, sin HTML en la cadena).
Es una métrica integrada de Dynatrace que ya usa la app (`host-metrics.ts`); no sale nada del
tenant. Si el módulo no está disponible (`ModuleUnavailable`), la descripción no sale: no sirve de
nada sin poder consultar.

## Carril

Rápido (`ligera: sí`): Dani aprobó el subtítulo y el texto tal cual el 2026-10-12. Es S y no toca
IPC, la API, dependencias, el esquema, la seguridad ni servicios externos.

1. No añade componentes, funciones ni cálculos nuevos: cumple, usa el `subtitle` que ya tiene
   `PageHeader` y una clave de texto.
2. No elimina nada visible para el usuario: cumple.
3. No toca datos, API ni lógica: cumple, solo texto.
4. No hay ninguna decisión que preguntar a Dani: cumple, el texto y el sitio ya los decidió.

## Criterios de aceptación

Cada uno se comprueba con un test automático (unitario o e2e) que lleva su número en el nombre.

- CA1: con el módulo disponible, la página de Métricas enseña la descripción debajo del título, con
  el ejemplo del selector en `code`. e2e.
- CA2: sin acceso al módulo, la página enseña el aviso de siempre y no la descripción. e2e.
- CA3: `metrics.howTo` existe en `es` y en `en` con las mismas interpolaciones y etiquetas (la
  comprobación de claves de `locales.test.ts` o un unitario nuevo).
- CA4: con la ventana del CI (`applyCiWindow`), la descripción no se sale de su caja ni empuja el
  formulario fuera de la vista (se ve el botón Consultar sin desplazar). e2e.

## Pruebas a mano para Dani

- Leer el texto en la app y decir si se entiende.

## Fuera de alcance

- Descripciones en otras páginas (Problemas, Inicio, entidades).
- Una guía de la sintaxis de los selectores (transformaciones, filtros).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
