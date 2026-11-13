const fmt = (sec) => {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} ч ${m} мин` : `${m} мин`
}

exports.activate = (hesperian) => {
  hesperian.on('exit', (instance, { playedSec }) => {
    const totals = hesperian.storage.get('totals') ?? {}
    totals[instance.id] = { name: instance.name, sec: (totals[instance.id]?.sec ?? 0) + playedSec }
    hesperian.storage.set('totals', totals)
    hesperian.storage.set('sessions', (hesperian.storage.get('sessions') ?? 0) + 1)
    hesperian.notify(`${instance.name}: сессия ${fmt(playedSec)}, всего ${fmt(totals[instance.id].sec)}`)
  })

  hesperian.commands.register('top', 'Статистика игры: самые любимые сборки', () => {
    const totals = Object.values(hesperian.storage.get('totals') ?? {}).sort((a, b) => b.sec - a.sec)
    if (!totals.length) return hesperian.notify('Пока нет ни одной сессии')
    hesperian.notify(totals.slice(0, 3).map((t, i) => `${i + 1}. ${t.name}: ${fmt(t.sec)}`).join(' · '))
  })
}
