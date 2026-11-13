import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LoaderType, LoaderVersion, MsLoginEvent, VersionType } from '../../../shared/types'
import { api, onEvent } from '../bridge'
import { useStore, type MenuEntry } from '../store'
import { Avatar, errorText, INSTANCE_COLORS, LOADER_NAMES, Seg, Swatches } from './common'
import { I } from './icons'
import { commands } from './menus'

export function Menu(): ReactNode {
  const menu = useStore((s) => s.menu)
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('.menu') && !target.closest('.menu-btn')) useStore.setState({ menu: null })
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useStore.setState({ menu: null })
    }
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', esc)
    }
  }, [menu])
  if (!menu) return null
  const y = Math.max(8, Math.min(menu.y, window.innerHeight - 40))
  return (
    <div className="menu" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 290)), top: y, maxHeight: window.innerHeight - 20 - y }}>
      {menu.items.map((item, i) =>
        item.sep ? (
          <div className="menu-sep" key={i} />
        ) : (
          <button
            key={i}
            className={`menu-item ${item.danger ? 'menu-danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              useStore.setState({ menu: null })
              item.run?.()
            }}
          >
            <span className="mi-check">{item.check ? <I.check size={13} /> : item.icon}</span>
            <span className="mi-label">{item.label}</span>
            {item.kbd && <span className="mi-kbd">{item.kbd}</span>}
          </button>
        )
      )}
    </div>
  )
}

export function AccountMenu(): ReactNode {
  const open = useStore((s) => s.accountOpen)
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeAccountId)
  const setAccounts = useStore((s) => s.setAccounts)
  const prompt = useStore((s) => s.prompt)
  const confirm = useStore((s) => s.confirm)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!target.closest('.account-menu') && !target.closest('.avatar-btn') && !target.closest('.avatar-btn-empty') && !target.closest('.scrim')) {
        useStore.setState({ accountOpen: false })
      }
    }
    window.addEventListener('mousedown', off)
    return () => window.removeEventListener('mousedown', off)
  }, [open])

  if (!open) return null
  const active = accounts.find((a) => a.id === activeId)
  const others = accounts.filter((a) => a.id !== activeId)
  const close = (): void => useStore.setState({ accountOpen: false })

  const addOffline = async (): Promise<void> => {
    const name = await prompt('Офлайн-профиль', 'Ник: 3–16 символов, латиница и цифры', 'Добавить')
    if (!name) return
    try {
      setAccounts(await api.addOfflineAccount(name))
      close()
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <div className="account-menu">
      {active ? (
        <div className="am-head">
          <Avatar account={active} size={44} />
          <div className="am-who">
            <b>{active.name} {active.licensed && <I.check size={13} className="verified" />}</b>
            <small>{active.licensed ? 'Лицензия подтверждена' : 'Офлайн-профиль'}</small>
          </div>
        </div>
      ) : (
        <div className="am-head">
          <div className="am-who">
            <b>Вы не вошли</b>
            <small>Добавьте аккаунт, чтобы играть</small>
          </div>
        </div>
      )}
      {others.length > 0 && (
        <div className="am-actions">
          {others.map((account) => (
            <button key={account.id} onClick={() => void api.setActiveAccount(account.id).then(setAccounts)}>
              <Avatar account={account} size={18} /> {account.name}
              <small className="am-kind">{account.licensed ? 'лицензия' : 'офлайн'}</small>
            </button>
          ))}
        </div>
      )}
      <div className="am-actions">
        <button onClick={() => { close(); useStore.setState({ loginOpen: true }) }}><I.user size={15} /> Войти через Microsoft</button>
        <button onClick={() => void addOffline()}><I.plus size={15} /> Добавить офлайн-профиль</button>
        {active && (
          <>
            <div className="am-sep" />
            <button
              className="danger"
              onClick={() => {
                void confirm(`Удалить ${active.name}?`, 'Лаунчер забудет этот аккаунт. Сборки и миры останутся.', 'Удалить').then((ok) => {
                  if (ok) void api.removeAccount(active.id).then(setAccounts)
                })
              }}
            >
              <I.logout size={15} /> Удалить аккаунт
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function LoginDialog(): ReactNode {
  const open = useStore((s) => s.loginOpen)
  const settingsClientId = useStore((s) => s.settings?.msClientId ?? '')
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    void api.microsoftLoginAvailable().then(setAvailable)
  }, [settingsClientId])
  const clientId = available
  const setAccounts = useStore((s) => s.setAccounts)
  const toast = useStore((s) => s.toast)
  const openSettings = useStore((s) => s.openSettings)
  const [event, setEvent] = useState<MsLoginEvent | null>(null)

  useEffect(
    () =>
      onEvent<MsLoginEvent>('account:login', (next) => {
        setEvent(next)
        if (next.state === 'done') {
          void api.getAccounts().then(setAccounts)
          toast('info', `Вход выполнен: ${next.account.name}`)
          useStore.setState({ loginOpen: false })
          setEvent(null)
        }
      }),
    [setAccounts, toast]
  )

  if (!open) return null
  const pending = event?.state === 'code' || event?.state === 'working'
  const close = (): void => {
    if (pending) void api.cancelMicrosoftLogin()
    setEvent(null)
    useStore.setState({ loginOpen: false })
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog">
        <h2>Вход через Microsoft</h2>
        {!clientId ? (
          <p className="muted">Для входа нужен Azure Client ID. Укажите его в настройках, инструкция есть в README.</p>
        ) : (
          <p className="muted">Вход идёт на странице Microsoft, пароль лаунчеру не передаётся. Нужен для лицензионных серверов, скин подтянется сам.</p>
        )}
        {event?.state === 'code' && (
          <div className="device-code">
            <span className="field-label">Откройте страницу входа и введите код</span>
            <div className="device-code-value">
              <code>{event.userCode}</code>
              <button className="icon-btn" title="Скопировать" onClick={() => void navigator.clipboard.writeText(event.userCode)}><I.copy size={15} /></button>
            </div>
            <button className="btn primary" onClick={() => void api.openExternal(event.verificationUri)}><I.reveal size={14} /> Открыть страницу входа</button>
            <span className="hint"><span className="spinner sb-spinner" /> Ожидание подтверждения</span>
          </div>
        )}
        {event?.state === 'working' && <p className="muted"><span className="spinner sb-spinner" /> {event.message}</p>}
        {event?.state === 'error' && <p className="hint bad">{event.message}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={close}>{pending ? 'Отмена' : 'Закрыть'}</button>
          {!clientId ? (
            <button className="btn primary" onClick={() => { close(); openSettings() }}>Открыть настройки</button>
          ) : (
            !pending && <button className="btn primary" onClick={() => void api.startMicrosoftLogin()}>Войти</button>
          )}
        </div>
      </div>
    </div>
  )
}

const LOADERS: [LoaderType, string][] = [
  ['vanilla', 'Без модов'],
  ['fabric', 'Лёгкий и быстрый'],
  ['forge', 'Классика'],
  ['neoforge', 'Новый Forge']
]
const TYPE_OPTIONS: [VersionType, string][] = [['release', 'Релизы'], ['snapshot', 'Снапшоты']]
const TAG_LABEL = { recommended: 'рекомендуемая', latest: 'последняя' }

interface Experiment {
  id: string
  title: string
  text: string
  version: string
  engine?: 'horizon'
}

const HORIZON: Experiment = {
  id: 'horizon',
  title: 'Horizon',
  text: 'Minecraft 26.3, полностью переписанный на Rust. Без Java, свой лаунчер и настройки.',
  version: '26.3',
  engine: 'horizon'
}

const APRIL_VERSIONS: Experiment[] = [
  { id: '26w14a', title: 'Herdcraft (2026)', text: 'Инвентаря нет, вещи становятся духами-спутниками', version: '26w14a' },
  { id: '25w14craftmine', title: 'Craftmine (2025)', text: 'Шахты-измерения, которые вы создаёте сами', version: '25w14craftmine' },
  { id: '24w14potato', title: 'Картофель (2024)', text: 'Целое картофельное измерение', version: '24w14potato' },
  { id: '23w13a_or_b', title: 'Голосование (2023)', text: 'Мобы голосуют за безумные правила мира', version: '23w13a_or_b' },
  { id: '22w13oneblockatatime', title: 'Один блок (2022)', text: 'Носить и ставить можно только один блок', version: '22w13oneblockatatime' },
  { id: '20w14infinite', title: '20w14infinite (2020)', text: 'Бесконечные измерения из текста в книгах', version: '20w14infinite' }
]

export function NewInstanceDialog(): ReactNode {
  const open = useStore((s) => s.newInstanceOpen)
  const versions = useStore((s) => s.versions)
  const versionsError = useStore((s) => s.versionsError)
  const refreshInstances = useStore((s) => s.refreshInstances)
  const openInstance = useStore((s) => s.openInstance)
  const toast = useStore((s) => s.toast)

  const [type, setType] = useState<VersionType>('release')
  const [mc, setMc] = useState('')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('')
  const [loader, setLoader] = useState<LoaderType>('vanilla')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loaderState, setLoaderState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [color, setColor] = useState(INSTANCE_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [experimental, setExperimental] = useState(false)
  const [experiment, setExperiment] = useState<Experiment>(HORIZON)

  const filtered = useMemo(() => versions.filter((v) => v.type === type), [versions, type])

  useEffect(() => {
    if (!filtered.some((v) => v.id === mc)) setMc(filtered[0]?.id ?? '')
  }, [filtered, mc])

  useEffect(() => {
    setLoaderVersions([])
    setLoaderVersion('')
    if (!open || loader === 'vanilla' || !mc) {
      setLoaderState('idle')
      return
    }
    let alive = true
    setLoaderState('loading')
    api
      .loaderVersions(loader, mc)
      .then((list) => {
        if (!alive) return
        setLoaderVersions(list)
        setLoaderVersion((list.find((v) => v.tag === 'recommended') ?? list[0])?.version ?? '')
        setLoaderState('idle')
      })
      .catch(() => {
        if (alive) setLoaderState('error')
      })
    return () => {
      alive = false
    }
  }, [open, loader, mc])

  if (!open) return null
  const close = (): void => {
    setExperimental(false)
    useStore.setState({ newInstanceOpen: false })
  }
  const finalName = experimental ? name.trim() || experiment.title : name.trim() || (mc ? `Minecraft ${mc}${loader !== 'vanilla' ? ` ${LOADER_NAMES[loader]}` : ''}` : '')
  const canCreate = experimental ? !busy : Boolean(mc) && (loader === 'vanilla' || Boolean(loaderVersion)) && !busy

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const instance = await api.createInstance({
        name: finalName,
        mcVersion: experimental ? experiment.version : mc,
        loader: experimental ? 'vanilla' : loader,
        loaderVersion: experimental || loader === 'vanilla' ? undefined : loaderVersion,
        engine: experimental ? experiment.engine : undefined,
        color,
        group: group.trim() || undefined
      })
      await refreshInstances()
      close()
      setName('')
      setGroup('')
      openInstance(instance.id)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide">
        <div className="new-head">
          <h2>Новая сборка</h2>
          <button className={`btn exp-toggle ${experimental ? 'on' : ''}`} onClick={() => setExperimental(!experimental)}>
            {experimental ? 'Обычные версии' : 'Экспериментальные'}
          </button>
        </div>
        {experimental ? (
          <>
            <span className="field-label">Другой движок</span>
            <button className={`tpl exp-card ${experiment.id === HORIZON.id ? 'on' : ''}`} onClick={() => setExperiment(HORIZON)}>
              <span className="tpl-text"><b>{HORIZON.title}</b><small>{HORIZON.text}</small></span>
            </button>
            {experiment.id === HORIZON.id && (
              <p className="hint exp-note">
                Сторонний проект, не связан с Mojang и Hesperian. Запускается через собственный лаунчер Horizon: он сам входит в аккаунт Microsoft,
                ему нужна купленная Minecraft: Java Edition. Офлайн-аккаунт Hesperian и наши моды здесь не работают, Astra Visuals тоже.
              </p>
            )}
            <span className="field-label">Первоапрельские версии Mojang</span>
            <div className="exp-grid">
              {APRIL_VERSIONS.map((item) => (
                <button key={item.id} className={`tpl ${experiment.id === item.id ? 'on' : ''}`} onClick={() => setExperiment(item)}>
                  <span className="tpl-text"><b>{item.title}</b><small>{item.text}</small></span>
                </button>
              ))}
            </div>
          </>
        ) : (
        <>
        {versionsError && <p className="hint bad">Не удалось загрузить список версий: {versionsError}</p>}
        <div className="row new-version">
          <label className="field grow">
            <span>Версия игры</span>
            <select className="select full" value={mc} onChange={(e) => setMc(e.target.value)}>
              {filtered.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Показывать</span>
            <Seg value={type} options={TYPE_OPTIONS} onChange={setType} />
          </div>
        </div>
        <span className="field-label">Загрузчик модов</span>
        <div className="loader-grid">
          {LOADERS.map(([id, hint]) => (
            <button key={id} className={`tpl ${loader === id ? 'on' : ''}`} onClick={() => setLoader(id)}>
              <span className="tpl-text"><b>{LOADER_NAMES[id]}</b><small>{hint}</small></span>
            </button>
          ))}
        </div>
        {loader !== 'vanilla' && (
          <div className="loader-version">
            {loaderState === 'loading' && <span className="hint"><span className="spinner sb-spinner" /> Загрузка версий</span>}
            {loaderState === 'error' && <span className="hint bad">Не удалось получить версии {LOADER_NAMES[loader]}. Проверьте интернет.</span>}
            {loaderState === 'idle' && !loaderVersions.length && <span className="hint bad">{LOADER_NAMES[loader]} нет для версии {mc}.</span>}
            {loaderVersions.length > 0 && (
              <select className="select full" value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)} aria-label="Версия загрузчика">
                {loaderVersions.map((v) => (
                  <option key={v.version} value={v.version}>{v.version}{v.tag ? ` (${TAG_LABEL[v.tag]})` : ''}</option>
                ))}
              </select>
            )}
          </div>
        )}
        </>
        )}
        <div className="row new-names">
          <label className="field grow">
            <span>Название</span>
            <input className="input" value={name} placeholder={finalName} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field grow">
            <span>Группа</span>
            <input className="input" value={group} placeholder="Необязательно" onChange={(e) => setGroup(e.target.value)} />
          </label>
        </div>
        <span className="field-label">Цвет</span>
        <div className="new-colors"><Swatches value={color} colors={INSTANCE_COLORS} onChange={setColor} /></div>
        <div className="dialog-actions">
          <span className="hint grow">{experimental && experiment.engine ? 'Лаунчер Horizon скачается при первом запуске' : null}{experimental && experiment.engine ? null : 'Файлы игры и нужная Java скачаются при первом запуске.'}</span>
          <button className="btn" onClick={close}>Отмена</button>
          <button className="btn primary" disabled={!canCreate} onClick={() => void create()}>Создать</button>
        </div>
      </div>
    </div>
  )
}

function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 1
  let i = 0
  let score = 0
  let last = -2
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      score += last === j - 1 ? 5 : 1
      if (j === 0 || '/\\._- '.includes(t[j - 1])) score += 3
      last = j
      i++
    }
  }
  return i === q.length ? score - t.length * 0.01 : -1
}

export function Palette(): ReactNode {
  const mode = useStore((s) => s.palette)
  const instances = useStore((s) => s.instances)
  const openInstance = useStore((s) => s.openInstance)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mode) return
    setQ(mode === 'commands' ? '>' : '')
    setSel(0)
  }, [mode])

  const isCmd = q.startsWith('>')
  const items = useMemo<(MenuEntry & { dim?: string; color?: string })[]>(() => {
    if (!mode) return []
    const rank = <T,>(list: T[], key: (item: T) => string, query: string): T[] =>
      list
        .map((item) => ({ item, score: fuzzy(query, key(item)) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item)
    if (isCmd) return rank(commands(), (c) => c.label ?? '', q.slice(1).trim())
    return rank(instances, (i) => `${i.name} ${i.mcVersion} ${i.loader}`, q.trim()).map((i) => ({
      label: i.name,
      dim: i.loader === 'vanilla' ? i.mcVersion : `${i.mcVersion} · ${LOADER_NAMES[i.loader]}`,
      color: i.color,
      run: () => openInstance(i.id)
    }))
  }, [mode, q, isCmd, instances, openInstance])

  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!mode) return null
  const close = (): void => useStore.setState({ palette: null })
  const pick = (item: MenuEntry | undefined): void => {
    close()
    item?.run?.()
  }

  return (
    <div className="scrim top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette">
        <div className="pal-input-row">
          {isCmd ? <span className="pal-prefix">›</span> : <I.search size={15} />}
          <input
            className="pal-input"
            value={q}
            autoFocus
            placeholder="Название сборки — или > для команд"
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') pick(items[sel])
            }}
          />
        </div>
        <div className="pal-list" ref={listRef}>
          {items.map((item, i) => (
            <div
              key={`${item.label}${i}`}
              className={`pal-item ${i === sel ? 'sel' : ''}`}
              onMouseMove={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(item)
              }}
            >
              {item.color && <span className="fdot" style={{ background: item.color }} />}
              <span className="pal-label">{item.label}</span>
              {item.dim && <span className="pal-dim">{item.dim}</span>}
              {item.kbd && <span className="pal-kbd">{item.kbd}</span>}
            </div>
          ))}
          {!items.length && <div className="pal-empty">{isCmd || instances.length ? 'Ничего не найдено' : 'Сборок пока нет. Введите > для команд'}</div>}
        </div>
      </div>
    </div>
  )
}

export function PromptDialog(): ReactNode {
  const request = useStore((s) => s.promptRequest)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (request) ref.current?.focus()
  }, [request])
  if (!request) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && request.resolve(null)}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          request.resolve(ref.current?.value.trim() || null)
        }}
      >
        <h2>{request.title}</h2>
        <input className="input" ref={ref} placeholder={request.placeholder} onKeyDown={(e) => e.key === 'Escape' && request.resolve(null)} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => request.resolve(null)}>Отмена</button>
          <button type="submit" className="btn primary">{request.ok}</button>
        </div>
      </form>
    </div>
  )
}

export function ConfirmDialog(): ReactNode {
  const request = useStore((s) => s.confirmRequest)
  if (!request) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && request.resolve(false)} onKeyDown={(e) => e.key === 'Escape' && request.resolve(false)}>
      <div className="dialog">
        <h2>{request.title}</h2>
        <p className="muted">{request.text}</p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => request.resolve(false)}>Отмена</button>
          <button className="btn danger" autoFocus onClick={() => request.resolve(true)}>{request.action}</button>
        </div>
      </div>
    </div>
  )
}

export function Toasts(): ReactNode {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.leaving ? 'leaving' : ''}`}>{t.text}</div>
      ))}
    </div>
  )
}
