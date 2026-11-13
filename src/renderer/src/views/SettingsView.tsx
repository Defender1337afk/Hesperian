import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../bridge'
import { Avatar, errorText, Range, Row, Seg, Switch } from '../components/common'
import { useStore } from '../store'
import { ACCENTS, applySettings, isCrystal, switchTheme, THEMES } from '../themes'
import { CURRENT, ROADMAP } from '../../../shared/release'

function ThemeCard({ theme }: { theme: (typeof THEMES)[number] }): ReactNode {
  const on = useStore((s) => s.settings?.theme === theme.id)
  return (
    <button className={`theme-card ${on ? 'on' : ''}`} onClick={(e) => switchTheme(theme.id, e)}>
      <span className={`tc-preview ${isCrystal(theme.id) ? 'tc-crystal' : ''}`} style={{ background: isCrystal(theme.id) ? undefined : theme.bg }}>
        <span className="tc-side" style={{ background: isCrystal(theme.id) ? 'rgba(255, 255, 255, .12)' : theme.panel }} />
        <span className="tc-lines">
          <i style={{ background: isCrystal(theme.id) ? 'linear-gradient(90deg, #ffb84a, #ff3d8b)' : 'hsl(var(--accent-h) 55% 62%)', width: '38%' }} />
          <i style={{ background: theme.fg, opacity: 0.45, width: '72%' }} />
          <i style={{ background: theme.fg, opacity: 0.28, width: '54%' }} />
        </span>
      </span>
      <span className="tc-name">{theme.name}</span>
    </button>
  )
}

function TextSetting({ value, onSave, placeholder, mono, area }: {
  value: string
  onSave: (value: string) => void
  placeholder?: string
  mono?: boolean
  area?: boolean
}): ReactNode {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const props = {
    value: draft,
    placeholder,
    spellCheck: false,
    onBlur: () => draft !== value && onSave(draft)
  }
  return area ? (
    <textarea {...props} className={`input area css-input ${mono ? 'mono' : ''}`} rows={6} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <input {...props} className={`input sm set-input ${mono ? 'mono' : ''}`} onChange={(e) => setDraft(e.target.value)} />
  )
}

function NumberSetting({ value, onSave, min, max }: { value: number; onSave: (value: number) => void; min: number; max: number }): ReactNode {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <input
      type="number"
      className="input sm num-input"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft)
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max) onSave(parsed)
        else setDraft(String(value))
      }}
    />
  )
}

type SectionId = 'account' | 'appearance' | 'game' | 'data' | 'about'

const NAV: [SectionId, string][] = [
  ['account', 'Аккаунт'],
  ['appearance', 'Внешний вид'],
  ['game', 'Игра'],
  ['data', 'Данные'],
  ['about', 'О программе']
]

export function SettingsView(): ReactNode {
  const st = useStore((s) => s.settings)!
  const system = useStore((s) => s.system)!
  const accounts = useStore((s) => s.accounts)
  const activeId = useStore((s) => s.activeAccountId)
  const set = useStore((s) => s.patchSettings)
  const setAccounts = useStore((s) => s.setAccounts)
  const toast = useStore((s) => s.toast)
  const confirm = useStore((s) => s.confirm)
  const refs = {
    account: useRef<HTMLElement>(null),
    appearance: useRef<HTMLElement>(null),
    game: useRef<HTMLElement>(null),
    data: useRef<HTMLElement>(null),
    about: useRef<HTMLElement>(null)
  }
  const [memory, setMemory] = useState(st.defaultMemoryMb)
  const gb = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toFixed(1).replace('.0', '')} ГБ` : `${mb} МБ`)

  return (
    <div className="settings">
      <nav className="set-nav">
        <h2>Настройки</h2>
        {NAV.map(([id, label]) => (
          <button key={id} onClick={() => refs[id].current?.scrollIntoView({ behavior: 'smooth' })}>{label}</button>
        ))}
        <button
          className="reset"
          onClick={() => {
            void confirm('Сбросить внешний вид?', 'Тема, акцент и размеры вернутся к стандартным.', 'Сбросить').then((ok) => {
              if (ok) void set({ theme: 'grove', accentHue: 145, density: 'comfortable', radius: 8, uiSize: 13, animations: true, backgroundImage: '', customCss: '' })
            })
          }}
        >
          Сбросить
        </button>
      </nav>
      <div className="set-body">
        <section ref={refs.account} className="rise">
          <h3>Аккаунт</h3>
          {accounts.map((account) => (
            <div className="account-card" key={account.id}>
              <Avatar account={account} size={44} />
              <div className="grow">
                <b>{account.name}</b>
                <small>{account.licensed ? 'Лицензия подтверждена' : 'Офлайн-профиль'}</small>
              </div>
              {account.id === activeId ? <span className="role">активен</span> : <button className="btn" onClick={() => void api.setActiveAccount(account.id).then(setAccounts)}>Выбрать</button>}
            </div>
          ))}
          {!accounts.length && (
            <div className="account-card">
              <div className="grow"><b>Вы не вошли</b><small>Лицензия Microsoft или офлайн-профиль.</small></div>
              <button className="btn primary" onClick={() => useStore.setState({ accountOpen: true })}>Добавить</button>
            </div>
          )}
          <Row title="Azure Client ID" desc="ID приложения Azure для входа через Microsoft. Как его получить, написано в README.">
            <TextSetting value={st.msClientId} mono placeholder="00000000-0000-0000-0000-000000000000" onSave={(v) => void set({ msClientId: v.trim() })} />
          </Row>
        </section>

        <section ref={refs.appearance} className="rise" style={{ '--i': 1 } as React.CSSProperties}>
          <h3>Внешний вид</h3>
          <div className="theme-grid">{THEMES.map((t) => <ThemeCard theme={t} key={t.id} />)}</div>
          {isCrystal(st.theme) && <Row title="Акцент и скругления" desc="Кристалл задаёт их сам: стекло и градиент янтарь, томат, ягода" />}
          {!isCrystal(st.theme) && <Row title="Акцент">
            <div className="accents">
              {ACCENTS.map((hue) => (
                <button key={hue} className={`accent-sw ${st.accentHue === hue ? 'on' : ''}`} style={{ background: `hsl(${hue} 55% 60%)` }} aria-label={`Оттенок ${hue}`} onClick={() => void set({ accentHue: hue })} />
              ))}
            </div>
          </Row>}
          {!isCrystal(st.theme) && <Row title="Свой оттенок"><Range value={st.accentHue} min={0} max={359} fmt={(v) => `${v}°`} onChange={(accentHue) => void set({ accentHue })} /></Row>}
          <Row title="Big Picture при запуске" desc="Лаунчер сразу открывается на весь экран. Вручную включается клавишей F11">
            <Switch on={st.bigPictureOnStart} onChange={(v) => set({ bigPictureOnStart: v })} label="Big Picture при запуске" />
          </Row>
          <Row title="Плотность">
            <Seg value={st.density} options={[['compact', 'Компактно'], ['comfortable', 'Обычно'], ['spacious', 'Просторно']]} onChange={(density) => void set({ density })} />
          </Row>
          {!isCrystal(st.theme) && <Row title="Скругления"><Range value={st.radius} min={0} max={16} fmt={(v) => `${v} px`} onChange={(radius) => void set({ radius })} /></Row>}
          <Row title="Размер интерфейса"><Range value={st.uiSize} min={11} max={16} fmt={(v) => `${v} px`} onChange={(uiSize) => void set({ uiSize })} /></Row>
          <Row title="Анимации" desc="Плавные переходы и смена темы кругом от курсора"><Switch on={st.animations} label="Анимации" onChange={(animations) => void set({ animations })} /></Row>
          <Row title="Фоновое изображение" desc="Показывается за содержимым вкладок">
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  api
                    .pickBackground()
                    .then((image) => {
                      if (image) void set({ backgroundImage: image })
                    })
                    .catch((e) => toast('error', errorText(e)))
                }}
              >
                Выбрать
              </button>
              {st.backgroundImage && <button className="btn" onClick={() => void set({ backgroundImage: '' })}>Убрать</button>}
            </div>
          </Row>
          {st.backgroundImage && (
            <Row title="Заметность фона"><Range value={st.backgroundOpacity} min={3} max={60} fmt={(v) => `${v}%`} onChange={(backgroundOpacity) => void set({ backgroundOpacity })} /></Row>
          )}
          <div className="set-row set-row-col">
            <div className="set-text">
              <b>Свой CSS</b>
              <small>Применяется поверх темы. Переменные: --accent, --bg, --panel, --raised, --line, --text, --muted, --radius.</small>
            </div>
            <TextSetting value={st.customCss} area mono placeholder=".tab.active { font-weight: 600; }" onSave={(customCss) => void set({ customCss })} />
          </div>
        </section>

        <section ref={refs.game} className="rise" style={{ '--i': 2 } as React.CSSProperties}>
          <h3>Игра</h3>
          <Row title="Память по умолчанию" desc={`В системе ${Math.round(system.totalMemoryMb / 1024)} ГБ. Сборка может задать своё значение.`}>
            <Range value={memory} min={512} max={Math.max(1024, system.totalMemoryMb - 1024)} step={256} fmt={gb} onChange={setMemory} onCommit={(defaultMemoryMb) => void set({ defaultMemoryMb })} />
          </Row>
          <Row title="Размер окна по умолчанию">
            <div className="row">
              <NumberSetting value={st.defaultWidth} min={320} max={7680} onSave={(defaultWidth) => void set({ defaultWidth })} />
              <span className="muted">×</span>
              <NumberSetting value={st.defaultHeight} min={240} max={4320} onSave={(defaultHeight) => void set({ defaultHeight })} />
            </div>
          </Row>
          <Row title="Аргументы JVM" desc="Добавляются ко всем сборкам">
            <TextSetting value={st.defaultJvmArgs} mono placeholder="-XX:+UseG1GC" onSave={(defaultJvmArgs) => void set({ defaultJvmArgs })} />
          </Row>
          <Row title="Режим для слабых ПК" desc="Лаунчер выгружается на время игры, Java получает подобранную память и лёгкие флаги, анимации выключаются">
            <Switch
              on={st.lowEnd}
              label="Режим для слабых ПК"
              onChange={(on) => {
                void api.setLowEnd(on).then((next) => {
                  useStore.setState({ settings: next })
                  applySettings(next)
                  toast('info', on ? 'Режим для слабых ПК включён' : 'Режим для слабых ПК выключен')
                })
              }}
            />
          </Row>
          <Row title="После запуска игры" desc={st.afterLaunch === 'unload' ? 'Окно закроется и освободит память, а после игры откроется снова' : undefined}>
            <Seg value={st.afterLaunch} options={[['keep', 'Оставить'], ['hide', 'Скрыть'], ['unload', 'Выгрузить']]} onChange={(afterLaunch) => void set({ afterLaunch })} />
          </Row>
          <Row title="Показывать вывод при запуске"><Switch on={st.openPanelOnLaunch} label="Показывать вывод при запуске" onChange={(openPanelOnLaunch) => void set({ openPanelOnLaunch })} /></Row>
        </section>

        <section ref={refs.data} className="rise" style={{ '--i': 3 } as React.CSSProperties}>
          <h3>Данные</h3>
          <Row title="Папка данных" desc={`Сейчас: ${system.dataDir}. После смены лаунчер перезапустится, существующие файлы нужно перенести вручную.`}>
            <div className="row">
              <button
                className="btn"
                onClick={() => {
                  void api.pickFolder().then(async (folder) => {
                    if (!folder) return
                    await set({ dataDir: folder })
                    await api.relaunch()
                  })
                }}
              >
                Изменить
              </button>
              {st.dataDir && <button className="btn" onClick={() => void set({ dataDir: '' }).then(() => api.relaunch())}>По умолчанию</button>}
            </div>
          </Row>
        </section>

        <section ref={refs.about} className="rise" style={{ '--i': 4 } as React.CSSProperties}>
          <h3>О программе</h3>
          <div className="about-card">
            <span className="wn-version">Hesperian {system.appVersion}</span>
            <b className="about-codename">{CURRENT.codename}</b>
            <small className="muted">Кодовое имя выпуска {CURRENT.version}. GPL-3.0, интерфейс основан на Sprout IDE.</small>
            <button className="btn sm" onClick={() => useStore.setState({ whatsNewOpen: true })}>Что нового</button>
          </div>
          <div className="roadmap">
            {ROADMAP.map((r) => (
              <div key={r.version} className={`road-row ${r.status}`}>
                <i />
                <div>
                  <b>{r.version === 'Wave' ? r.codename : `${r.version} ${r.codename}`}</b>
                  <span className="road-status">{{ released: 'вышла', current: 'сейчас', next: 'следующая', future: 'в планах' }[r.status]}</span>
                  <small>{r.summary}</small>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
