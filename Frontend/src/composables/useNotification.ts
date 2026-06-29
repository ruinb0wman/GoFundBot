export function useNotification() {
  const supported = 'Notification' in window

  async function requestPermission(): Promise<boolean> {
    if (!supported) return false
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false
    const result = await Notification.requestPermission()
    return result === 'granted'
  }

  function notify(title: string, options?: NotificationOptions): void {
    if (!supported || Notification.permission !== 'granted') return
    new Notification(title, options)
  }

  function notifyAlert(fundName: string, alertType: string, value: string): void {
    const labels: Record<string, string> = {
      price_up: '涨超提醒',
      price_down: '跌超提醒',
      return_above: '收益提醒',
      return_below: '收益预警',
    }
    notify(`${fundName} - ${labels[alertType] || alertType}`, {
      body: `当前值: ${value}`,
      icon: '/favicon.ico',
      tag: `alert-${fundName}-${alertType}`,
    })
  }

  return { supported, requestPermission, notify, notifyAlert }
}
