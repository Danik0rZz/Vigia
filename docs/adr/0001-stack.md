# ADR-0001: Electron + React + TypeScript, zip de Windows

Estado: aceptado (Fase 1, registrado el 2026-10-06)

## Contexto

Vigía es una app de escritorio para Windows que se usa en PCs corporativos (SmartScreen, AppLocker,
proxy con su CA), sin permisos de administrador y sin Node instalado.

## Decisión

Electron + React + TypeScript, compilado con electron-vite. Se distribuye como zip de Windows
(`npm run dist:win`) que se descomprime y se ejecuta, sin instalador. Datos locales en SQLite
(better-sqlite3 + Drizzle) y secretos cifrados en local.

## Alternativas descartadas

- Instalador (Squirrel, NSIS): pide permisos o choca con las políticas corporativas.
- Aplicación web: no puede guardar secretos en local ni usar el almacén de certificados de Windows.

## Consecuencias

Las versiones de electron-vite, Vite, TypeScript y ESLint están acopladas (ver
`docs/ARCHITECTURE.md`). El zip nunca se arranca en el perfil de Dani durante las pruebas.
