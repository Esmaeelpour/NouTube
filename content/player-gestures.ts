import { isFullscreen } from './fullscreen-controls'
import { emit } from './utils'

/* Drag the player down to drop it into the mini player, the way the app does.
 *
 * Only a gesture the page cannot already do: double-tap-to-seek and the drag on
 * the progress bar stay YouTube's, and nothing here runs in fullscreen.
 */

const CLAIM_PX = 16
// Far enough that a stray drag is not mistaken for the gesture.
const MINIMIZE_PX = 72

let startX = 0
let startY = 0
let armed = false
let claimed = false

const inPlayer = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('#movie_player, #player-container-id'))

/* The progress bar and the buttons keep their own drags, and so do our own
 * overlays. */
const onControl = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'input, button, a, [role="button"], [role="slider"], .ytPlayerProgressBarHost, .ytp-progress-bar-container,' +
        '#_nou_fs_panel, #_nou_fs_btn, #_nou_fs_scrim, #_nou_lock_overlay',
    ),
  )

export function installPlayerGestures() {
  if (!window.isAndroid) {
    return
  }
  const root = window as Window & typeof globalThis & { __nouPlayerGesturesInit?: boolean }
  if (root.__nouPlayerGesturesInit) {
    return
  }
  root.__nouPlayerGesturesInit = true

  document.addEventListener(
    'touchstart',
    (event) => {
      armed = false
      claimed = false
      if (event.touches.length !== 1 || isFullscreen() || !inPlayer(event.target) || onControl(event.target)) {
        return
      }
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      armed = true
    },
    // Not passive: the browser waits for a non-passive listener before deciding
    // the touch is a scroll.
    { passive: false, capture: true },
  )

  document.addEventListener(
    'touchmove',
    (event) => {
      if (!armed || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      // Upwards is the page scrolling and sideways is YouTube seeking; only
      // downwards is ours.
      if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
        armed = false
        return
      }
      // Claimed from the first millimetre rather than after a threshold: the
      // page scrolls the moment the browser decides the touch is a scroll, and
      // once it has, the touch is cancelled and never comes back. A drag down
      // the player is never a scroll here, the same as in the app.
      event.preventDefault()
      if (dy >= CLAIM_PX) {
        claimed = true
      }
    },
    { passive: false, capture: true },
  )

  const end = (event: TouchEvent) => {
    if (claimed) {
      const dy = (event.changedTouches[0]?.clientY ?? startY) - startY
      if (dy > MINIMIZE_PX) {
        emit('minimize-player')
      }
    }
    armed = false
    claimed = false
  }

  document.addEventListener('touchend', end, { capture: true })
  document.addEventListener('touchcancel', end, { capture: true })
}
