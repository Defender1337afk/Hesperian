import type { ReactNode } from 'react'
import { useStore } from '../store'
import { InstanceView } from './InstanceView'
import { PluginsView } from './PluginsView'
import { ServersView } from './ServersView'
import { ProjectView } from './ProjectView'
import { SettingsView } from './SettingsView'
import { Welcome } from './Welcome'

export function ActiveView(): ReactNode {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  if (!tab) return <Welcome />
  switch (tab.kind) {
    case 'welcome':
      return <Welcome />
    case 'instance':
      return <InstanceView key={tab.ref} instanceId={tab.ref!} />
    case 'project':
      return <ProjectView key={tab.ref} projectId={tab.ref!} />
    case 'settings':
      return <SettingsView />
    case 'plugins':
      return <PluginsView />
    case 'servers':
      return <ServersView />
  }
}
