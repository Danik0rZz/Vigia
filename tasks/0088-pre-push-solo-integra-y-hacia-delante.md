---
id: '0088'
titulo: 'pre-push: solo se publica en ramas integra/ y solo hacia delante'
estado: aprobada # borrador | aprobada | tests_escritos | en_desarrollo | en_revision | verificada | hecha | en_espera | bloqueada
tamano: S # S | M | L (docs/propuestas-siguientes.md)
ligera: no # carril rápido (ADR-0013): sí solo si es S, sin IPC, API de Dynatrace, dependencias, esquema, seguridad ni servicios externos, y cumple los cuatro puntos de «Carril»
exclusiones: [seguridad] # las que toca, de: ipc | api | dependencias | esquema | seguridad | externos (con alguna, va sola en su PR y la fusiona Dani; ficha 0073)
medir: no # sí solo si Dani pide medir el flujo de esta ficha (docs/flujo.md, "Medición del flujo")
lote: seguridad-revision # nombre corto del lote, si la ficha es parte de uno
depende_de: [] # fichas que tienen que estar hechas antes, por número
aprobada_por: Dani # Dani | peticiones (en nombre de Dani, con el motivo en la especificación)
rama: fix/0088-pre-push-solo-integra
adrs: [7, 14] # ADR que aplican, por número
adr_nuevo: # título del ADR que tiene que escribir el doc-writer, o vacío
api: ninguna # v1 | v2 | plataforma | ninguna, y los ficheros de ..\API\ consultados
migracion: no # sí si cambia src/main/db/schema.ts
rondas_revision: 0
---

## Petición original

Dani (2026-10-11, por el Orquestador): los hallazgos de seguridad que siguen abiertos de la revisión
de código del 2026-10-11 pasan a fichas con prioridad. Esta es la T-01: el pre-push no limita a
dónde se hace push.

## Especificación

**Hoy.** `.githooks/pre-push` rechaza los borrados de refs remotos (ficha 0082) y lanza
`scan-tenant --pre-push`, que lee de cada línea de stdin solo los dos SHA y descarta el ref remoto.
Así pasan el hook: un push a cualquier rama que no sea `integra/…` (`git push origin HEAD:otra`), y
un push que no es avance rápido escrito con refspec `+` (`git push origin +x:integra/y`), que además
no casa con ningún `deny` de `.claude/settings.json` (solo cubren `--force`, `-f` y
`--force-with-lease`). La protección de `main` en GitHub (activa desde el 2026-10-11) cierra `main`,
pero no las ramas `integra/`.

**Qué se hace.**

1. Una función pura (por ejemplo `checkPushRefs(lines, { allowed, isAncestor })`, en
   `scripts/scan-tenant.mjs` o en un script nuevo que el hook llame antes del escaneo) que, por cada
   línea de stdin (`<ref local> <sha local> <ref remoto> <sha remoto>`), devuelva un problema si:
   - el ref remoto no empieza por `refs/heads/integra/` y no está en la lista permitida;
   - es un borrado (SHA local a ceros; ya lo rechaza la 0082: se mantiene, en el hook o en la
     función);
   - no es lineal: el SHA remoto no es ceros y no es antecesor del local
     (`git merge-base --is-ancestor <remoto> <local>` distinto de 0). Si el SHA remoto no está en
     el clon, también se rechaza, con un mensaje que pida hacer `git fetch` (falla cerrado).
2. El hook sale con 1 y un mensaje claro, sin ningún valor del tenant: «el destino no es una rama
   integra/», «no es un avance rápido» o «se borra un ref remoto». No se publica nada.
3. **Excepción para Dani:** la variable `VIGIA_PUSH_ALLOW_REFS` con refs exactos separados por comas
   (por ejemplo, `refs/tags/v0.12.0`), como `VIGIA_SCAN_TENANT_OPTIONAL`. Solo abre el destino; nunca
   un push no lineal ni un borrado. Se documenta en el README y en `docs/flujo.md` («Puertas sin
   IA»). **Decisión de Dani (2026-10-11):** las etiquetas no tienen excepción propia; un tag
   (`refs/tags/v…`) se publica nombrándolo en la variable, como cualquier otro destino.
4. **Segunda capa, en `.claude/settings.json`** (`deny`, en `Bash(…)` y en `PowerShell(…)`, como las
   que ya hay): `git push * +*`, `git push * --mirror*`, `git push * --prune*` y `git -c *push*`. Lo
   que tiene que seguir permitido: `git push origin integra/<nombre>` y
   `git push -u origin integra/<nombre>`.

## Carril

Normal (`ligera: no`), con la exclusión `seguridad` (puerta de publicación y permisos de los
agentes): va sola en su PR y la fusiona Dani.

1. No añade componentes, funciones ni cálculos nuevos: no se cumple; añade la función de comprobación.
2. No elimina nada visible para el usuario: se cumple.
3. No toca datos, API ni lógica: no se cumple; cambia la lógica del hook.
4. No hay ninguna decisión que preguntar a Dani: no se cumplía (los tags); ya la tomó Dani.

## Criterios de aceptación

- CA1: la función devuelve un problema para un ref remoto `refs/heads/main`, para
  `refs/heads/feat/x`, para un borrado y para un push no lineal, y ninguno para un avance rápido a
  `refs/heads/integra/AAAAMMDD-N` ni para una rama `integra/` nueva (SHA remoto a ceros). Test
  unitario con «CA1 (0088)».
- CA2: con un repositorio temporal y el hook instalado, un push a una rama que no es `integra/` y un
  push no lineal a una `integra/` salen con código distinto de 0 y el remoto no cambia; un avance
  rápido a `integra/` publica. Test con «CA2 (0088)».
- CA3: con `VIGIA_PUSH_ALLOW_REFS` y el ref exacto, ese destino pasa; con un valor parecido (prefijo,
  comodín) no pasa; y la variable no deja pasar un push no lineal. Test con «CA3 (0088)».
- CA4: `permissions.deny` tiene, en Bash y en PowerShell, las cuatro reglas del punto 4, y no niega
  `git push origin integra/x` ni `git push -u origin integra/x`. Test con «CA4 (0088)».
- CA5: los tests de la 0055 y la 0082 (escaneo del pre-push y borrados) siguen en verde sin cambiar
  lo que esperan.

## Pruebas a mano para Dani

- Ninguna.

## Fuera de alcance

- La configuración de GitHub (protección de ramas): la decide Dani.
- Otras vías que no pasan por el pre-push (`gh api -X DELETE …`): idea de la 0082, sigue anotada.
- `scan:tenant` con binarios y nombres de fichero (ficha 0091).

## Ideas surgidas (fuera de alcance)

(ninguna)

## Notas del revisor

(sin revisar)

## Verificación

(pendiente)

## Resultado

(pendiente)
