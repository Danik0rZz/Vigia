---
id: '0092'
titulo: 'El aviso de Telegram no se envía si no se ha podido filtrar el tenant'
estado: hecha # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad, externos] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0092-telegram-no-envia-sin-filtro
adrs: [9] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 1
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad abiertos de la revisión de código
del 2026-10-11 pasan a fichas con prioridad. Esta es la T-07.

## Especificación

**Hoy.** `scripts/notify-telegram.mjs`: sin `.env.live.local` (ni en la carpeta ni en el checkout
principal) o con uno sin valores, avisa de que «no se ha podido filtrar el texto» y **envía
igualmente**. Es el mismo caso que la 0055 cerró en `scan:tenant`, pero hacia un servicio externo. El
test «CA8 (0004)» fija ese comportamiento.

**Qué se hace.**

1. Sin valores con los que filtrar, no se envía: `[aviso telegram] sin .env.live.local con valores:
no se envía`, salvo con `VIGIA_TELEGRAM_UNFILTERED=1` (para un clon sin tenant de pruebas).
2. Sigue saliendo con 0 en todos los casos: el aviso nunca para el flujo (ADR-0009).
3. El test «CA8 (0004)» cambia a lo nuevo (no envía) y se dice en la ficha; `docs/flujo.md` («Avisos
   por Telegram») y el README explican el caso y la variable.

## Carril

Normal (`ligera: no`), con las exclusiones `seguridad` (filtro del tenant) y `externos` (Telegram): va
sola en su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: se cumple.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia cuándo se envía.
4. No hay ninguna decisión que preguntar a Dani: se cumple.

## Criterios de aceptación

- CA1: sin `.env` en la carpeta ni en el checkout principal, no se llama a la red, sale con 0 y avisa
  sin el token ni el chat. Test con «CA1 (0092)» (sustituye lo que esperaba «CA8 (0004)»).
- CA2: con un `.env` sin valores, lo mismo que CA1. Test con «CA2 (0092)».
- CA3: con `VIGIA_TELEGRAM_UNFILTERED=1` y sin `.env`, se envía y avisa de que va sin filtrar. Test
  con «CA3 (0092)».
- CA4: con un `.env` con valores, lo de hoy no cambia (filtra y, si encuentra algo, no envía): los
  tests de la 0004 siguen en verde.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- Recibir órdenes por Telegram (ADR-0010).

## Ideas surgidas (fuera de alcance)

- (developer) El pre-commit lanza `vitest related` con `scripts/notify-telegram.mjs` y dice «No test
  files found»: los tests de `scripts/` no se relacionan con su `.mjs`, así que el pre-commit no los
  corre al tocar un script (sí los corre `check`).

## Notas del revisor

### Ronda 1: APROBADO

- **Criterios:** CA1 a CA4 con sus tests en `scripts/notify-telegram.test.ts` (CA1 también con credenciales del registro y con `VIGIA_TELEGRAM_UNFILTERED` a `0`, vacío o `no`; CA2 con `.env` vacío o solo claves vacías, en la carpeta o en el checkout principal; CA3 envía y avisa; CA4 con valores no se salta el filtro, y los de la 0004 se mantienen). CA1 y CA2 fallaban con el código anterior; «CA8 (0004)» se sustituye, dicho en la ficha. Los tests no se tocan desde c31fe03.
- **Caminos de envío** (`scripts/notify-telegram.mjs:204-227`): solo con valores en el `.env` y sin restos del tenant, o sin valores y `credential(UNFILTERED_VAR) === '1'` exacto. Con valores, la variable ni se consulta. Token y chat en `secrets` antes de cualquier aviso; todo `warn`/`info` pasa por `redact`; `expectNoSecrets` en CA1, CA2 y CA3.
- **Documentación:** `docs/flujo.md` («Sin filtro, no se envía») y el README explican el caso y la variable. Sin datos del tenant (fixtures `zz99fake`).
- Sin IPC, API, dependencias ni esquema.

Opcional: «Verificación» cita el commit de tests `65a1c93`, que tras el rebase es `c31fe03`; un caso de CA3 con la variable solo en el registro; en `docs/flujo.md`, precisar que un worktree solo se queda sin aviso si tampoco hay `.env` con valores en el checkout principal.

## Verificación

Tests escritos en el commit `c31fe03` (`scripts/notify-telegram.test.ts`):

- El test «CA8 (0004)» (sin .env, enviaba avisando) se sustituye por los de CA1 (0092); el escenario
  «envío sin .env» de CA9 (0004) pasa a «sin .env (no envía, 0092)».
- CA1 → `describe('CA1 (0092): sin .env.live.local no se envía')`: sin .env no se llama a la red,
  devuelve 0 y avisa con `[aviso telegram] sin .env.live.local con valores: no se envía`, sin el
  token ni el chat (también con credenciales del registro y con `VIGIA_TELEGRAM_UNFILTERED` distinto
  de `1`).
- CA2 → `describe('CA2 (0092): con un .env sin valores no se envía')`: .env vacío o solo con claves
  vacías y comentarios, en la carpeta o en el checkout principal.
- CA3 → `describe('CA3 (0092): VIGIA_TELEGRAM_UNFILTERED=1 envía sin filtrar')`: sin .env (y con un
  .env sin valores) envía y avisa de que va sin filtrar. Ya pasa con el código de hoy.
- CA4 → los tests de la 0004 (CA7, CA12) y `describe('CA4 (0092): …')`: con valores en el .env,
  `VIGIA_TELEGRAM_UNFILTERED=1` no se salta el filtro. Ya pasa hoy.
- Al escribirlos: 9 fallan (CA1 y CA2, porque hoy se envía) y 80 pasan.

Verificación 2026-10-12, commit 1b2b9b0, rango `origin/main..fix/0092-telegram-no-envia-sin-filtro`: **VERDE**

- `npm run check`: 4175 tests (226 ficheros), cobertura ok (sentencias 92,83 %, ramas 90,03 %, funciones 89,94 %, líneas 93,58 %).
- `test:e2e:affected`: «solo docs o tests unitarios»; ningún spec.
- Sin ejecutar `scripts/notify-telegram.mjs` ni leer `.env.live.local`; `core.bare` del checkout principal en `false`.

## Resultado

Commits: `c31fe03` (tests), `aebac90` (código y documentos), más los de la ficha. Rondas de revisión: 1 (APROBADO). ADR nuevo: ninguno. Ficheros principales: `scripts/notify-telegram.mjs`, `scripts/notify-telegram.test.ts`, `docs/flujo.md`, `README.md`.

(developer) `scripts/notify-telegram.mjs`: sin `.env.live.local` con valores, avisa con
`[aviso telegram] sin .env.live.local con valores: no se envía (con VIGIA_TELEGRAM_UNFILTERED=1 se
envía sin filtrar).` y sale con 0; con `VIGIA_TELEGRAM_UNFILTERED=1` envía y avisa de que va sin
filtrar. Con un `.env` con valores, la variable no cambia nada (el filtro se aplica). Explicado en
`docs/flujo.md` («Avisos por Telegram») y en el README.

- Decisión: `VIGIA_TELEGRAM_UNFILTERED` se lee como el token y el chat (entorno o, en Windows, el
  registro), para que un `setx` llegue a una sesión ya abierta, como dice el README de las otras dos.
- Cambio en los avisos del Orquestador: los sigue recibiendo mientras haya un `.env.live.local` con
  valores en su worktree o en el checkout principal (`findLiveEnv` mira los dos). Si en ese equipo
  no lo hay, desde esta ficha los avisos dejan de llegar (antes llegaban sin filtrar).
