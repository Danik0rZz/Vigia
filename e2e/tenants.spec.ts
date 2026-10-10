import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page
} from '@playwright/test'
import { removeDir } from './cleanup'
import { captureOnFailure } from './failure-capture'
import { FIXED_WINDOW, fitsContentSize, useCiWindow } from './window-size'
import es from '../src/renderer/src/locales/es/common.json'

/**
 * Fase 3, datos locales y secretos, sobre la app compilada (`out/`): CRUD de
 * clientes y entornos desde Ajustes, credenciales cifradas que nunca vuelven
 * a la interfaz, selector de entorno en la barra superior, ruta
 * "Cliente › Entorno › Sección", Ctrl+K y persistencia al relanzar la app.
 *
 * Las pruebas comparten la app y van en orden. Usan su propia carpeta de
 * datos, que se conserva al relanzar.
 */
test.describe.configure({ mode: 'serial' })

const SECRET = 'dt0c01.SECRETOPRUEBAE2E'
const CLASSIC_URL = 'https://abc12345.live.dynatrace.com'
const FORBIDDEN =
  /favorit|perfil|profile|próximamente|proximamente|coming soon|backup|notificaci|notification/i

let app: ElectronApplication
let page: Page
let userDataDir: string
captureOnFailure(() => ({ page, userDataDir }))
const consoleErrors: string[] = []
const remoteRequests: string[] = []

async function launch(): Promise<void> {
  app = await electron.launch({
    // VIGIA_E2E_NO_SANDBOX solo hace falta en contenedores Linux que ejecutan como root.
    args: ['.', ...(process.env['VIGIA_E2E_NO_SANDBOX'] ? ['--no-sandbox'] : [])],
    env: { ...process.env, VIGIA_USER_DATA_DIR: userDataDir, VIGIA_E2E: '1' }
  })
  await useCiWindow(app)
  page = await app.firstWindow()
  // Nunca la carpeta real de datos: la temporal de esta prueba.
  expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(
    userDataDir
  )
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => {
    if (/^(https?|wss?):/i.test(request.url())) remoteRequests.push(request.url())
  })
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'vigia-e2e-tenants-'))
  await launch()
})

test.afterAll(async () => {
  try {
    await app?.close()
  } finally {
    removeDir(userDataDir)
  }
})

/** Llama a un canal IPC desde la interfaz, como lo haría la app. */
function invoke(channel: string, input?: unknown): Promise<unknown> {
  return page.evaluate(
    ([name, payload]) => {
      const api = (
        window as unknown as { vigia: { invoke: (...args: unknown[]) => Promise<unknown> } }
      ).vigia
      return payload === undefined ? api.invoke(name) : api.invoke(name, payload)
    },
    [channel, input] as const
  )
}

async function goToSettings(): Promise<void> {
  await page.getByTestId('nav-settings').click()
  await expect(page).toHaveURL(/#\/settings$/)
}

function clientRow(name: string): Locator {
  return page.getByTestId('client-row').filter({ hasText: name })
}

function environmentRow(client: string, name: string): Locator {
  return clientRow(client).getByTestId('environment-row').filter({ hasText: name })
}

function breadcrumb(): Locator {
  return page.getByRole('navigation', { name: es.topbar.breadcrumb })
}

/** El secreto no está en la página ni en lo que devuelve tenants:list. */
async function expectSecretNowhere(): Promise<void> {
  expect(await page.content()).not.toContain(SECRET)
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, textarea')).map(
      (el) => (el as HTMLInputElement).value
    )
  )
  expect(inputs.filter((value) => value.includes('SECRETO'))).toEqual([])
  expect(JSON.stringify(await invoke('tenants:list'))).not.toContain(SECRET)
}

async function expectNothingForbidden(): Promise<void> {
  await expect(page.locator('body')).not.toHaveText(FORBIDDEN)
}

/** Abre el formulario de entorno nuevo del cliente y rellena lo mínimo. */
async function fillNewEnvironment(
  client: string,
  name: string,
  type: string,
  classicUrl: string
): Promise<Locator> {
  await clientRow(client).getByTestId('environment-add').click()
  const form = page.getByTestId('environment-form')
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('role', 'dialog')
  await form.getByTestId('environment-name').fill(name)
  await form.getByTestId('environment-type').selectOption(type)
  await form.getByTestId('environment-deployment').selectOption('saas')
  await form.getByTestId('environment-classic-url').fill(classicUrl)
  return form
}

/** Ficha 0021: todos los e2e corren con el contenido de la ventana del CI (useCiWindow). */
test(
  'CA2 (0021): al empezar, el contenido de la ventana mide 1024×720 (con el margen de 2 px)',
  { tag: '@tenants' },
  async () => {
    const size = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    }))
    expect(fitsContentSize(size, FIXED_WINDOW), `contenido de ${size.width}×${size.height}`).toBe(
      true
    )
  }
)

test(
  'sin datos: selector "Sin entorno", ruta solo con la sección y tarjeta neutra',
  { tag: '@tenants' },
  async () => {
    await expect(page.getByTestId('env-selector')).toHaveText(/Sin entorno/)
    await expect(breadcrumb()).toHaveText(/^\s*Inicio\s*$/)
    await expect(page.getByTestId('env-status')).toContainText('Sin entorno configurado')
    await expect(
      page.locator('[data-testid="env-type-badge"][data-type="production"]')
    ).toHaveCount(0)
  }
)

test('crea un cliente desde Ajustes', { tag: '@tenants' }, async () => {
  await goToSettings()
  await page.getByTestId('client-add').click()
  const form = page.getByTestId('client-form')
  await expect(form).toBeVisible()
  await expect(form).toHaveAttribute('role', 'dialog')
  await form.getByTestId('client-name').fill('Cliente A')
  await form.getByTestId('client-color').fill('#3366ff')
  await form.getByTestId('form-save').click()

  await expect(form).toBeHidden()
  await expect(clientRow('Cliente A')).toHaveCount(1)
  await expect(page.getByTestId('config-export')).toBeVisible()
  await expect(page.getByTestId('config-import')).toBeVisible()
  await expectNothingForbidden()
})

test(
  'un nombre de cliente repetido da error en el campo y no guarda',
  { tag: '@tenants' },
  async () => {
    await page.getByTestId('client-add').click()
    const form = page.getByTestId('client-form')
    await form.getByTestId('client-name').fill('cliente a')
    await form.getByTestId('form-save').click()

    await expect(form).toBeVisible()
    await expect(form.getByTestId('client-name')).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByRole('alert')).toBeVisible()
    await form.getByTestId('form-cancel').click()
    await expect(form).toBeHidden()
    await expect(page.getByTestId('client-row')).toHaveCount(1)
  }
)

test(
  'crea el entorno Producción: URL http rechazada y campos de plataforma ocultos en Managed',
  { tag: '@tenants' },
  async () => {
    const form = await fillNewEnvironment(
      'Cliente A',
      'Producción',
      'production',
      'http://abc12345.live.dynatrace.com'
    )

    // En Managed no hay plataforma: sus campos no se muestran.
    const platformFields = [
      'environment-platform-url',
      'environment-oauth-client-id',
      'environment-oauth-scopes',
      'environment-account-uuid'
    ]
    for (const id of platformFields) await expect(form.getByTestId(id)).toBeVisible()
    await form.getByTestId('environment-deployment').selectOption('managed')
    for (const id of platformFields) await expect(form.getByTestId(id)).toBeHidden()
    await form.getByTestId('environment-deployment').selectOption('saas')
    for (const id of platformFields) await expect(form.getByTestId(id)).toBeVisible()

    // http:// da error de campo y no guarda.
    await form.getByTestId('form-save').click()
    await expect(form).toBeVisible()
    await expect(form.getByTestId('environment-classic-url')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    await expect(form.getByRole('alert').first()).toBeVisible()
    await expect(page.getByTestId('environment-row')).toHaveCount(0)

    await form.getByTestId('environment-classic-url').fill(CLASSIC_URL)
    await form.getByTestId('form-save').click()
    await expect(form).toBeHidden()
    await expect(environmentRow('Cliente A', 'Producción')).toHaveCount(1)
  }
)

test(
  'un nombre de entorno repetido en el mismo cliente da error en el campo',
  { tag: '@tenants' },
  async () => {
    const form = await fillNewEnvironment('Cliente A', 'producción', 'production', CLASSIC_URL)
    await form.getByTestId('form-save').click()
    await expect(form).toBeVisible()
    await expect(form.getByTestId('environment-name')).toHaveAttribute('aria-invalid', 'true')
    await expect(form.getByRole('alert').first()).toBeVisible()
    await form.getByTestId('form-cancel').click()
    await expect(form).toBeHidden()
  }
)

test('crea un segundo entorno, Desarrollo', { tag: '@tenants' }, async () => {
  const form = await fillNewEnvironment(
    'Cliente A',
    'Desarrollo',
    'development',
    'https://def67890.live.dynatrace.com'
  )
  await form.getByTestId('form-save').click()
  await expect(form).toBeHidden()
  await expect(clientRow('Cliente A').getByTestId('environment-row')).toHaveCount(2)
})

test(
  'guarda un token clásico: estado Configurado y el valor no vuelve nunca',
  { tag: '@tenants' },
  async () => {
    await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
    const form = page.getByTestId('environment-form')
    await expect(form).toBeVisible()

    for (const kind of ['classicToken', 'oauthClientSecret', 'platformToken']) {
      await expect(form.getByTestId(`secret-status-${kind}`)).toHaveText('Sin configurar')
      await expect(form.getByTestId(`secret-input-${kind}`)).toHaveAttribute('type', 'password')
      await expect(form.getByTestId(`secret-input-${kind}`)).toHaveValue('')
    }

    const input = form.getByTestId('secret-input-classicToken')
    await input.fill(SECRET)
    await form.getByTestId('secret-save-classicToken').click()

    await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')
    await expect(input).toHaveValue('')
    await expect(form.getByTestId('secret-status-platformToken')).toHaveText('Sin configurar')
    await expectSecretNowhere()

    await form.getByTestId('form-cancel').click()
    await expect(form).toBeHidden()
  }
)

test(
  'AUD-03: Enter en un secreto guarda ese secreto y el formulario sigue abierto',
  { tag: '@tenants' },
  async () => {
    await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
    const form = page.getByTestId('environment-form')
    await expect(form).toBeVisible()
    await expect(form.getByTestId('secret-status-oauthClientSecret')).toHaveText('Sin configurar')

    const input = form.getByTestId('secret-input-oauthClientSecret')
    await input.fill('dt0s02.FALSOAUD03.SECRETOENTER')
    await input.press('Enter')

    await expect(form.getByTestId('secret-status-oauthClientSecret')).toHaveText('Configurado')
    await expect(input).toHaveValue('')
    await expect(form).toBeVisible()
    // Los otros secretos no cambian.
    await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')
    await expect(form.getByTestId('secret-status-platformToken')).toHaveText('Sin configurar')

    // Enter con el campo vacío no hace nada.
    await input.press('Enter')
    await expect(form).toBeVisible()
    await expect(form.getByTestId('secret-status-oauthClientSecret')).toHaveText('Configurado')

    // Se deja como estaba para las pruebas siguientes.
    await form.getByTestId('secret-delete-oauthClientSecret').click()
    const confirm = page.getByTestId('confirm-dialog')
    // Siempre pide confirmación (AUD-15: aserción fija, no condicional).
    await expect(confirm).toBeVisible()
    await expect(confirm).toHaveAttribute('role', 'alertdialog')
    await confirm.getByTestId('confirm-accept').click()
    await expect(confirm).toBeHidden()
    await expect(form.getByTestId('secret-status-oauthClientSecret')).toHaveText('Sin configurar')
    await form.getByTestId('form-cancel').click()
    await expect(form).toBeHidden()
    expect(await page.content()).not.toContain('SECRETOENTER')
  }
)

test(
  'AUD-18: borrar un secreto pide confirmación; el valor guardado no queda en la página',
  { tag: '@tenants' },
  async () => {
    const VALUE = 'dt0s02.FALSOAUD18.BORRARCONFIRMA'
    await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
    const form = page.getByTestId('environment-form')
    const status = form.getByTestId('secret-status-oauthClientSecret')
    const confirm = page.getByTestId('confirm-dialog')

    await form.getByTestId('secret-input-oauthClientSecret').fill(VALUE)
    await form.getByTestId('secret-save-oauthClientSecret').click()
    await expect(status).toHaveText('Configurado')
    // Tras guardar, el valor no está en el DOM ni en ningún campo (save.reset()).
    expect(await page.content()).not.toContain('BORRARCONFIRMA')
    const inputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input, textarea')).map(
        (el) => (el as HTMLInputElement).value
      )
    )
    expect(inputs.filter((value) => value.includes('BORRARCONFIRMA'))).toEqual([])

    // Cancelar: no se borra.
    await form.getByTestId('secret-delete-oauthClientSecret').click()
    await expect(confirm).toBeVisible()
    await expect(confirm).toHaveAttribute('role', 'alertdialog')
    await expect(confirm).toContainText('¿Borrar el Client secret de OAuth?')
    await confirm.getByTestId('confirm-cancel').click()
    await expect(confirm).toBeHidden()
    await expect(status).toHaveText('Configurado')
    await expect(form).toBeVisible()

    // Aceptar: se borra.
    await form.getByTestId('secret-delete-oauthClientSecret').click()
    await confirm.getByTestId('confirm-accept').click()
    await expect(confirm).toBeHidden()
    await expect(status).toHaveText('Sin configurar')
    await expect(form).toBeVisible()
    // El token clásico no se toca.
    await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')

    await form.getByTestId('form-cancel').click()
    await expect(form).toBeHidden()
  }
)

test(
  'AUD-18: pasar de SaaS a Managed con secretos de plataforma pide confirmación y los borra',
  { tag: '@tenants' },
  async () => {
    type Listed = {
      data: {
        environments: {
          name: string
          deployment: string
          secrets: Record<'classicToken' | 'oauthClientSecret' | 'platformToken', boolean>
        }[]
      }
    }
    const production = async (): Promise<Listed['data']['environments'][number] | undefined> =>
      ((await invoke('tenants:list')) as Listed).data.environments.find(
        (e) => e.name === 'Producción'
      )
    const form = page.getByTestId('environment-form')
    const confirm = page.getByTestId('confirm-dialog')
    const deployment = form.getByTestId('environment-deployment')
    const openForm = async (): Promise<void> => {
      await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
      await expect(form).toBeVisible()
    }

    // Producción en SaaS con los tres secretos.
    await openForm()
    for (const kind of ['oauthClientSecret', 'platformToken']) {
      await form.getByTestId(`secret-input-${kind}`).fill(`dt0s.FALSOAUD18.${kind}`)
      await form.getByTestId(`secret-save-${kind}`).click()
      await expect(form.getByTestId(`secret-status-${kind}`)).toHaveText('Configurado')
    }
    expect(await production()).toMatchObject({
      deployment: 'saas',
      secrets: { classicToken: true, oauthClientSecret: true, platformToken: true }
    })

    // A Managed: form-save no guarda y pregunta.
    await deployment.selectOption('managed')
    await form.getByTestId('form-save').click()
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('¿Pasar el entorno a Managed?')
    await expect(confirm).toContainText(
      'se borrarán estas credenciales guardadas: Client secret de OAuth, Platform token. El token clásico se conserva.'
    )

    // Cancelar: nada cambia.
    await confirm.getByTestId('confirm-cancel').click()
    await expect(confirm).toBeHidden()
    expect(await production()).toMatchObject({
      deployment: 'saas',
      secrets: { classicToken: true, oauthClientSecret: true, platformToken: true }
    })

    // Aceptar: Managed y sin los secretos de plataforma; el clásico se conserva.
    if (!(await form.isVisible())) await openForm()
    await deployment.selectOption('managed')
    await form.getByTestId('form-save').click()
    await confirm.getByTestId('confirm-accept').click()
    await expect(form).toBeHidden()
    await expect.poll(production).toMatchObject({
      deployment: 'managed',
      secrets: { classicToken: true, oauthClientSecret: false, platformToken: false }
    })

    // De Managed a SaaS: sin confirmación.
    await openForm()
    await deployment.selectOption('saas')
    await form.getByTestId('form-save').click()
    await expect(form).toBeHidden()
    await expect(confirm).toHaveCount(0)
    await expect.poll(async () => (await production())?.deployment).toBe('saas')

    // De SaaS a Managed sin secretos de plataforma: tampoco.
    await openForm()
    await deployment.selectOption('managed')
    await form.getByTestId('form-save').click()
    await expect(form).toBeHidden()
    await expect(confirm).toHaveCount(0)
    await expect.poll(async () => (await production())?.deployment).toBe('managed')

    // Se deja en SaaS para las pruebas siguientes.
    await openForm()
    await deployment.selectOption('saas')
    await form.getByTestId('form-save').click()
    await expect(form).toBeHidden()
    await expect.poll(async () => (await production())?.deployment).toBe('saas')
    expect(await page.content()).not.toContain('FALSOAUD18')
  }
)

test(
  'CA3 (0064): escribir en un secreto de plataforma, pasar a Managed, guardar y confirmar no pregunta por secretos sin guardar',
  { tag: '@tenants' },
  async () => {
    const form = page.getByTestId('environment-form')
    const confirm = page.getByTestId('confirm-dialog')
    const deployment = form.getByTestId('environment-deployment')
    const openForm = async (): Promise<void> => {
      await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
      await expect(form).toBeVisible()
    }

    // Producción en SaaS con un secreto de plataforma guardado (así pasar a Managed pide confirmar).
    await openForm()
    await form.getByTestId('secret-input-oauthClientSecret').fill('dt0s.FALSO0064.GUARDADO')
    await form.getByTestId('secret-save-oauthClientSecret').click()
    await expect(form.getByTestId('secret-status-oauthClientSecret')).toHaveText('Configurado')

    // Se escribe en otro secreto de plataforma sin guardarlo, se pasa a Managed, se guarda y se
    // confirma: su campo deja de existir y no puede quedar «sucio».
    await form.getByTestId('secret-input-platformToken').fill('dt0s16.FALSO0064.SINGUARDAR')
    await deployment.selectOption('managed')
    await form.getByTestId('form-save').click()
    await expect(confirm).toContainText('¿Pasar el entorno a Managed?')
    await confirm.getByTestId('confirm-accept').click()

    // Sin el aviso «¿Cerrar sin guardar la credencial?», el formulario se cierra.
    await expect(form, 'el formulario sigue abierto (¿aviso de secretos sin guardar?)').toBeHidden()
    await expect(page.getByText(es.secrets.unsavedTitle)).toHaveCount(0)
    await expect(confirm).toHaveCount(0)

    // Se deja en SaaS (sin secretos de plataforma) para las pruebas siguientes.
    await openForm()
    await deployment.selectOption('saas')
    await form.getByTestId('form-save').click()
    await expect(form).toBeHidden()
    expect(await page.content()).not.toContain('FALSO0064')
  }
)

test(
  'AUD-03: un secreto escrito sin guardar pide confirmación al cerrar',
  { tag: '@tenants' },
  async () => {
    const form = page.getByTestId('environment-form')
    const confirm = page.getByTestId('confirm-dialog')

    for (const close of ['form-cancel', 'Escape'] as const) {
      await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
      await expect(form).toBeVisible()
      const input = form.getByTestId('secret-input-platformToken')
      await input.fill('dt0s16.FALSOAUD03.SINGUARDAR')

      const tryClose = async (): Promise<void> => {
        if (close === 'Escape') await page.keyboard.press('Escape')
        else await form.getByTestId('form-cancel').click()
      }

      // Cancelar la confirmación: el formulario sigue y el valor se conserva.
      await tryClose()
      await expect(confirm, close).toBeVisible()
      await expect(confirm).toHaveAttribute('role', 'alertdialog')
      await confirm.getByTestId('confirm-cancel').click()
      await expect(confirm).toBeHidden()
      await expect(form).toBeVisible()
      await expect(input).toHaveValue('dt0s16.FALSOAUD03.SINGUARDAR')

      // Aceptar: se cierra y el secreto NO se ha guardado.
      await tryClose()
      await confirm.getByTestId('confirm-accept').click()
      await expect(form).toBeHidden()

      await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
      await expect(form.getByTestId('secret-status-platformToken')).toHaveText('Sin configurar')
      await expect(form.getByTestId('secret-input-platformToken')).toHaveValue('')
      await form.getByTestId('form-cancel').click()
      // Sin nada escrito, cerrar no pide confirmación.
      await expect(confirm).toHaveCount(0)
      await expect(form).toBeHidden()
    }
    expect(await page.content()).not.toContain('SINGUARDAR')
  }
)

test(
  'AUD-03: Enter en un campo del entorno sigue guardando el entorno',
  { tag: '@tenants' },
  async () => {
    await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
    const form = page.getByTestId('environment-form')
    await form.getByTestId('environment-tags').fill('core, aud03')
    await form.getByTestId('environment-name').press('Enter')
    await expect(form).toBeHidden()

    const list = (await invoke('tenants:list')) as {
      data: { environments: { name: string; tags: string[] }[] }
    }
    expect(list.data.environments.find((e) => e.name === 'Producción')?.tags).toEqual([
      'core',
      'aud03'
    ])
  }
)

test(
  'elige el entorno en el selector: ruta Cliente › Entorno › Sección y distintivo de Producción',
  { tag: '@tenants' },
  async () => {
    await page.getByTestId('env-selector').click()
    const option = page.getByRole('option', { name: 'Cliente A › Producción' })
    await expect(page.getByRole('option')).toHaveCount(2)
    await page.keyboard.type('Produ')
    await expect(page.getByRole('option')).toHaveCount(1)
    await option.click()

    const selector = page.getByTestId('env-selector')
    await expect(selector).toHaveText(/Cliente A\s*›\s*Producción/)
    await expect(
      selector.locator('[data-testid="env-type-badge"][data-type="production"]')
    ).toBeVisible()
    await expect(breadcrumb()).toHaveText(/Cliente A\s*›\s*Producción\s*›\s*Ajustes/)
    await expect(
      breadcrumb().locator('[data-testid="env-type-badge"][data-type="production"]')
    ).toBeVisible()

    // La ruta sigue a la sección.
    await page.getByTestId('nav-problems').click()
    await expect(breadcrumb()).toHaveText(/Cliente A\s*›\s*Producción\s*›\s*Problemas/)
  }
)

test(
  'la tarjeta de estado muestra el token clásico "Sin comprobar"',
  { tag: '@tenants' },
  async () => {
    const status = page.getByTestId('env-status')
    await expect(status).toContainText('Token clásico')
    await expect(status).toContainText('Sin comprobar')
    await expect(status).not.toContainText('Sin credenciales')
    await expect(status).not.toContainText('Sin entorno configurado')
  }
)

test('Ctrl+K lista los entornos y elegir uno lo activa', { tag: '@tenants' }, async () => {
  const palette = page.getByTestId('command-palette')
  await page.keyboard.press('Control+K')
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('option')).toHaveCount(11 + 2)
  await expect(palette.getByRole('option', { name: 'Cliente A › Producción' })).toHaveCount(1)
  await expect(palette.getByRole('option', { name: 'Cliente A › Desarrollo' })).toHaveCount(1)

  await page.keyboard.type('Desarrollo')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()

  const selector = page.getByTestId('env-selector')
  await expect(selector).toHaveText(/Cliente A\s*›\s*Desarrollo/)
  await expect(
    selector.locator('[data-testid="env-type-badge"][data-type="production"]')
  ).toHaveCount(0)
  await expect(
    breadcrumb().locator('[data-testid="env-type-badge"][data-type="production"]')
  ).toHaveCount(0)
  await expect(page.getByTestId('env-status')).toContainText('Sin credenciales')

  // Vuelve a Producción con el selector.
  await selector.click()
  await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
  await expect(selector).toHaveText(/Cliente A\s*›\s*Producción/)
})

test(
  'selector y Ctrl+K agrupan por cliente y ordenan por tipo; la ruta muestra el tipo con su distintivo',
  { tag: '@tenants' },
  async () => {
    // Un cliente aparte, con tipos desordenados y dos "otro"; se borra al final.
    const client = (await invoke('clients:create', {
      name: 'Cliente Orden',
      color: '#225588'
    })) as {
      ok: boolean
      data: { id: string }
    }
    const clientId = client.data.id
    const base = {
      clientId,
      deployment: 'saas',
      classicApiUrl: CLASSIC_URL,
      platformUrl: null,
      ssoUrl: null,
      oauthClientId: null,
      oauthScopes: [],
      accountUuid: null,
      certificateLevel: 'system',
      captureUrlPatterns: [],
      tags: [],
      readOnly: false
    }
    for (const [name, type] of [
      ['Zeta', 'other'],
      ['Dev', 'development'],
      ['Alfa', 'other'],
      ['Prod', 'production']
    ]) {
      await invoke('environments:create', { ...base, name, type })
    }
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    const expected = [
      'Cliente Orden › Producción',
      'Cliente Orden › Desarrollo',
      'Cliente Orden › Alfa',
      'Cliente Orden › Zeta'
    ]

    // Selector: grupo con el nombre del cliente y opciones en orden de tipo y, a igualdad, de nombre.
    await page.getByTestId('env-selector').click()
    const group = page.getByRole('group', { name: 'Cliente Orden' })
    await expect(group).toBeVisible()
    await expect(group.getByRole('option')).toHaveText(expected.map((name) => new RegExp(name)))
    for (const [i, type] of ['production', 'development', 'other', 'other'].entries()) {
      await expect(group.getByRole('option').nth(i).getByTestId('env-type-badge')).toHaveAttribute(
        'data-type',
        type
      )
    }
    await group.getByRole('option', { name: 'Cliente Orden › Producción' }).click()
    await expect(breadcrumb()).toHaveText(/Cliente Orden\s*›\s*Producción\s*›/)
    const crumbBadge = breadcrumb().getByTestId('env-type-badge')
    await expect(crumbBadge).toHaveAttribute('data-type', 'production')
    await expect(crumbBadge).toHaveAttribute('aria-label', /Producción/)
    await expect(crumbBadge).toHaveText('')

    // Ctrl+K: el mismo orden dentro del grupo del cliente.
    await page.keyboard.press('Control+K')
    const palette = page.getByTestId('command-palette')
    const paletteOptions = palette.getByRole('option').filter({ hasText: 'Cliente Orden' })
    await expect(paletteOptions).toHaveText(expected.map((name) => new RegExp(name)))
    await page.keyboard.press('Escape')

    // Se vuelve al estado anterior: Producción de Cliente A activo y Cliente Orden borrado.
    await page.getByTestId('env-selector').click()
    await page.getByRole('option', { name: 'Cliente A › Producción' }).click()
    await invoke('clients:delete', { id: clientId })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('env-selector')).toHaveText(/Cliente A\s*›\s*Producción/)
  }
)

test('en inglés: estados de credenciales y tarjeta traducidos', { tag: '@tenants' }, async () => {
  await goToSettings()
  await page.getByTestId('language-en').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  await expect(page.getByTestId('env-status')).toContainText('Classic token')
  await expect(page.getByTestId('env-status')).toContainText('Not checked')

  await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
  const form = page.getByTestId('environment-form')
  await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configured')
  await expect(form.getByTestId('secret-status-platformToken')).toHaveText('Not configured')
  await form.getByTestId('form-cancel').click()
  await expect(form).toBeHidden()

  await page.getByTestId('language-es').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
})

test(
  'al relanzar la app siguen el entorno activo, el cliente, los entornos y el secreto',
  { tag: '@tenants' },
  async () => {
    await app.close()
    await launch()

    const selector = page.getByTestId('env-selector')
    await expect(selector).toHaveText(/Cliente A\s*›\s*Producción/)
    await expect(
      selector.locator('[data-testid="env-type-badge"][data-type="production"]')
    ).toBeVisible()

    await goToSettings()
    await expect(clientRow('Cliente A')).toHaveCount(1)
    await expect(clientRow('Cliente A').getByTestId('environment-row')).toHaveCount(2)

    await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
    const form = page.getByTestId('environment-form')
    await expect(form.getByTestId('secret-status-classicToken')).toHaveText('Configurado')
    await expect(form.getByTestId('secret-input-classicToken')).toHaveValue('')
    await form.getByTestId('form-cancel').click()
    await expectSecretNowhere()
  }
)

test(
  'sin cifrado disponible: aviso y campos de credenciales deshabilitados',
  { tag: '@tenants' },
  async () => {
    // Simula un equipo sin safeStorage. Se restaura al final de la prueba.
    await app.evaluate(({ safeStorage }) => {
      const target = safeStorage as unknown as Record<string, unknown>
      target['__vigiaOriginalIsAvailable'] = safeStorage.isEncryptionAvailable
      target['isEncryptionAvailable'] = () => false
    })
    try {
      await environmentRow('Cliente A', 'Producción').getByTestId('environment-edit').click()
      const form = page.getByTestId('environment-form')
      await expect(form).toBeVisible()
      const warning = form.getByTestId('secrets-unavailable')
      await expect(warning).toBeVisible()
      await expect(warning).toHaveAttribute('role', 'alert')
      for (const kind of ['classicToken', 'oauthClientSecret', 'platformToken']) {
        await expect(form.getByTestId(`secret-input-${kind}`)).toBeDisabled()
      }
      await form.getByTestId('form-cancel').click()
      await expect(form).toBeHidden()
    } finally {
      await app.evaluate(({ safeStorage }) => {
        const target = safeStorage as unknown as Record<string, unknown>
        target['isEncryptionAvailable'] = target['__vigiaOriginalIsAvailable']
      })
    }
  }
)

test(
  'AUD-21: Ctrl+K con un diálogo abierto saca la paleta por encima y con el foco',
  { tag: '@tenants' },
  async () => {
    await clientRow('Cliente A').getByTestId('environment-add').click()
    const form = page.getByTestId('environment-form')
    await expect(form).toBeVisible()

    await page.keyboard.press('Control+K')
    const palette = page.getByTestId('command-palette')
    await expect(palette).toBeVisible()
    // Lo que hay en el centro de la paleta es la paleta, no el diálogo ni su fondo.
    const onTop = await palette.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return hit !== null && el.contains(hit)
    })
    expect(onTop).toBe(true)
    // El foco está en la paleta: lo que se escribe va a su buscador.
    expect(await palette.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.type('Ajustes')
    await expect(palette.getByRole('option', { name: /Ajustes/ }).first()).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()
    if (await form.isVisible()) await form.getByTestId('form-cancel').click()
    await expect(form).toBeHidden()
  }
)

test('borrar un entorno pide confirmación', { tag: '@tenants' }, async () => {
  const row = environmentRow('Cliente A', 'Desarrollo')
  const confirm = page.getByTestId('confirm-dialog')

  await row.getByTestId('environment-delete').click()
  await expect(confirm).toBeVisible()
  await expect(confirm).toHaveAttribute('role', 'alertdialog')
  await confirm.getByTestId('confirm-cancel').click()
  await expect(confirm).toBeHidden()
  await expect(row).toHaveCount(1)

  await row.getByTestId('environment-delete').click()
  await confirm.getByTestId('confirm-accept').click()
  await expect(confirm).toBeHidden()
  await expect(row).toHaveCount(0)
  // El activo era Producción: no cambia.
  await expect(page.getByTestId('env-selector')).toHaveText(/Cliente A\s*›\s*Producción/)
})

test(
  'borrar el cliente del entorno activo deja la app sin entorno',
  { tag: '@tenants' },
  async () => {
    await clientRow('Cliente A').getByTestId('client-delete').click()
    const confirm = page.getByTestId('confirm-dialog')
    await expect(confirm).toBeVisible()
    await confirm.getByTestId('confirm-accept').click()
    await expect(confirm).toBeHidden()

    await expect(page.getByTestId('client-row')).toHaveCount(0)
    await expect(page.getByTestId('env-selector')).toHaveText(/Sin entorno/)
    await expect(breadcrumb()).toHaveText(/^\s*Ajustes\s*$/)
    await expect(page.getByTestId('env-status')).toContainText('Sin entorno configurado')
    await expect(invoke('tenants:list')).resolves.toEqual({
      ok: true,
      data: { clients: [], environments: [] }
    })
    await expectNothingForbidden()
  }
)

test(
  'i18n: el resumen de la importación usa plurales (1 cliente, 2 clientes, 0 entornos)',
  { tag: '@tenants' },
  async () => {
    /** Un fichero de configuración inventado, con los clientes y entornos dados. */
    const configFile = (clients: { name: string; environments: string[] }[]): string => {
      const path = join(userDataDir, `import-${clients.map((c) => c.name).join('-')}.json`)
      const file = {
        format: 'vigia-config',
        version: 1,
        exportedAt: '2026-10-04T00:00:00.000Z',
        clients: clients.map((client) => ({
          name: client.name,
          color: '#336699',
          environments: client.environments.map((name) => ({
            name,
            type: 'development',
            deployment: 'managed',
            classicApiUrl: 'https://dt.ejemplo.local/e/importado',
            platformUrl: null,
            ssoUrl: null,
            oauthClientId: null,
            oauthScopes: [],
            accountUuid: null,
            certificateLevel: 'system',
            captureUrlPatterns: [],
            tags: [],
            readOnly: false
          }))
        }))
      }
      writeFileSync(path, JSON.stringify(file), 'utf8')
      return path
    }
    /** El diálogo nativo de abrir fichero devuelve `path` (se sustituye en main). */
    const answerOpenDialog = async (path: string): Promise<void> => {
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as never
      }, path)
    }

    await goToSettings()
    const summary = page.getByTestId('import-summary')

    // Singular: 1 cliente y 1 entorno.
    await answerOpenDialog(configFile([{ name: 'Importado Uno', environments: ['Desarrollo'] }]))
    await page.getByTestId('config-import').click()
    await expect(summary).toContainText('Creados: 1 cliente y 1 entorno.')
    const dialog = page.getByTestId('import-summary-dialog')
    await dialog.getByRole('button', { name: es.importSummary.close }).click()
    await expect(dialog).toBeHidden()

    // Plural y cero: 2 clientes y 0 entornos.
    await answerOpenDialog(
      configFile([
        { name: 'Importado Dos', environments: [] },
        { name: 'Importado Tres', environments: [] }
      ])
    )
    await page.getByTestId('config-import').click()
    await expect(summary).toContainText('Creados: 2 clientes y 0 entornos.')
    await dialog.getByRole('button', { name: es.importSummary.close }).click()
    await expect(dialog).toBeHidden()
    await expect(clientRow('Importado Tres')).toHaveCount(1)
  }
)

test(
  'sin errores en consola ni peticiones remotas en todo el recorrido',
  { tag: '@tenants' },
  async () => {
    // Va la última: resume lo ocurrido en las pruebas anteriores, en los dos arranques.
    expect(consoleErrors).toEqual([])
    expect(remoteRequests).toEqual([])
  }
)
