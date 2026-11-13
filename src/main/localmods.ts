import { app } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentUpdate, StoreHit, StoreProject, StoreVersion } from '../shared/types'
import { contentDir, forgetContent, readContentMeta, recordContent, setContentEnabled } from './content'
import { getInstance } from './instances'

interface LocalMod {
  id: string
  title: string
  version: string
  gameVersion: string
  loader: 'fabric'
  description: string
  body: string
  icon: string
  gallery: { url: string; title: string }[]
  filePattern: RegExp
  categories: string[]
}

export const AUTHOR = 'Defender1337afk'
export const AUTHOR_QUERY = 'defender'

const ASTRA_BODY = `Визуальный клиент для Minecraft 1.21.11: эффекты и удобства только у вас на экране, без преимущества над другими игроками.

## Новое в 1.2

Главное меню теперь бывает пяти видов: обычное Minecraft, фирменное Astra, GNOME (Fedora), Windows 11 и macOS Tahoe. У каждого свои обои, док или панель задач, меню «Пуск», виджеты и рабочие кнопки. Стиль меняется вверху главного экрана или в настройках сборки в лаунчере. Мод теперь работает и на Linux.

## Меню

Окно в стиле liquid glass открывается на **Right Shift**: настоящее преломление и размытие того, что за ним, упругие анимации и настройка стекла под себя.

## Мир

- Созвездия: линии летят от точки к точке по небу, а старые стираются следом
- Своё время суток и цвет неба, цветной туман, свечение
- Снег, лепестки или светлячки вокруг вас
- Браузер в мире: окно с управлением прицелом и вводом текста
- Свободная камера, панели брони, эффектов, инвентаря и цели
- Кубический мини-питомец Тилкайо и четыре модели меча
- Таргет ESP и перенос элементов HUD прямо в чате
- Наборы визуалов одной кнопкой и цифры урона
- Меню на русском и английском
- Главное меню в пяти стилях на выбор: Minecraft, Astra (чёрно-белое, часы из жидкого стекла), GNOME в духе Fedora, Windows 11 с меню «Пуск» и macOS Tahoe с доком и виджетами. Переключатель вверху экрана
- Переключатель аккаунтов, свой логотип, заставка и имя окна
- Северное сияние и падающие звёзды
- Лучи солнца, своя погода, кинорежим, наклон камеры
- Цветокоррекция, размытие движения, контур блока и заливка жидким металлом

## Игрок

- Шейдер рук: неон, радуга, хром, голограмма, стекло, жидкий металл
- Анимации удара без просадки руки, размер и положение рук
- Объёмные нимб, крылья и кольцо планеты, шляпа и плащ, которые видны только вам

## Частицы

След за игроком, круги прыжка, которые ложатся на блоки, спутники и аура вокруг вас, светящиеся следы, метка цели, звёзды, сердечки и искры при ударе, эффект убийства.

## Интерфейс

Стеклянный HUD и хотбар, компас, свой прицел, отметка удара, клавиши с кликами в секунду, уведомления.

## Инструменты

Авто-спринт, залипание присяда, зум, авто-возрождение, точка смерти, экономия кадров в фоне и манекен для тренировки ударов, который существует только у вас на клиенте и ничего не отправляет на сервер.

Читов здесь нет и не будет: ни атаки за вас, ни просмотра сквозь стены.`

const MODS: LocalMod[] = [
  {
    id: 'astra-visuals',
    title: 'Astra Visuals',
    version: '1.2.2',
    gameVersion: '1.21.11',
    loader: 'fabric',
    description: 'Главное меню в стиле GNOME, Windows 11 или macOS, liquid glass, созвездия, шейдер рук',
    body: ASTRA_BODY,
    icon: 'astra/icon.png',
    gallery: [
      { url: 'astra/menu.jpg', title: 'Меню поверх мира' },
      { url: 'astra/stars.jpg', title: 'Созвездия в небе' },
      { url: 'astra/hands.jpg', title: 'Объёмные крылья и нимб' }
    ],
    filePattern: /^astra-visuals-.*\.jar(\.disabled)?$/,
    categories: ['decoration']
  }
]

const find = (id: string): LocalMod | undefined => MODS.find((m) => m.id === id)

export const isLocalMod = (id: string): boolean => Boolean(find(id))

const jarName = (mod: LocalMod): string => `${mod.id}-${mod.version}.jar`

const bundledJar = (mod: LocalMod): string =>
  app.isPackaged ? join(process.resourcesPath, 'mods', jarName(mod)) : join(app.getAppPath(), 'resources', 'mods', jarName(mod))

export function localHits(query: string): StoreHit[] {
  if (!query.toLowerCase().includes(AUTHOR_QUERY)) return []
  return MODS.map((m) => ({
    id: m.id,
    slug: m.id,
    title: m.title,
    description: m.description,
    author: AUTHOR,
    iconUrl: m.icon,
    downloads: 0,
    follows: 0,
    categories: m.categories,
    local: true,
    gameVersion: m.gameVersion
  }))
}

export function localProject(id: string): StoreProject {
  const mod = find(id)!
  return {
    id: mod.id,
    slug: mod.id,
    kind: 'mod',
    title: mod.title,
    description: mod.description,
    body: mod.body,
    iconUrl: mod.icon,
    downloads: 0,
    follows: 0,
    gallery: mod.gallery,
    updatedAt: new Date().toISOString(),
    local: true
  }
}

export function localVersions(id: string, gameVersion?: string, loader?: string): StoreVersion[] {
  const mod = find(id)!
  if ((gameVersion && gameVersion !== mod.gameVersion) || (loader && loader !== mod.loader)) return []
  return [
    {
      id: mod.version,
      name: `${mod.title} ${mod.version}`,
      versionNumber: mod.version,
      gameVersions: [mod.gameVersion],
      loaders: [mod.loader],
      type: 'release',
      publishedAt: new Date().toISOString(),
      downloads: 0
    }
  ]
}

export function assertLocalFits(instanceId: string, id: string): void {
  const mod = find(id)!
  const instance = getInstance(instanceId)
  if (instance.mcVersion !== mod.gameVersion || instance.loader !== mod.loader) {
    throw new Error(`${mod.title} работает на Minecraft ${mod.gameVersion} с Fabric.`)
  }
}

export async function installLocal(instanceId: string, id: string): Promise<string> {
  const mod = find(id)!
  assertLocalFits(instanceId, id)
  const source = bundledJar(mod)
  if (!existsSync(source)) throw new Error(`В этой сборке лаунчера нет файла ${mod.title}.`)
  const dir = contentDir(getInstance(instanceId), 'mod')
  await mkdir(dir, { recursive: true })
  const old = (await readdir(dir)).filter((file) => mod.filePattern.test(file))
  const wasDisabled = old.length > 0 && old.every((file) => file.endsWith('.disabled'))
  for (const file of old) {
    await rm(join(dir, file), { force: true })
    forgetContent(instanceId, file.replace(/\.disabled$/, ''))
  }
  for (const file of Object.keys(readContentMeta(instanceId))) {
    if (mod.filePattern.test(file) && file !== jarName(mod)) forgetContent(instanceId, file)
  }
  await copyFile(source, join(dir, jarName(mod)))
  recordContent(instanceId, jarName(mod), {
    title: mod.title,
    iconUrl: mod.icon,
    projectId: mod.id,
    versionId: mod.version,
    versionNumber: mod.version
  })
  if (wasDisabled) await setContentEnabled(instanceId, 'mod', jarName(mod), false)
  return mod.title
}

function newer(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  }
  return false
}

export async function localUpdates(instanceId: string): Promise<ContentUpdate[]> {
  const instance = getInstance(instanceId)
  const dir = contentDir(instance, 'mod')
  if (!existsSync(dir)) return []
  const files = await readdir(dir)
  const found: ContentUpdate[] = []
  for (const mod of MODS) {
    if (instance.mcVersion !== mod.gameVersion || instance.loader !== mod.loader || !existsSync(bundledJar(mod))) continue
    for (const entry of files.filter((f) => mod.filePattern.test(f))) {
      const file = entry.replace(/\.disabled$/, '')
      const version = /^[a-z-]+?-(\d[^/]*)\.jar$/.exec(file)?.[1] ?? '0'
      if (!newer(mod.version, version)) continue
      found.push({
        kind: 'mod',
        file,
        title: mod.title,
        iconUrl: mod.icon,
        projectId: mod.id,
        fromVersion: version,
        toVersionId: mod.version,
        toVersionNumber: mod.version
      })
      break
    }
  }
  return found
}

export async function updateLocalMods(instanceId: string): Promise<string[]> {
  const updated: string[] = []
  for (const update of await localUpdates(instanceId)) {
    await installLocal(instanceId, update.projectId)
    updated.push(`${update.title} ${update.fromVersion} → ${update.toVersionNumber}`)
  }
  return updated
}

export const LOCAL_MOD_FILES = MODS.map((m) => ({ id: m.id, version: m.version }))
