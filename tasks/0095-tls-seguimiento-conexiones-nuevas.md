---
id: '0095'
titulo: 'TLS, seguimiento de la 0079: dos conexiones nuevas a un host cuando la sesión ya no recuerda la decisión del verificador'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: M # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0095-tls-seguimiento-conexiones-nuevas
adrs: [3] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

BACKLOG, «Propuestas» (surgió en la 0079): «Ficha de seguimiento de seguridad del resto de la
verificación de certificados (dos conexiones nuevas a un host cuando la sesión ya no recuerda la
decisión); pendiente del Planificador». Dani la metió en el lote `seguridad-revision` el 2026-10-11,
al aprobarlo.

## Especificación

**Lo que queda de la 0079** (su «Resultado», «Lo que queda»). La 0079 hace que la primera petición a
cada host de cada sesión vaya sola (`gatedFetch`, `src/main/dynatrace/network.ts`), porque dos
conexiones nuevas a la vez al mismo host pueden saltarse el verificador de la app. La sesión recuerda
la decisión del verificador para cada host y, pasado un tiempo, la olvida; si entonces abre a la vez
dos conexiones nuevas a ese host, la ventana vuelve a abrirse. Desde la app no se ve ni cuándo la
olvida ni cuándo se abre una conexión nueva. La ventana dura lo que tarda el verificador en
responder (milisegundos).

**Repositorio público** (decisión de Dani en la 0079): en la ficha, los tests, los comentarios y los
mensajes de commit queda solo lo nuestro, sin la cadena interna de Electron ni el paso a paso. Lo que
haga falta de eso va fuera del repositorio. El Orquestador comprueba antes del push que lo que se
sube no lo lleva, como en la 0079, y el reviewer lo revisa en el diff con la lista que se guarda
fuera del repositorio (no puede ser un test: la lista no puede estar en él).

1. **Primero, opciones; después, código.** El developer estudia las salidas y las presenta con un
   `[ALCANCE]` (lo decide Dani) antes de implementar ninguna, con su coste para el usuario. Las que
   anotó la 0079, y cualquier otra que encuentre:
   - renovar la sesión del entorno antes de que olvide la decisión (cambia cuándo se crea una
     partición, ADR-0003; cada sesión nueva se queda en memoria hasta cerrar la app; puede no cubrir
     todos los casos);
   - poner en fila todas las peticiones a un host (frena todas las vistas);
   - lo que Electron ofrezca o responda al aviso privado que envió Dani (si ha respondido, Dani lo
     dice al empezar la ficha);
   - dejarlo como riesgo aceptado y documentado, si ninguna compensa.
2. **Límites, los de la 0079:** no se acepta un certificado que `verifyCertificate`
   (`src/main/dynatrace/tls.ts`) no acepta ni se cambia su tabla; «ignorar» no vale para el SSO ni
   para hosts ajenos al entorno; no se reintenta un rechazo real hasta que entre; no se pone en logs
   nada más de lo que ya se pone.
3. Si Dani elige «riesgo aceptado», la ficha se cierra documentándolo en `docs/ARCHITECTURE.md` (o en
   el ADR-0003) sin código, y los criterios CA1 y CA2 no aplican (se dice en «Resultado»).

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (verificación de certificados): va sola en su PR
y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: no se sabe hasta elegir la salida (en la duda,
   no se cumple).
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; toca la red del proceso principal.
4. No hay ninguna decisión que preguntar a Dani: no se cumple (la salida del punto 1).

## Criterios de aceptación

- CA1: con la sesión simulada de la 0079 (`network.verifier-cache.test.ts` o uno parecido), cuando la
  sesión ha olvidado la decisión y se abren dos conexiones nuevas a la vez al mismo host, las dos pasan
  por el verificador de la app; sin el arreglo, el test falla. Test con «CA1 (0095)».
- CA2: los tests de la 0079 (CA1 a CA4) y los de certificados (`tls.test.ts`, `network.test.ts`,
  `client.https.test.ts`, `e2e/tls.spec.ts`) siguen en verde sin cambiar lo que esperan.

## Pruebas a mano para Dani

- Ninguna: con el tenant de pruebas el certificado es de una CA pública y no se usa «ignorar».

## Fuera de alcance

- Cambiar la tabla de decisiones de `tls.ts` o los niveles de certificado.
- La cola de gráficos de la 0086, aunque también pase por `gatedFetch`.

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
