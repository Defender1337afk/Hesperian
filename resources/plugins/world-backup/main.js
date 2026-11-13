const DAY = 24 * 60 * 60 * 1000

exports.activate = (hesperian) => {
  hesperian.on('launch', async (instance) => {
    const worlds = await hesperian.worlds.list(instance.id)
    let saved = 0
    for (const world of worlds) {
      const last = Math.max(0, ...world.backups.map((b) => b.createdAt))
      if (Date.now() - last < DAY || world.modifiedAt < last) continue
      await hesperian.worlds.backup(instance.id, world.name)
      saved++
    }
    if (saved) hesperian.notify(`Сохранены копии миров: ${saved}`)
  })

  hesperian.commands.register('now', 'Бэкап миров: сохранить все миры выбранных сборок сейчас', async () => {
    let saved = 0
    for (const instance of await hesperian.instances.list()) {
      for (const world of await hesperian.worlds.list(instance.id)) {
        await hesperian.worlds.backup(instance.id, world.name)
        saved++
      }
    }
    hesperian.notify(saved ? `Сохранены копии миров: ${saved}` : 'Миров пока нет')
  })
}
