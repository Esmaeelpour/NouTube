export function emit(type: string, data?: any) {
  if (window.NouTubeI) {
    window.NouTubeI.onMessage(JSON.stringify({ type, data }))
  } else if (window.electron) {
    window.electron.ipcRenderer.sendToHost(type, data)
  }
}

export function log(...data: any[]) {
  console.log(...data)
  emit('[content]', data.length > 1 ? { data: [...data] } : data[0])
}

export function parseJson(v: string | null, fallback: any) {
  if (!v) {
    return fallback
  }
  try {
    return JSON.parse(v)
  } catch (e) {
    return fallback
  }
}

export const nouPolicy = window.trustedTypes.createPolicy('nouPolicy', {
  createHTML: (x: string) => x,
})

export const isYTMusic = document.location.host == 'music.youtube.com'

let settleTimers: ReturnType<typeof setTimeout>[] = []

/**
 * Tell the page the window moved, and keep telling it for a moment.
 *
 * YouTube's player sizes its video in inline pixels and only recomputes them on
 * a resize. The box the page lives in is resized by the native shell on its own
 * schedule -- entering and leaving the mini player, entering and leaving a
 * floating window -- so a single event fired at the moment the app changes its
 * mind has the player measure the box it is about to stop having, and it then
 * keeps that size: a mini-width video in a full-width black player.
 */
export function settleViewportLayout() {
  for (const timer of settleTimers) {
    clearTimeout(timer)
  }
  const fire = () => {
    try {
      window.dispatchEvent(new Event('resize'))
    } catch {}
  }
  fire()
  settleTimers = [50, 150, 350, 700, 1200].map((delay) => setTimeout(fire, delay))
}
