export interface ReleaseInfo {
  version: string
  codename: string
  status: 'released' | 'current' | 'next' | 'future'
  summary: string
}

export const ROADMAP: ReleaseInfo[] = [
  { version: '1.1', codename: 'Grove', status: 'released', summary: 'Магазин Modrinth, Big Picture, тема «Кристалл», бэкапы миров' },
  {
    version: '1.2',
    codename: 'Cursed',
    status: 'current',
    summary: 'Плагины, локальные серверы в один клик, режим для слабых ПК, Astra Visuals 1.2 с системными стилями меню, модпаки, обновления модов, Linux'
  },
  { version: '1.3', codename: 'Storm', status: 'next', summary: 'Вход через Microsoft из коробки, магазин плагинов, синхронизация настроек' }
]

export const CURRENT = ROADMAP.find((r) => r.status === 'current')!

export const releaseName = (): string => `Hesperian ${CURRENT.version} ${CURRENT.codename}`

export const WHATS_NEW: { title: string; text: string }[] = [
  { title: 'Локальные серверы', text: 'Свой сервер в один клик: друзья заходят по IP из Radmin VPN или локальной сети. Серверы друзей добавляются по адресу, и игра сразу подключается к ним.' },
  { title: 'Плагины', text: 'Свои команды, действия перед запуском и после выхода, аргументы JVM. Готовые плагины: статистика игры, напоминание о перерыве, бэкап миров.' },
  { title: 'Режим для слабых ПК', text: 'Лаунчер выгружается на время игры, Java получает подобранную память и лёгкие флаги, а кнопка «Ускорить сборку» ставит Sodium, Lithium и другие моды.' },
  { title: 'Astra Visuals 1.2', text: 'Главное меню как в GNOME, Windows 11 и macOS: меню, пункт управления, «Пуск» с поиском, календарь, громкость, серверы, недавние миры.' },
  { title: 'Модпаки и обновления', text: 'Каталог модпаков Modrinth, импорт и экспорт .mrpack, обновления модов одной кнопкой, наши моды обновляются сами.' },
  { title: 'Новый вид', text: 'Интерфейс посвежел, а у выпусков появились кодовые имена: это 1.2 Cursed, следом 1.3 Storm.' }
]
