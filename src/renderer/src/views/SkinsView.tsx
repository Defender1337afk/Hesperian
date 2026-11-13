import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { IdleAnimation, SkinViewer, WalkingAnimation } from 'skinview3d'
import type { SkinLibraryItem, SkinProfile } from '../../../shared/types'
import { api, onEvent } from '../bridge'
import { errorText, Seg } from '../components/common'
import { I } from '../components/icons'
import { useStore } from '../store'

type Variant = 'classic' | 'slim'

interface Candidate {
  name: string
  data: string
  variant: Variant
  source: string
}

const SITES: [string, string][] = [
  ['Minecraft Skins', 'https://www.minecraftskins.net/'],
  ['MCSkins', 'https://mcskins.top/'],
  ['Ely.by', 'https://ely.by/skins']
]

const STEVE = 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb'

const rise = (i: number): React.CSSProperties => ({ '--i': i }) as React.CSSProperties

function guessVariant(data: string): Promise<Variant> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (img.height !== 64) return resolve('classic')
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(54, 20, 1, 1).data[3] === 0 ? 'slim' : 'classic')
    }
    img.onerror = () => resolve('classic')
    img.src = data
  })
}

function Preview({ skin, cape, variant, walking }: { skin?: string; cape?: string; variant: Variant; walking: boolean }): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewer = useRef<SkinViewer | null>(null)
  useEffect(() => {
    const v = new SkinViewer({ canvas: canvas.current!, width: 260, height: 360 })
    v.autoRotate = true
    v.autoRotateSpeed = 0.6
    v.zoom = 0.85
    v.fov = 50
    viewer.current = v
    return () => v.dispose()
  }, [])
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    if (skin) void v.loadSkin(skin, { model: variant === 'slim' ? 'slim' : 'default' })
    else v.resetSkin()
  }, [skin, variant])
  useEffect(() => {
    const v = viewer.current
    if (!v) return
    if (cape) void v.loadCape(cape)
    else v.resetCape()
  }, [cape])
  useEffect(() => {
    if (viewer.current) viewer.current.animation = walking ? new WalkingAnimation() : new IdleAnimation()
  }, [walking])
  return <canvas ref={canvas} className="skin-canvas" />
}

export function SkinsView(): ReactNode {
  const account = useStore((s) => s.accounts.find((a) => a.id === s.activeAccountId))
  const toast = useStore((s) => s.toast)
  const setAccounts = useStore((s) => s.setAccounts)
  const licensed = Boolean(account?.licensed)
  const [profile, setProfile] = useState<SkinProfile | null>(null)
  const [current, setCurrent] = useState<{ skin?: string; cape?: string }>({})
  const [library, setLibrary] = useState<SkinLibraryItem[]>([])
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [walking, setWalking] = useState(true)
  const [busy, setBusy] = useState(false)
  const [site, setSite] = useState(SITES[0][1])
  const web = useRef<HTMLElement & { goBack(): void; goForward(): void; reload(): void; loadURL(url: string): void }>(null)

  const loadProfile = useCallback(async () => {
    if (!licensed) {
      setProfile(null)
      setCurrent({ skin: await api.skinFromUrl(STEVE).catch(() => undefined) })
      return
    }
    try {
      const p: SkinProfile = await api.skinProfile()
      setProfile(p)
      const activeCape = p.capes.find((c) => c.active)
      const [skin, cape] = await Promise.all([
        p.skinUrl ? api.skinFromUrl(p.skinUrl).catch(() => undefined) : undefined,
        activeCape ? api.skinFromUrl(activeCape.url).catch(() => undefined) : undefined
      ])
      setCurrent({ skin, cape })
      void api.getAccounts().then(setAccounts)
    } catch (e) {
      toast('error', errorText(e))
    }
  }, [licensed, setAccounts, toast])

  useEffect(() => {
    void loadProfile()
    void api.skinLibrary().then(setLibrary)
  }, [loadProfile])

  useEffect(
    () =>
      onEvent<{ name: string; data?: string; error?: string }>('skins:found', (found) => {
        if (found.error || !found.data) {
          toast('warn', found.error ?? 'Это не скин')
          return
        }
        const data = found.data
        void guessVariant(data).then((variant) => setCandidate({ name: found.name, data, variant, source: 'Из браузера' }))
      }),
    [toast]
  )

  const run = (fn: () => Promise<unknown>, done?: string): void => {
    setBusy(true)
    fn()
      .then(() => done && toast('info', done))
      .catch((e) => toast('error', errorText(e)))
      .finally(() => setBusy(false))
  }

  const apply = (data: string, variant: Variant): void =>
    run(async () => {
      const p: SkinProfile = await api.uploadSkin(data, variant)
      setProfile(p)
      setCurrent((c) => ({ ...c, skin: data }))
      setCandidate(null)
      void api.getAccounts().then(setAccounts)
    }, 'Скин поставлен. В игре он появится при следующем входе на сервер')

  const save = (c: Candidate): void =>
    run(async () => {
      setLibrary(await api.saveSkin(c.name, c.data, c.variant))
    }, 'Скин сохранён в библиотеку')

  const shown = candidate ? { skin: candidate.data, cape: current.cape, variant: candidate.variant } : { ...current, variant: profile?.variant ?? 'classic' }

  return (
    <div className="welcome">
      <div className="welcome-inner skins-page">
        <h1 className="wm rise">Скины<span>.</span></h1>
        <p className="hero-sub rise" style={rise(1)}>
          {licensed ? 'Скин и плащ меняются прямо здесь. Скины из браузера ниже ставятся в один клик.' : 'Смена скина доступна с лицензией Minecraft. Библиотека и браузер скинов работают всем.'}
        </p>

        <div className="skins-top rise" style={rise(2)}>
          <div className="skin-stage">
            <Preview skin={shown.skin} cape={shown.cape} variant={shown.variant as Variant} walking={walking} />
            <button className="ghost-btn skin-walk" onClick={() => setWalking(!walking)}>{walking ? 'Стоять' : 'Идти'}</button>
          </div>
          <div className="skin-side">
            {candidate ? (
              <div className="skin-candidate">
                <span className="field-label">{candidate.source}</span>
                <b>{candidate.name}</b>
                <Seg value={candidate.variant} options={[['classic', 'Обычные руки'], ['slim', 'Тонкие руки']]} onChange={(variant) => setCandidate({ ...candidate, variant })} />
                <div className="row">
                  {licensed && <button className="btn primary" disabled={busy} onClick={() => apply(candidate.data, candidate.variant)}><I.check size={14} /> Поставить</button>}
                  <button className="btn" disabled={busy} onClick={() => save(candidate)}><I.download size={14} /> В библиотеку</button>
                  <button className="btn" onClick={() => setCandidate(null)}>Отмена</button>
                </div>
              </div>
            ) : (
              <div className="skin-candidate">
                <span className="field-label">Сейчас</span>
                <b>{profile?.name ?? account?.name ?? 'Нет аккаунта'}</b>
                <small className="muted">{licensed ? (profile?.variant === 'slim' ? 'Тонкие руки' : 'Обычные руки') : 'Офлайн-профиль'}</small>
                <div className="row">
                  <button
                    className="btn"
                    onClick={() => {
                      void api.pickSkinFile().then(async (file: { name: string; data: string } | null) => {
                        if (file) setCandidate({ ...file, variant: await guessVariant(file.data), source: 'Из файла' })
                      })
                    }}
                  >
                    <I.upload size={14} /> Загрузить PNG
                  </button>
                  {licensed && <button className="btn" disabled={busy} onClick={() => run(async () => { setProfile(await api.resetSkin()); await loadProfile() }, 'Скин сброшен')}>Сбросить</button>}
                </div>
              </div>
            )}

            {licensed && profile && profile.capes.length > 0 && (
              <div className="skin-capes">
                <span className="field-label">Плащ</span>
                <div className="cape-row">
                  <button className={`cape ${profile.capes.every((c) => !c.active) ? 'on' : ''}`} disabled={busy} onClick={() => run(async () => { setProfile(await api.setCape(null)); setCurrent((c) => ({ ...c, cape: undefined })) })}>Без плаща</button>
                  {profile.capes.map((c) => (
                    <button key={c.id} className={`cape ${c.active ? 'on' : ''}`} disabled={busy} onClick={() => run(async () => { setProfile(await api.setCape(c.id)); setCurrent((x) => ({ ...x })); await loadProfile() })}>{c.alias}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="skin-library">
              <span className="field-label">Библиотека</span>
              {library.length === 0 && <small className="muted">Сохраняйте сюда скины из файлов и браузера</small>}
              <div className="skin-grid">
                {library.map((s) => (
                  <div key={s.id} className="skin-tile" onClick={() => setCandidate({ name: s.name, data: s.data, variant: s.variant, source: 'Из библиотеки' })}>
                    <span className="skin-head" style={{ backgroundImage: `url(${s.data})` }} />
                    <small>{s.name}</small>
                    <button className="tile-x" title="Удалить" onClick={(e) => { e.stopPropagation(); void api.removeSkin(s.id).then(setLibrary) }}><I.close size={11} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <h3 className="rise" style={rise(3)}>Браузер скинов</h3>
        <div className="skin-browser rise" style={rise(3)}>
          <div className="skin-bar">
            <button className="icon-btn" title="Назад" onClick={() => web.current?.goBack()}><I.chevron size={14} style={{ transform: 'scaleX(-1)' }} /></button>
            <button className="icon-btn" title="Вперёд" onClick={() => web.current?.goForward()}><I.chevron size={14} /></button>
            <button className="icon-btn" title="Обновить" onClick={() => web.current?.reload()}><I.refresh size={14} /></button>
            {SITES.map(([name, url]) => (
              <button key={url} className={`ghost-btn ${site === url ? 'on' : ''}`} onClick={() => { setSite(url); web.current?.loadURL(url) }}>{name}</button>
            ))}
            <span className="grow" />
            <small className="muted">Нажмите «Скачать» на странице скина</small>
          </div>
          <webview ref={web} src={SITES[0][1]} partition="persist:skins" className="skin-web" />
        </div>
      </div>
    </div>
  )
}
