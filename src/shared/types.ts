export type LoaderType = 'vanilla' | 'fabric' | 'forge' | 'neoforge'
export type ContentKind = 'mod' | 'resourcepack' | 'shader'
export type StoreKind = ContentKind | 'modpack'
export type VersionType = 'release' | 'snapshot'

export interface McVersion {
  id: string
  type: VersionType
  releaseTime: string
}

export interface LoaderVersion {
  version: string
  tag?: 'recommended' | 'latest'
}

export interface Instance {
  id: string
  name: string
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  engine?: 'horizon'
  color: string
  group?: string
  notes?: string
  memoryMb?: number
  jvmArgs?: string
  javaPath?: string
  width?: number
  height?: number
  modpack?: ModpackInfo
  createdAt: number
  lastPlayedAt?: number
  playTimeSec: number
}

export interface ModpackInfo {
  title: string
  versionNumber: string
  projectId?: string
  versionId?: string
  iconUrl?: string
}

export type NewInstance = Pick<Instance, 'name' | 'mcVersion' | 'loader' | 'loaderVersion' | 'engine' | 'color' | 'group'>

export interface Account {
  id: string
  kind: 'microsoft' | 'offline'
  name: string
  uuid: string
  skinUrl?: string
  licensed: boolean
}

export interface AccountsState {
  accounts: Account[]
  activeId: string | null
}

export type MsLoginEvent =
  | { state: 'code'; userCode: string; verificationUri: string }
  | { state: 'working'; message: string }
  | { state: 'done'; account: Account }
  | { state: 'error'; message: string }
  | { state: 'cancelled' }

export interface Settings {
  theme: string
  accentHue: number
  density: 'compact' | 'comfortable' | 'spacious'
  radius: number
  uiSize: number
  animations: boolean
  sidebarWidth: number
  panelHeight: number
  backgroundImage: string
  backgroundOpacity: number
  customCss: string
  defaultMemoryMb: number
  defaultJvmArgs: string
  defaultWidth: number
  defaultHeight: number
  afterLaunch: 'keep' | 'hide' | 'unload'
  lowEnd: boolean
  openPanelOnLaunch: boolean
  dataDir: string
  msClientId: string
  bigPictureBackground: 'panorama' | 'lines'
  bigPictureOnStart: boolean
  windowBounds?: { x: number; y: number; width: number; height: number }
  windowMaximized?: boolean
  seenRelease?: string
}

export interface TaskState {
  id: string
  title: string
  detail: string
  done: number
  total: number
  state: 'running' | 'done' | 'error'
  error?: string
}

export interface LogLine {
  instanceId: string
  text: string
  level: 'info' | 'warn' | 'error' | 'debug'
}

export interface GameState {
  instanceId: string
  state: 'launching' | 'running' | 'stopped'
  exitCode?: number | null
}

export interface ContentItem {
  file: string
  enabled: boolean
  size: number
  title: string
  iconUrl?: string
  projectId?: string
  versionId?: string
  versionNumber?: string
}

export interface StoreQuery {
  kind: StoreKind
  query: string
  sort: 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated'
  gameVersions: string[]
  loader?: 'fabric' | 'forge' | 'neoforge'
  offset: number
}

export interface StoreHit {
  id: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl?: string
  downloads: number
  follows: number
  categories: string[]
  local?: boolean
  gameVersion?: string
}

export interface StoreResult {
  hits: StoreHit[]
  total: number
  offset: number
  limit: number
}

export interface StoreProject {
  id: string
  slug: string
  kind: StoreKind
  title: string
  description: string
  body: string
  iconUrl?: string
  downloads: number
  follows: number
  license?: string
  sourceUrl?: string
  issuesUrl?: string
  wikiUrl?: string
  gallery: { url: string; title?: string }[]
  updatedAt: string
  local?: boolean
}

export interface StoreVersion {
  id: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  type: string
  publishedAt: string
  downloads: number
}

export interface SystemInfo {
  totalMemoryMb: number
  platform: string
  dataDir: string
  appVersion: string
}

export interface ContentUpdate {
  kind: ContentKind
  file: string
  title: string
  iconUrl?: string
  projectId: string
  fromVersion?: string
  toVersionId: string
  toVersionNumber: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  error?: string
  folder: string
  commands: { id: string; title: string }[]
  hooks: number
}

export interface PluginLogLine {
  pluginId: string
  text: string
  level: 'info' | 'warn' | 'error'
  at: number
}

export interface AstraHome {
  installed: boolean
  style: number
}

export interface ServerStatus {
  state: 'stopped' | 'starting' | 'running'
  players: string[]
  startedAt?: number
}

export interface LocalServer {
  id: string
  name: string
  mcVersion: string
  loader: 'vanilla' | 'fabric'
  port: number
  maxPlayers: number
  motd: string
  onlineMode: boolean
  gamemode: 'survival' | 'creative' | 'adventure'
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard'
  pvp: boolean
  memoryMb: number
  createdAt: number
  status: ServerStatus
}

export interface FriendServer {
  id: string
  name: string
  address: string
  addedAt: number
}

export interface ServerAddress {
  ip: string
  iface: string
  kind: 'radmin' | 'hamachi' | 'zerotier' | 'lan' | 'other'
}

export interface ServerPing {
  online: boolean
  latencyMs?: number
  version?: string
  players?: number
  maxPlayers?: number
  motd?: string
  error?: string
}

export interface SkinProfile {
  name: string
  skinUrl?: string
  variant: 'classic' | 'slim'
  capes: { id: string; alias: string; url: string; active: boolean }[]
}

export interface SkinLibraryItem {
  id: string
  name: string
  variant: 'classic' | 'slim'
  addedAt: number
  data: string
}
