---
id: '0049'
titulo: 'Etiquetas de entidad como cápsula de dos colores (clave | valor)'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: sí # sí solo si es S y no toca IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos
lote:
depende_de: []
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: feat/0049-etiquetas-capsula
adrs: []
adr_nuevo:
api: ninguna
migracion: no
rondas_revision: 1
---

## Petición original

Dani (2026-10-10), sobre las etiquetas de las páginas de entidad (ficha 0037): "Quiero que se vean
así o algo parecido; le daría un toque muy chulo verlas así, ya que actualmente no son nada
atractivas." Pasó la imagen de una **cápsula** (una píldora de medicina): forma redondeada entera,
mitad izquierda de un color vivo (azul), mitad derecha clara (gris muy claro), con un borde fino
que la rodea y la divide, y un brillo suave que le da volumen.

## Especificación

En `EntityTags.tsx` (y sus estilos), cada etiqueta pasa a ser una **cápsula**:

- **Forma:** `rounded-full`, alto compacto (como un chip), borde de 1 px en un tono oscuro del tema
  alrededor y una línea del mismo borde entre las dos mitades.
- **Mitad izquierda (clave):** fondo de color vivo y texto claro, en negrita ligera. El color sale
  de la **clave**, siempre el mismo para la misma clave (una función pura que asigna un color de
  una paleta de 8 tonos del tema, por ejemplo con un hash del texto de la clave), para que las
  etiquetas de la misma familia se reconozcan de un vistazo.
- **Mitad derecha (valor):** fondo claro y texto oscuro (en oscuro, un gris profundo y texto
  claro).
- **Volumen:** un degradado muy suave de arriba abajo y un brillo fino arriba (como la cápsula de la
  imagen), sin exagerar; con «reducir el movimiento» no cambia nada (no hay animación). Al pasar el
  ratón, un realce ligero.
- **Solo clave:** la cápsula es entera del color de la clave.
- **Contexto** (si no es `CONTEXTLESS`): un prefijo pequeño y apagado dentro de la mitad de la
  clave (`AWS ·`).
- Lo demás de la 0037 no cambia: orden, «+N», tooltip con el texto completo y posición.
- **Contraste:** los 8 tonos de la clave con su texto, y el valor con el suyo, pasan el test de
  contraste de `check` en claro y en oscuro.

## Criterios de aceptación

- CA1 (unitario): la función de color da siempre el mismo tono para la misma clave y un tono de la
  paleta para cualquier texto (también vacío o con caracteres raros).
- CA2 (unitario): contraste de los 8 tonos y de la mitad del valor, en claro y en oscuro.
- CA3 (e2e): una etiqueta `clave:valor` del simulador sale con dos mitades (clave y valor, cada una
  con su `data-testid`) y una de solo clave con una sola; dos etiquetas con la misma clave llevan el
  mismo color.
- CA4 (e2e): los e2e de etiquetas de la 0037 siguen pasando.

## Pruebas a mano para Dani

- Que las etiquetas se ven como la cápsula de su imagen (o mejor), en claro y en oscuro.

## Fuera de alcance

- Pulsar una etiqueta para filtrar o buscar.

## Decisiones del developer (delegadas por Dani, refinables)

- **Color de la clave:** `tagTone` (`entity-tags.ts`), hash FNV-1a de 32 bits de la clave **en
  minúsculas** módulo 8: `Equipo` y `equipo` comparten color (misma familia).
- **Paleta:** `--tag-0` a `--tag-7` en `main.css` (azul, violeta, verde azulado, verde, naranja,
  granate, cian y fucsia), con texto blanco (`--tag-key-foreground`); los mismos en los dos temas
  (con blanco encima no hacía falta otra serie para el oscuro). Valor: `--tag-value-bg` y
  `--tag-value-foreground` por tema; borde `--tag-border` (oscuro en los dos).
- **Contexto:** `AWS ·` dentro de la mitad de la clave, más pequeño, sin negrita y al 85 % de
  opacidad; el test de contraste lo comprueba mezclado sobre cada tono.
- **Volumen:** utilidad `capsule-gloss` (degradado de blanco 16 % arriba a negro 7 % abajo y un
  brillo interior de 1 px arriba). Realce al pasar el ratón: `brightness-110` y sombra, sin
  transición.
- **Dos puntos:** ya no se ven (la división es el borde), pero quedan como `sr-only` entre las
  mitades para los lectores de pantalla y el texto de la etiqueta.
- **`data-testid` de las mitades:** `entity-tag-key-part` (con el contexto y `entity-tag-key`
  dentro) y `entity-tag-value-part` (con `entity-tag-value` dentro); los de la 0037 no cambian.
  Fixture del e2e: `TAGS_CAPSULE_ID` en `views.spec.ts`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

### Ronda 1: APROBADO

Ficha ligera: los tests del developer cubren CA1 a CA4 tal como están escritos (tono estable y
dentro de la paleta con entradas raras; contraste de los 8 tonos con blanco y con el contexto al
85 %, en claro y en oscuro; cápsula de dos mitades con fondos distintos y el mismo tono para la
misma clave) y fallarían sin el código; el de tests va antes del de código. Peor caso recalculado:
`--tag-0` unos 5,7:1 (4,6:1 con el contexto); también al pasar el ratón. Los «:» quedan `sr-only` y
los e2e de la 0037 siguen pasando sin tocarlos. Sin IPC, API, dependencias, esquema ni ficheros
nuevos; tokens en `main.css` con su guarda; nada del tenant.

Sugerencias, no bloquean:

- El brillo de `capsule-gloss` baja el azul con blanco a unos 4,2 en la franja de arriba: bajar el
  brillo u oscurecer un poco `--tag-0` para tener margen.
- Añadir `--tag-border` a la lista del test de exposición a Tailwind.

## Verificación

(pendiente)

### Verifier, 2026-10-10, commit `f5e9e79`, rango `main..feat/0049-etiquetas-capsula`: VERDE

- check: 3148 tests en 174 ficheros, cobertura ok.
- e2e completo (toca `main.css`): 327/327, sin intermitentes.

## Resultado

- Commits: `9ddf04b` (tests), `d180c2d` (código), y los de ficha `8b8dc7d`, `f5e9e79`, `721cc1a`.
- Ficheros principales: `src/renderer/src/pages/entities/EntityTags.tsx`, `entity-tags.ts` (`tagTone`), `src/renderer/src/assets/main.css` (`--tag-*`, `capsule-gloss`), `src/main/env-colors.test.ts`, `e2e/views.spec.ts`.
- Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Sin migraciones.
- Pendiente de Dani: verla en claro y en oscuro.
