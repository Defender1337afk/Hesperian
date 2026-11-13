import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { Account, AccountsState, MsLoginEvent } from '../shared/types'
import { getSettings, readJsonSync, writeJsonSync } from './config'
import { emit } from './events'
import { fetchJson, HttpError, postJson } from './net'
import type { LaunchAuth } from './minecraft/launch'

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'

interface StoredAccount extends Account {
  secret?: string
}

interface Stored {
  accounts: StoredAccount[]
  activeId: string | null
}

interface Secret {
  refreshToken: string
  accessToken: string
  expiresAt: number
}

const file = (): string => join(app.getPath('userData'), 'accounts.json')
const load = (): Stored => readJsonSync<Stored>(file(), { accounts: [], activeId: null })
const save = (s: Stored): void => writeJsonSync(file(), s)

const publicAccount = ({ secret: _secret, ...account }: StoredAccount): Account => account

export function getAccounts(): AccountsState {
  const s = load()
  return { accounts: s.accounts.map(publicAccount), activeId: s.activeId }
}

export function setActiveAccount(id: string): AccountsState {
  const s = load()
  if (s.accounts.some((a) => a.id === id)) {
    s.activeId = id
    save(s)
  }
  return getAccounts()
}

export function removeAccount(id: string): AccountsState {
  const s = load()
  s.accounts = s.accounts.filter((a) => a.id !== id)
  if (s.activeId === id) s.activeId = s.accounts[0]?.id ?? null
  save(s)
  return getAccounts()
}

function upsert(account: StoredAccount): void {
  const s = load()
  s.accounts = [...s.accounts.filter((a) => a.id !== account.id), account]
  s.activeId = account.id
  save(s)
}

function offlineUuid(name: string): string {
  const h = createHash('md5').update(`OfflinePlayer:${name}`).digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  return h.toString('hex')
}

export function addOfflineAccount(name: string): AccountsState {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('Ник: 3-16 символов, латиница, цифры и подчёркивание')
  }
  upsert({ id: randomUUID(), kind: 'offline', name, uuid: offlineUuid(name), licensed: false })
  return getAccounts()
}

const encrypt = (secret: Secret): string => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Шифрование хранилища системы недоступно')
  return safeStorage.encryptString(JSON.stringify(secret)).toString('base64')
}

const decrypt = (value: string): Secret =>
  JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64'))) as Secret

interface MsToken {
  access_token: string
  refresh_token: string
}

const form = (values: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(values).toString()
})

const XSTS_ERRORS: Record<number, string> = {
  2148916233: 'У этого аккаунта Microsoft нет профиля Xbox. Создайте его на xbox.com и повторите вход.',
  2148916235: 'Xbox Live недоступен в стране, указанной в этом аккаунте Microsoft.',
  2148916236: 'Аккаунт требует подтверждения возраста на xbox.com.',
  2148916237: 'Аккаунт требует подтверждения возраста на xbox.com.',
  2148916238: 'Детский аккаунт: его нужно добавить в семейную группу Microsoft.'
}

async function minecraftLogin(ms: MsToken, progress: (m: string) => void): Promise<{ account: StoredAccount }> {
  progress('Вход в Xbox Live')
  const xbl = await postJson<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${ms.access_token}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }
  )
  let xsts: { Token: string }
  try {
    xsts = await postJson<{ Token: string }>('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      const code = (JSON.parse(e.body || '{}') as { XErr?: number }).XErr
      throw new Error((code && XSTS_ERRORS[code]) || 'Xbox Live отклонил вход')
    }
    throw e
  }

  progress('Вход в Minecraft')
  const uhs = xbl.DisplayClaims.xui[0].uhs
  let mc: { access_token: string; expires_in: number }
  try {
    mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: `XBL3.0 x=${uhs};${xsts.Token}`
    })
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) {
      throw new Error(
        'Minecraft отклонил это приложение: Client ID ещё не одобрен Mojang для Minecraft API. ' +
          'Заявка подаётся через форму aka.ms/mce-reviewappid.'
      )
    }
    throw e
  }

  progress('Проверка лицензии')
  const auth = { Authorization: `Bearer ${mc.access_token}` }
  let profile: { id: string; name: string; skins?: { url: string; state: string }[] }
  try {
    profile = await fetchJson('https://api.minecraftservices.com/minecraft/profile', { headers: auth })
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      throw new Error('На этом аккаунте нет лицензии Minecraft или ещё не создан игровой профиль.')
    }
    throw e
  }

  return {
    account: {
      id: `ms-${profile.id}`,
      kind: 'microsoft',
      name: profile.name,
      uuid: profile.id,
      skinUrl: profile.skins?.find((s) => s.state === 'ACTIVE')?.url,
      licensed: true,
      secret: encrypt({
        refreshToken: ms.refresh_token,
        accessToken: mc.access_token,
        expiresAt: Date.now() + mc.expires_in * 1000
      })
    }
  }
}

let loginGeneration = 0

const notify = (event: MsLoginEvent): void => emit('account:login', event)

export function cancelMicrosoftLogin(): void {
  loginGeneration++
  notify({ state: 'cancelled' })
}

const describe = (e: unknown): string => {
  if (e instanceof HttpError) {
    try {
      const body = JSON.parse(e.body) as { error_description?: string; errorMessage?: string }
      return body.error_description ?? body.errorMessage ?? e.message
    } catch {
      return e.message
    }
  }
  return e instanceof Error ? e.message : String(e)
}

const BUILT_IN_CLIENT_ID = ''

const microsoftClientId = (): string => getSettings().msClientId.trim() || BUILT_IN_CLIENT_ID

export async function startMicrosoftLogin(): Promise<void> {
  const generation = ++loginGeneration
  const clientId = microsoftClientId()
  try {
    if (!clientId) throw new Error('Сначала укажите Azure Client ID в настройках (раздел «Аккаунты»).')
    const device = await fetchJson<{
      device_code: string
      user_code: string
      verification_uri: string
      interval: number
      expires_in: number
    }>(`${AUTHORITY}/devicecode`, form({ client_id: clientId, scope: 'XboxLive.signin offline_access' }))
    notify({ state: 'code', userCode: device.user_code, verificationUri: device.verification_uri })

    const deadline = Date.now() + device.expires_in * 1000
    let interval = device.interval
    while (generation === loginGeneration) {
      if (Date.now() > deadline) throw new Error('Время действия кода истекло. Начните вход заново.')
      await new Promise((resolve) => setTimeout(resolve, interval * 1000))
      if (generation !== loginGeneration) return
      let token: MsToken
      try {
        token = await fetchJson<MsToken>(
          `${AUTHORITY}/token`,
          form({
            client_id: clientId,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: device.device_code
          })
        )
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 400) throw e
        const code = (JSON.parse(e.body || '{}') as { error?: string }).error
        if (code === 'authorization_pending') continue
        if (code === 'slow_down') {
          interval += 5
          continue
        }
        throw e
      }
      const { account } = await minecraftLogin(token, (message) => notify({ state: 'working', message }))
      if (generation !== loginGeneration) return
      upsert(account)
      notify({ state: 'done', account: publicAccount(account) })
      return
    }
  } catch (e) {
    if (generation === loginGeneration) notify({ state: 'error', message: describe(e) })
  }
}

export async function getLaunchAuth(): Promise<LaunchAuth> {
  const s = load()
  const account = s.accounts.find((a) => a.id === s.activeId)
  if (!account) throw new Error('Добавьте аккаунт, чтобы начать игру')
  if (account.kind === 'offline') {
    return { name: account.name, uuid: account.uuid, accessToken: '0', userType: 'legacy' }
  }
  if (!account.secret) throw new Error('Войдите в аккаунт Microsoft заново')
  let secret = decrypt(account.secret)
  if (Date.now() > secret.expiresAt - 60_000) {
    try {
      const ms = await fetchJson<MsToken>(
        `${AUTHORITY}/token`,
        form({
          client_id: microsoftClientId(),
          grant_type: 'refresh_token',
          refresh_token: secret.refreshToken,
          scope: 'XboxLive.signin offline_access'
        })
      )
      const { account: fresh } = await minecraftLogin(ms, () => {})
      upsert(fresh)
      secret = decrypt(fresh.secret!)
      return { name: fresh.name, uuid: fresh.uuid, accessToken: secret.accessToken, userType: 'msa' }
    } catch (e) {
      throw new Error(`Не удалось обновить вход Microsoft: ${describe(e)}. Войдите в аккаунт заново.`)
    }
  }
  return { name: account.name, uuid: account.uuid, accessToken: secret.accessToken, userType: 'msa' }
}
