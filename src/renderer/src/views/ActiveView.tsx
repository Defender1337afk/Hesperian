import type { ReactNode } from 'react'
import { useStore } from '../store'
import { InstanceView } from './InstanceView'
import { ServersView } from './ServersView'
import { SkinsView } from './SkinsView'
import { ProjectView } from './ProjectView'
import { SettingsView } from './SettingsView'
import { Welcome } from './Welcome'
import { NewHome } from './NewHome'
import { isBloom } from '../themes'

export function ActiveView(): ReactNode {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const bloom = useStore((s) => isBloom(s.settings?.theme))
  const home = bloom ? <NewHome /> : <Welcome />
  if (!tab) return home
  switch (tab.kind) {
    case 'welcome':
      return home
    case 'instance':
      return <InstanceView key={tab.ref} instanceId={tab.ref!} />
    case 'project':
      return <ProjectView key={tab.ref} projectId={tab.ref!} />
    case 'settings':
      return <SettingsView />
    case 'servers':
      return <ServersView />
    case 'skins':
      return <SkinsView />
  }
}
