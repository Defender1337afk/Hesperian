import { useEffect, useState, type ReactNode } from 'react'
import type { PluginLogLine } from '../../../shared/types'
import { api, onEvent } from '../bridge'
import { errorText, Switch } from '../components/common'
import { I } from '../components/icons'
import { useStore } from '../store'

type Bundled = Awaited<ReturnType<typeof api.bundledPlugins>>[number]

const rise = (i: number): React.CSSProperties => ({ '--i': i }) as React.CSSProperties
const time = (at: number): string => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function PluginsView(): ReactNode {
  const plugins = useStore((s) => s.plugins)
  const toast = useStore((s) => s.toast)
  const prompt = useStore((s) => s.prompt)
  const [logs, setLogs] = useState<PluginLogLine[]>([])
  const [busy, setBusy] = useState(false)
  const [bundled, setBundled] = useState<Bundled[]>([])

  useEffect(() => {
    void api.bundledPlugins().then(setBundled)
  }, [plugins])

  useEffect(() => {
    void api.pluginLogs().then((list) => setLogs([...list]))
    return onEvent<PluginLogLine>('plugins:log', (line) => setLogs((l) => [...l.slice(-299), line]))
  }, [])

  const run = (action: () => Promise<unknown>): void => {
    setBusy(true)
    action()
      .then(() => useStore.getState().refreshPlugins())
      .catch((e) => toast('error', errorText(e)))
      .finally(() => setBusy(false))
  }

  const create = (): void => {
    void prompt('Новый плагин', 'Название, например «Мои напоминания»', 'Создать').then((name) => {
      if (name) run(() => api.createPlugin(name))
    })
  }

  const names = Object.fromEntries(plugins.map((p) => [p.id, p.name]))

  return (
    <div className="welcome">
      <div className="welcome-inner plugins-page">
        <h1 className="wm rise">Плагины<span>.</span></h1>
        <p className="hero-sub rise" style={rise(1)}>
          Свои команды, действия при запуске и выходе из игры, аргументы JVM. Плагин это папка с plugin.json и main.js.
        </p>
        <div className="row plug-actions rise" style={rise(2)}>
          <button className="btn primary" disabled={busy} onClick={create}><I.plus size={14} /> Новый плагин</button>
          <button className="btn" disabled={busy} onClick={() => run(() => api.reloadPlugins())}><I.refresh size={14} /> Перезагрузить</button>
          <button className="btn" onClick={() => void api.openPluginsFolder()}><I.folder size={14} /> Папка плагинов</button>
        </div>
        <p className="plug-warn rise" style={rise(3)}>
          <I.warning size={14} /> Плагины работают с полными правами лаунчера. Ставьте только свои или те, которым доверяете.
        </p>

        {bundled.some((b) => !b.installed) && (
          <>
            <h3 className="rise" style={rise(4)}>Готовые плагины</h3>
            <div className="plug-ready rise" style={rise(4)}>
              {bundled.filter((b) => !b.installed).map((b) => (
                <div className="plug-ready-card" key={b.id}>
                  <b>{b.name}</b>
                  <small>{b.description}</small>
                  <button className="btn sm" disabled={busy} onClick={() => run(() => api.installBundledPlugin(b.id))}><I.download size={13} /> Поставить</button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="plug-list rise" style={rise(4)}>
          {plugins.length === 0 && (
            <div className="plug-empty">
              <I.sparkle size={22} />
              <b>Плагинов пока нет</b>
              <small>Нажмите «Новый плагин»: шаблон с примерами команды, хуков запуска и хранилища появится сразу.</small>
            </div>
          )}
          {plugins.map((p) => (
            <div className={`plug-card ${p.enabled ? '' : 'off'}`} key={p.id}>
              <div className="plug-head">
                <span className="plug-icon">{p.name.slice(0, 1).toUpperCase()}</span>
                <div className="grow">
                  <b>{p.name} <span className="muted">{p.version}</span></b>
                  <small>{p.description || p.id}{p.author ? ` · ${p.author}` : ''}</small>
                </div>
                {!p.id.startsWith('broken:') && (
                  <Switch on={p.enabled} label={`Включить ${p.name}`} onChange={(on) => run(() => api.setPluginEnabled(p.id, on))} />
                )}
              </div>
              {p.error && <div className="plug-error"><I.warning size={13} /> {p.error}</div>}
              {p.enabled && (p.commands.length > 0 || p.hooks > 0) && (
                <div className="plug-cmds">
                  {p.commands.map((c) => (
                    <button key={c.id} className="btn sm" onClick={() => run(() => api.runPluginCommand(p.id, c.id))}>
                      <I.command size={13} /> {c.title}
                    </button>
                  ))}
                  {p.hooks > 0 && <span className="role">хуков: {p.hooks}</span>}
                </div>
              )}
              <button className="plug-folder" onClick={() => void api.openPluginsFolder()} title={p.folder}>{p.folder}</button>
            </div>
          ))}
        </div>

        <h3 className="rise" style={rise(5)}>Журнал</h3>
        <div className="plug-log rise" style={rise(6)}>
          {logs.length === 0 && <span className="muted">Пусто</span>}
          {logs.slice(-200).map((l, i) => (
            <div key={i} className={`plug-line ${l.level}`}>
              <span className="muted">{time(l.at)}</span> <b>{names[l.pluginId] ?? l.pluginId}</b> {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
