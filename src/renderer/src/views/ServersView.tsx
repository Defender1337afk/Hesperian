import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FriendServer, Instance, LocalServer, ServerAddress, ServerPing } from '../../../shared/types'
import { api, onEvent } from '../bridge'
import { errorText, Seg } from '../components/common'
import { I } from '../components/icons'
import { useStore } from '../store'

const rise = (i: number): React.CSSProperties => ({ '--i': i }) as React.CSSProperties

const KIND_LABEL: Record<ServerAddress['kind'], string> = {
  radmin: 'Radmin VPN',
  hamachi: 'Hamachi',
  zerotier: 'ZeroTier',
  lan: 'Локальная сеть',
  other: 'Другая сеть'
}

const GAMEMODES: [LocalServer['gamemode'], string][] = [['survival', 'Выживание'], ['creative', 'Творчество'], ['adventure', 'Приключение']]
const DIFFICULTIES: [LocalServer['difficulty'], string][] = [['peaceful', 'Мирная'], ['easy', 'Лёгкая'], ['normal', 'Обычная'], ['hard', 'Сложная']]

function copy(text: string): void {
  void navigator.clipboard.writeText(text)
  useStore.getState().toast('info', `Скопировано: ${text}`)
}

function PlayOn({ address, mcVersion, loader }: { address: string; mcVersion?: string; loader?: 'vanilla' | 'fabric' }): ReactNode {
  const instances = useStore((s) => s.instances)
  const play = useStore((s) => s.play)
  const toast = useStore((s) => s.toast)
  const fitting = useMemo(() => (mcVersion ? instances.filter((i) => i.mcVersion === mcVersion) : instances), [instances, mcVersion])
  const [target, setTarget] = useState('')
  useEffect(() => {
    if (!fitting.some((i) => i.id === target)) setTarget(fitting[0]?.id ?? '')
  }, [fitting, target])
  if (!fitting.length && mcVersion) {
    return (
      <button
        className="btn"
        onClick={() => {
          api
            .createInstance({ name: `Сервер ${mcVersion}`, mcVersion, loader: loader ?? 'vanilla', color: '#5aa9e6' })
            .then(async (created: Instance) => {
              await useStore.getState().refreshInstances()
              toast('info', `Создана сборка «${created.name}»`)
              void play(created.id, address)
            })
            .catch((e: unknown) => toast('error', errorText(e)))
        }}
      >
        <I.plus size={13} /> Сборка {mcVersion} и играть
      </button>
    )
  }
  return (
    <span className="srv-play">
      <select className="input sm" value={target} onChange={(e) => setTarget(e.target.value)}>
        {fitting.map((i) => (
          <option key={i.id} value={i.id}>{i.name} · {i.mcVersion}</option>
        ))}
      </select>
      <button className="run-btn" disabled={!target} onClick={() => void play(target, address)}>
        <I.play size={13} /> Играть
      </button>
    </span>
  )
}

function ServerCard({ server, addresses, onChange }: { server: LocalServer; addresses: ServerAddress[]; onChange: () => void }): ReactNode {
  const toast = useStore((s) => s.toast)
  const [busy, setBusy] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const state = server.status.state

  useEffect(() => {
    if (!consoleOpen) return
    void api.serverLog(server.id).then((l: string[]) => setLines([...l]))
    return onEvent<{ serverId: string; text: string }>('server:log', (e) => {
      if (e.serverId === server.id) setLines((l) => [...l.slice(-500), e.text])
    })
  }, [consoleOpen, server.id])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [lines])

  const run = (fn: () => Promise<unknown>): void => {
    setBusy(true)
    fn()
      .catch((e) => toast('error', errorText(e)))
      .finally(() => {
        setBusy(false)
        onChange()
      })
  }
  const update = (patch: Partial<LocalServer>): void => run(() => api.updateServer(server.id, patch))
  const best = addresses[0]

  return (
    <div className={`srv-card ${state}`}>
      <div className="srv-head">
        <span className={`srv-dot ${state}`} />
        <div className="grow">
          <b>{server.name}</b>
          <small>
            {server.mcVersion} · {server.loader === 'fabric' ? 'Fabric' : 'Vanilla'} · порт {server.port}
            {state === 'running' && ` · игроков ${server.status.players.length} из ${server.maxPlayers}`}
            {state === 'starting' && ' · запускается'}
          </small>
        </div>
        {state === 'stopped' ? (
          <button className="run-btn" disabled={busy} onClick={() => run(() => api.startServer(server.id))}>
            <I.play size={13} /> Запустить
          </button>
        ) : (
          <button className="run-btn stop" disabled={busy} onClick={() => run(() => api.stopServer(server.id))}>
            <I.stop size={13} /> Остановить
          </button>
        )}
      </div>

      {state !== 'stopped' && (
        <div className="srv-share">
          <span className="muted">Друзьям:</span>
          {addresses.length === 0 && <span className="muted">нет сетевых адресов</span>}
          {addresses.slice(0, 3).map((a) => (
            <button key={a.ip} className={`srv-addr ${a.kind}`} title="Скопировать" onClick={() => copy(`${a.ip}:${server.port}`)}>
              <i>{KIND_LABEL[a.kind]}</i> {a.ip}:{server.port} <I.copy size={12} />
            </button>
          ))}
        </div>
      )}
      {state === 'running' && server.status.players.length > 0 && (
        <div className="srv-players">
          {server.status.players.map((p) => (
            <span key={p} className="srv-player">{p}</span>
          ))}
        </div>
      )}

      <div className="srv-actions">
        <PlayOn address={`localhost:${server.port}`} mcVersion={server.mcVersion} loader={server.loader} />
        <span className="grow" />
        <button className={`ghost-btn ${consoleOpen ? 'on' : ''}`} onClick={() => setConsoleOpen(!consoleOpen)}><I.terminal size={14} /> Консоль</button>
        <button className={`ghost-btn ${settingsOpen ? 'on' : ''}`} onClick={() => setSettingsOpen(!settingsOpen)}><I.settings size={14} /> Настройки</button>
        <button className="ghost-btn" onClick={() => void api.openServerFolder(server.id)}><I.folder size={14} /> Папка</button>
        <button
          className="ghost-btn danger"
          disabled={state !== 'stopped'}
          onClick={() => {
            void useStore
              .getState()
              .confirm(`Удалить сервер «${server.name}»?`, 'Папка сервера с миром будет удалена.', 'Удалить')
              .then((ok) => ok && run(() => api.removeServer(server.id)))
          }}
        >
          <I.trash size={14} />
        </button>
      </div>

      {settingsOpen && (
        <div className="srv-settings">
          <label>Режим<Seg value={server.gamemode} options={GAMEMODES} onChange={(gamemode) => update({ gamemode })} /></label>
          <label>Сложность<Seg value={server.difficulty} options={DIFFICULTIES} onChange={(difficulty) => update({ difficulty })} /></label>
          <label>Игроков<input className="input sm num-input" type="number" min={1} max={100} defaultValue={server.maxPlayers} onBlur={(e) => update({ maxPlayers: Math.max(1, Number(e.target.value) || 10) })} /></label>
          <label>Память, МБ<input className="input sm num-input" type="number" min={1024} step={512} defaultValue={server.memoryMb} onBlur={(e) => update({ memoryMb: Math.max(1024, Number(e.target.value) || 2048) })} /></label>
          <label>Порт<input className="input sm num-input" type="number" min={1024} max={65535} defaultValue={server.port} onBlur={(e) => update({ port: Number(e.target.value) || 25565 })} /></label>
          <label className="wide">Описание<input className="input sm" defaultValue={server.motd} onBlur={(e) => update({ motd: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={server.pvp} onChange={(e) => update({ pvp: e.target.checked })} /> PvP</label>
          <label className="check"><input type="checkbox" checked={server.onlineMode} onChange={(e) => update({ onlineMode: e.target.checked })} /> Только лицензия</label>
          {state !== 'stopped' && <small className="muted wide">Изменения применятся после перезапуска сервера.</small>}
        </div>
      )}

      {consoleOpen && (
        <div className="srv-console">
          <div className="srv-log" ref={logRef}>
            {lines.length === 0 && <span className="muted">Сервер ещё ничего не написал</span>}
            {lines.map((l, i) => (
              <div key={i} className={/ERROR|Exception/.test(l) ? 'error' : /WARN/.test(l) ? 'warn' : ''}>{l}</div>
            ))}
          </div>
          <form
            className="srv-cmd"
            onSubmit={(e) => {
              e.preventDefault()
              if (!command.trim()) return
              api.sendServerCommand(server.id, command).catch((err: unknown) => toast('error', errorText(err)))
              setCommand('')
            }}
          >
            <span>/</span>
            <input className="input sm mono" value={command} placeholder={state === 'running' ? 'say Привет! · op Ник · time set day' : 'Запустите сервер'} disabled={state === 'stopped'} onChange={(e) => setCommand(e.target.value)} />
          </form>
        </div>
      )}
      {best?.kind !== 'radmin' && state !== 'stopped' && <small className="muted srv-tip">Чтобы играть через интернет, соберитесь с друзьями в одной сети Radmin VPN: её адрес появится здесь первым.</small>}
    </div>
  )
}

function FriendRow({ server, onRemove }: { server: FriendServer; onRemove: () => void }): ReactNode {
  const [ping, setPing] = useState<ServerPing | null>(null)
  useEffect(() => {
    let alive = true
    const check = (): void => {
      void api.pingServer(server.address).then((p: ServerPing) => alive && setPing(p))
    }
    check()
    const t = setInterval(check, 15000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [server.address])
  return (
    <div className="srv-friend">
      <span className={`srv-dot ${ping === null ? 'starting' : ping.online ? 'running' : 'stopped'}`} />
      <div className="grow">
        <b>{server.name}</b>
        <small>
          <span className="mono">{server.address}</span>
          {ping?.online && ` · ${ping.players}/${ping.maxPlayers} · ${ping.latencyMs} мс${ping.version ? ` · ${ping.version}` : ''}`}
          {ping && !ping.online && ' · не отвечает'}
        </small>
        {ping?.online && ping.motd && <small className="srv-motd">{ping.motd}</small>}
      </div>
      <PlayOn address={server.address} />
      <button className="ghost-btn" title="Скопировать адрес" onClick={() => copy(server.address)}><I.copy size={14} /></button>
      <button className="ghost-btn danger" title="Убрать" onClick={onRemove}><I.trash size={14} /></button>
    </div>
  )
}

export function ServersView(): ReactNode {
  const versions = useStore((s) => s.versions)
  const toast = useStore((s) => s.toast)
  const [servers, setServers] = useState<LocalServer[]>([])
  const [friends, setFriends] = useState<FriendServer[]>([])
  const [addresses, setAddresses] = useState<ServerAddress[]>([])
  const [creating, setCreating] = useState(false)
  const releases = useMemo(() => versions.filter((v) => v.type === 'release'), [versions])
  const [form, setForm] = useState({ name: 'Сервер с друзьями', mcVersion: '', loader: 'vanilla' as 'vanilla' | 'fabric', acceptEula: false })
  const [friend, setFriend] = useState({ name: '', address: '' })

  const load = useCallback(() => {
    void api.listServers().then(setServers)
    void api.listFriendServers().then(setFriends)
    void api.serverAddresses().then(setAddresses)
  }, [])
  useEffect(() => {
    load()
    return onEvent('server:state', load)
  }, [load])
  useEffect(() => {
    if (!form.mcVersion && releases[0]) setForm((f) => ({ ...f, mcVersion: releases[0].id }))
  }, [releases, form.mcVersion])

  return (
    <div className="welcome">
      <div className="welcome-inner servers-page">
        <h1 className="wm rise">Серверы<span>.</span></h1>
        <p className="hero-sub rise" style={rise(1)}>Свой сервер в один клик: друзья заходят по вашему адресу из Radmin VPN или локальной сети. Чужие серверы добавляются по IP.</p>

        <div className="srv-addresses rise" style={rise(2)}>
          {addresses.map((a) => (
            <button key={a.ip} className={`srv-addr ${a.kind}`} onClick={() => copy(a.ip)} title="Скопировать">
              <i>{KIND_LABEL[a.kind]}</i> {a.ip} <I.copy size={12} />
            </button>
          ))}
        </div>

        <div className="section-row rise" style={rise(3)}>
          <h3>Мои серверы</h3>
          {!creating && <button className="btn primary" onClick={() => setCreating(true)}><I.plus size={14} /> Новый сервер</button>}
        </div>
        {creating && (
          <form
            className="srv-create rise"
            onSubmit={(e) => {
              e.preventDefault()
              api
                .createServer(form)
                .then(() => {
                  setCreating(false)
                  load()
                })
                .catch((err: unknown) => toast('error', errorText(err)))
            }}
          >
            <label>Название<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Версия
              <select className="input" value={form.mcVersion} onChange={(e) => setForm({ ...form, mcVersion: e.target.value })}>
                {releases.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
              </select>
            </label>
            <label>Загрузчик<Seg value={form.loader} options={[['vanilla', 'Vanilla'], ['fabric', 'Fabric']]} onChange={(loader) => setForm({ ...form, loader })} /></label>
            <label className="check">
              <input type="checkbox" checked={form.acceptEula} onChange={(e) => setForm({ ...form, acceptEula: e.target.checked })} />
              Я принимаю <a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal('https://aka.ms/MinecraftEULA') }}>EULA Minecraft</a>
            </label>
            <div className="row">
              <button className="btn" type="button" onClick={() => setCreating(false)}>Отмена</button>
              <button className="btn primary" disabled={!form.acceptEula || !form.mcVersion}>Создать</button>
            </div>
          </form>
        )}
        <div className="srv-list rise" style={rise(4)}>
          {servers.length === 0 && !creating && (
            <div className="plug-empty">
              <I.globe size={22} />
              <b>Своих серверов пока нет</b>
              <small>Сервер скачается сам при первом запуске. Игроки без лицензии тоже смогут зайти.</small>
            </div>
          )}
          {servers.map((s) => (
            <ServerCard key={s.id} server={s} addresses={addresses} onChange={load} />
          ))}
        </div>

        <h3 className="rise" style={rise(5)}>Серверы друзей</h3>
        <form
          className="srv-add rise"
          style={rise(5)}
          onSubmit={(e) => {
            e.preventDefault()
            api
              .addFriendServer(friend.name, friend.address)
              .then((list: FriendServer[]) => {
                setFriends(list)
                setFriend({ name: '', address: '' })
              })
              .catch((err: unknown) => toast('error', errorText(err)))
          }}
        >
          <input className="input" placeholder="Название, например «У Димы»" value={friend.name} onChange={(e) => setFriend({ ...friend, name: e.target.value })} />
          <input className="input mono" placeholder="26.12.34.56:25565" value={friend.address} onChange={(e) => setFriend({ ...friend, address: e.target.value })} />
          <button className="btn primary" disabled={!friend.address.trim()}><I.plus size={14} /> Добавить</button>
        </form>
        <div className="srv-list rise" style={rise(6)}>
          {friends.map((f) => (
            <FriendRow key={f.id} server={f} onRemove={() => void api.removeFriendServer(f.id).then(setFriends)} />
          ))}
        </div>
      </div>
    </div>
  )
}
