const timers = new Map()
const INTERVALS = [30, 60, 90, 120]

exports.activate = (hesperian) => {
  const minutes = () => hesperian.storage.get('minutes') ?? 60

  hesperian.on('launch', (instance) => {
    clearInterval(timers.get(instance.id))
    let hours = 0
    timers.set(instance.id, setInterval(() => {
      hours += minutes() / 60
      hesperian.notify(`Вы играете в ${instance.name} уже ${hours % 1 ? hours.toFixed(1) : hours} ч. Самое время размяться`, 'warn')
    }, minutes() * 60 * 1000))
  })

  hesperian.on('exit', (instance) => {
    clearInterval(timers.get(instance.id))
    timers.delete(instance.id)
  })

  hesperian.commands.register('interval', 'Напоминание о перерыве: сменить интервал', () => {
    const next = INTERVALS[(INTERVALS.indexOf(minutes()) + 1) % INTERVALS.length]
    hesperian.storage.set('minutes', next)
    hesperian.notify(`Теперь напоминание каждые ${next} мин`)
  })
}

exports.deactivate = () => {
  for (const t of timers.values()) clearInterval(t)
  timers.clear()
}
