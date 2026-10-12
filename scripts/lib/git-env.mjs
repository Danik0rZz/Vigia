// Variables de git que fijan el repositorio (GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE…) fuera de
// los tests (ficha 0101). Un hook de git las exporta, y un test que lanza `git init` en una
// carpeta temporal con el GIT_DIR de un worktree pone `core.bare=true` en el config común del
// repositorio real.

/** ¿Es una variable de git? Empieza por `GIT_`, sin distinguir mayúsculas (como en Windows). */
export function isGitVar(key) {
  return key.toUpperCase().startsWith('GIT_')
}

/** Copia de `env` sin las variables `GIT_*`. No modifica `env`. */
export function withoutGitVars(env) {
  const clean = {}
  for (const [key, value] of Object.entries(env)) {
    if (!isGitVar(key)) clean[key] = value
  }
  return clean
}

/** Borra de `env` (por defecto, `process.env`) las variables `GIT_*`. */
export function deleteGitVars(env = process.env) {
  for (const key of Object.keys(env)) {
    if (isGitVar(key)) delete env[key]
  }
}
