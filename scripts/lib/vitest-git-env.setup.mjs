// Fichero de preparación de Vitest (`setupFiles`, ficha 0101): antes de cargar cada fichero de
// test se borran de `process.env` las variables `GIT_*`. Así ningún test hereda las de un hook de
// git (el pre-commit exporta GIT_DIR y GIT_INDEX_FILE), lo lance quien lo lance.
import { deleteGitVars } from './git-env.mjs'

deleteGitVars()
