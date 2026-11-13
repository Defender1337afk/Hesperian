import { getInstance } from './instances'
import { installFromStore } from './modrinth'

const PACKS: Record<string, { slug: string; title: string }[]> = {
  fabric: [
    { slug: 'sodium', title: 'Sodium' },
    { slug: 'lithium', title: 'Lithium' },
    { slug: 'ferrite-core', title: 'FerriteCore' },
    { slug: 'immediatelyfast', title: 'ImmediatelyFast' },
    { slug: 'entityculling', title: 'EntityCulling' },
    { slug: 'modernfix', title: 'ModernFix' }
  ],
  neoforge: [
    { slug: 'sodium', title: 'Sodium' },
    { slug: 'ferrite-core', title: 'FerriteCore' },
    { slug: 'immediatelyfast', title: 'ImmediatelyFast' },
    { slug: 'entityculling', title: 'EntityCulling' },
    { slug: 'modernfix', title: 'ModernFix' }
  ],
  forge: [
    { slug: 'embeddium', title: 'Embeddium' },
    { slug: 'ferrite-core', title: 'FerriteCore' },
    { slug: 'entityculling', title: 'EntityCulling' },
    { slug: 'modernfix', title: 'ModernFix' }
  ]
}

export async function optimizeInstance(id: string): Promise<{ installed: string[]; skipped: string[] }> {
  const instance = getInstance(id)
  const pack = PACKS[instance.loader]
  if (!pack) throw new Error('Моды производительности нужен загрузчик: Fabric, Forge или NeoForge')
  const installed: string[] = []
  const skipped: string[] = []
  for (const mod of pack) {
    try {
      await installFromStore(id, 'mod', mod.slug)
      installed.push(mod.title)
    } catch {
      skipped.push(mod.title)
    }
  }
  return { installed, skipped }
}
