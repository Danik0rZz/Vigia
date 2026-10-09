---
id: '0049'
titulo: 'Etiquetas de entidad como cápsula de dos colores (clave | valor)'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
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
rondas_revision: 0
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

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
