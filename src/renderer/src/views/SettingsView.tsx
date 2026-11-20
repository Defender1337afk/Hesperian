import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, onEvent } from '../bridge'
import { Avatar, errorText, Range, Row, Seg, Switch } from '../components/common'
import { useStore } from '../store'
import { ACCENTS, applySettings, GRADIENTS, gradientCss, switchTheme, THEMES, themeId } from '../themes'
import { CURRENT, ROADMAP } from '../../../shared/release'
import { hueFromImage } from '../components/Aether'
import type { UpdateCheck, UpdateProgress } from '../../../shared/types'

function UpdateButton(): ReactNode {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<UpdateCheck | null>(null)
  useEffect(
    () =>
      onEvent<UpdateProgress>('update:progress', (p) => {
        if (p.stage === 'download') setText(p.total ? `Скачиваем: ${Math.round((p.done / p.total) * 100)}%` : 'Скачиваем…')
        else setText(p.stage === 'install' ? 'Устанавливаем…' : 'Перезапускаем…')
      }),
    []
  )
  const check = (): void => {
    setBusy(true)
    setText('Проверяем…')
    void api
      .checkUpdate()
      .then((r: UpdateCheck) => {
        setFound(r.state === 'available' ? r : null)
        setText(r.state === 'available' ? `Есть ${r.version}${r.codename ? ` ${r.codename}` : ''}` : r.state === 'offline' ? 'Нет связи с сервером обновлений' : 'У вас последняя версия')
      })
      .finally(() => setBusy(false))
  }
  const install = (): void => {
    if (!found) return
    if (!found.auto) {
      void api.openExternal(found.url!)
      return
    }
    setBusy(true)
    api.installUpdate().catch((e: unknown) => {
      setText(errorText(e))
      setBusy(false)
    })
  }
  return (
    <div className="row">
      {found ? (
        <button className="btn sm primary" disabled={busy} onClick={install}>{found.auto ? 'Обновить' : 'Скачать'}</button>
      ) : (
        <button className="btn sm" disabled={busy} onClick={check}>Проверить обновления</button>
      )}
      {text && <small className="muted">{text}</small>}
    </div>
  )
}

function ThemeCard({ theme }: { theme: (typeof THEMES)[number] }): ReactNode {
  const on = useStore((s) => themeId(s.settings?.theme) === theme.id)
  const bloom = theme.id === 'bloom'
  return (
    <button className={`theme-card ${on ? 'on' : ''}`} onClick={(e) => switchTheme(theme.id, e)}>
      <span className={`tc-preview ${bloom ? 'tc-bloom' : ''}`} style={{ background: theme.bg }}>
        <span className="tc-side" style={{ background: theme.panel, width: bloom ? 10 : undefined }} />
        {bloom ? (
          <span className="tc-bloom-body">
            <i style={{ background: theme.fg, opacity: 0.8 }} />
            <b style={{ background: theme.panel }}><em style={{ background: 'hsl(var(--accent-h) 55% 62%)' }} /></b>
          </span>
        ) : (
          <span className="tc-lines">
            <i style={{ background: 'hsl(var(--accent-h) 55% 62%)', width: '38%' }} />
            <i style={{ background: theme.fg, opacity: 0.45, width: '72%' }} />
            <i style={{ background: theme.fg, opacity: 0.28, width: '54%' }} />
          </span>
        )}
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
  ['appearance', 'Интерфейс'],
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
                <b className="sensitive">{account.name}</b>
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
        </section>

        <section ref={refs.appearance} className="rise" style={{ '--i': 1 } as React.CSSProperties}>
          <h3>Интерфейс</h3>
          <div className="theme-grid">{THEMES.map((t) => <ThemeCard theme={t} key={t.id} />)}</div>
          <Row title="Оформление" desc="Работает и в Legacy, и в New">
            <Seg value={st.appearance ?? 'dark'} options={[['dark', 'Тёмное'], ['light', 'Светлое'], ['black', 'Чёрное'], ['system', 'Как в системе']]} onChange={(appearance) => void set({ appearance })} />
          </Row>
          <Row title="Акцент">
            <div className="accents">
              {ACCENTS.map((hue) => (
                <button key={hue} className={`accent-sw ${(st.accentMode ?? 'hue') === 'hue' && st.accentHue === hue ? 'on' : ''}`} style={{ background: `hsl(${hue} 55% 60%)` }} aria-label={`Оттенок ${hue}`} onClick={() => void set({ accentHue: hue, accentMode: 'hue' })} />
              ))}
              <span className="accents-sep" />
              <button className={`accent-sw mono white ${st.accentMode === 'white' ? 'on' : ''}`} aria-label="Белый" title="Белый" onClick={() => void set({ accentMode: 'white' })} />
              <button className={`accent-sw mono black ${st.accentMode === 'black' ? 'on' : ''}`} aria-label="Чёрный" title="Чёрный" onClick={() => void set({ accentMode: 'black' })} />
            </div>
          </Row>
          <Row title="Градиент" desc="Кнопки, переключатели и полоски переливаются">
            <div className="accents">
              {GRADIENTS.map((g) => (
                <button key={g.id} className={`accent-sw grad ${st.accentMode === 'gradient' && st.accentGradient === g.id ? 'on' : ''}`} style={{ background: gradientCss(g.stops) }} aria-label={g.name} title={g.name} onClick={() => void set({ accentMode: 'gradient', accentGradient: g.id })} />
              ))}
            </div>
          </Row>
          <Row title="Иконки модов" desc="В списках модов, на главной и в магазине">
            <Seg value={st.iconStyle ?? 'original'} options={[['original', 'Оригинал'], ['accent', 'В цвет акцента'], ['mono', 'Монохром']]} onChange={(iconStyle) => void set({ iconStyle })} />
          </Row>
          {(st.accentMode ?? 'hue') === 'hue' && <Row title="Свой оттенок"><Range value={st.accentHue} min={0} max={359} fmt={(v) => `${v}°`} onChange={(accentHue) => void set({ accentHue })} /></Row>}
          <Row title="Сворачивать в трей" desc="Крестик прячет окно в трей, оттуда же можно сразу запустить последние сборки"><Switch on={Boolean(st.minimizeToTray)} label="Трей" onChange={(minimizeToTray) => void set({ minimizeToTray })} /></Row>
          <Row title="Напоминать о перерыве" desc="Уведомление во время игры">
            <Seg value={st.breakReminderMin ?? 0} options={[[0, 'Выкл'], [30, '30 мин'], [60, '1 ч'], [90, '1,5 ч'], [120, '2 ч']]} onChange={(breakReminderMin) => void set({ breakReminderMin })} />
          </Row>
          <Row title="Режим стримера" desc="Размывает ник, IP-адреса и адреса серверов друзей"><Switch on={Boolean(st.streamerMode)} label="Режим стримера" onChange={(streamerMode) => void set({ streamerMode })} /></Row>
          <Row title="Big Picture при запуске" desc="Лаунчер сразу открывается на весь экран. Вручную включается клавишей F11">
            <Switch on={st.bigPictureOnStart} onChange={(v) => set({ bigPictureOnStart: v })} label="Big Picture при запуске" />
          </Row>
          <Row title="Плотность">
            <Seg value={st.density} options={[['compact', 'Компактно'], ['comfortable', 'Обычно'], ['spacious', 'Просторно']]} onChange={(density) => void set({ density })} />
          </Row>
          <Row title="Скругления"><Range value={st.radius} min={0} max={16} fmt={(v) => `${v} px`} onChange={(radius) => void set({ radius })} /></Row>
          <Row title="Размер интерфейса"><Range value={st.uiSize} min={11} max={16} fmt={(v) => `${v} px`} onChange={(uiSize) => void set({ uiSize })} /></Row>
          <Row title="Анимации" desc="Плавные переходы и смена темы кругом от курсора"><Switch on={st.animations} label="Анимации" onChange={(animations) => void set({ animations })} /></Row>
          <Row title="Фон" desc="Картинка, GIF или видео без звука за содержимым вкладок. Можно перетащить файл прямо в окно">
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
              {st.backgroundImage && (
                <button
                  className="btn"
                  title="Подобрать цвет акцента под фон"
                  onClick={() => {
                    void hueFromImage(st.backgroundImage)
                      .then((accentHue) => (accentHue === null ? toast('warn', 'В фоне нет ярких цветов') : set({ accentHue, accentMode: 'hue' })))
                      .catch(() => toast('warn', 'Не удалось прочитать фон'))
                  }}
                >
                  Цвет из фона
                </button>
              )}
              {st.backgroundImage && <button className="btn" onClick={() => void api.clearBackground().then((next: typeof st) => useStore.setState({ settings: next }))}>Убрать</button>}
            </div>
          </Row>
          {st.backgroundImage && (
            <>
              <Row title="Заметность фона"><Range value={st.backgroundOpacity} min={3} max={80} fmt={(v) => `${v}%`} onChange={(backgroundOpacity) => void set({ backgroundOpacity })} /></Row>
              <Row title="Подгонка фона"><Seg value={st.backgroundFit ?? 'cover'} options={[['cover', 'Заполнить'], ['contain', 'Вписать целиком']]} onChange={(backgroundFit) => void set({ backgroundFit })} /></Row>
              <Row title="Размытие фона"><Range value={st.backgroundBlur ?? 0} min={0} max={30} fmt={(v) => (v ? `${v} px` : 'нет')} onChange={(backgroundBlur) => void set({ backgroundBlur })} /></Row>
            </>
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
          <Row title="Кэш классов Java" desc="Для Minecraft 1.20.5 и новее. Первый запуск дольше примерно на 10 секунд, зато потом игра стартует быстрее. Занимает около 100 МБ на сборку">
            <Switch on={Boolean(st.classCache)} label="Кэш классов" onChange={(classCache) => void set({ classCache })} />
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
            <UpdateButton />
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
