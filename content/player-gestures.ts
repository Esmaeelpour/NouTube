import {
  getBrightnessPercent,
  getVolumePercent,
  isFullscreen,
  setBrightnessPercent,
  setVolumePercent,
} from './fullscreen-controls'
import { emit, nouPolicy } from './utils'

/* The gestures the native app has and the web player does not.
 *
 * Only ones the page cannot already do are added here, so nothing fights
 * YouTube's own handling: it owns double-tap-to-seek and the drag on the
 * progress bar, and it keeps them.
 *
 *   fullscreen, drag up/down on the left half   brightness
 *   fullscreen, drag up/down on the right half  volume
 *   watch page, drag down on the player         into the mini player
 *
 * A gesture is only claimed once the finger has clearly gone vertical, so a tap
 * still toggles the controls and a horizontal drag still seeks.
 */

const hudId = '_nou_gesture_hud'
const CLAIM_PX = 24
// The travel that takes a value from nothing to everything: a little over half
// the screen, which is what the phone's own volume gesture feels like.
const FULL_TRAVEL_RATIO = 0.6
const HUD_MS = 700

type Axis = 'brightness' | 'volume' | 'minimize'

let startX = 0
let startY = 0
let startValue = 0
let axis: Axis | undefined
let claimed = false
let hudTimer: ReturnType<typeof setTimeout> | undefined

const iconFor = (kind: Axis) =>
  kind === 'brightness'
    ? /* HTML */ `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path
          d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-1-6h2v3h-2V1zm0 19h2v3h-2v-3zM1 11h3v2H1v-2zm19 0h3v2h-3v-2zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4-2.1-2.1zM5.6 19.8l-1.4-1.4 2.1-2.1 1.4 1.4-2.1 2.1zM18.4 4.2l1.4 1.4-2.1 2.1-1.4-1.4 2.1-2.1z"
        ></path>
      </svg>`
    : /* HTML */ `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.06A4.5 4.5 0 0 0 16.5 12z"></path>
      </svg>`

/* One transient readout, in the middle of the screen, the way the phone's own
 * volume and brightness overlays do it. */
function showHud(kind: Axis, percent: number) {
  const host = isFullscreen() ? document.fullscreenElement : document.body
  if (!host) {
    return
  }
  let hud = document.getElementById(hudId)
  if (!hud || hud.parentElement !== host) {
    hud?.remove()
    hud = document.createElement('div')
    hud.id = hudId
    host.append(hud)
  }
  hud.innerHTML = nouPolicy.createHTML(
    /* HTML */ `${iconFor(kind)}
      <div class="_nou_gesture_track"><div class="_nou_gesture_fill" style="width:${percent}%"></div></div>
      <span>${percent}%</span>`,
  )
  hud.classList.add('show')
  clearTimeout(hudTimer)
  hudTimer = setTimeout(() => hud?.classList.remove('show'), HUD_MS)
}

const inPlayer = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('#movie_player, #player-container-id'))

/* The progress bar and the buttons keep their own drags. */
const onControl = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('input, button, a, [role="button"], [role="slider"], .ytPlayerProgressBarHost, .ytp-progress-bar-container'))

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
      axis = undefined
      claimed = false
      if (event.touches.length !== 1 || !inPlayer(event.target) || onControl(event.target)) {
        return
      }
      const touch = event.touches[0]
      startX = touch.clientX
      startY = touch.clientY
      if (isFullscreen()) {
        axis = startX < window.innerWidth / 2 ? 'brightness' : 'volume'
        startValue = axis === 'brightness' ? getBrightnessPercent() : (getVolumePercent() ?? -1)
        if (startValue < 0) {
          axis = undefined
        }
      } else {
        axis = 'minimize'
      }
    },
    { passive: true, capture: true },
  )

  document.addEventListener(
    'touchmove',
    (event) => {
      if (!axis || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!claimed) {
        // Vertical, and clearly so: anything else belongs to the page.
        if (Math.abs(dy) < CLAIM_PX || Math.abs(dy) < Math.abs(dx) * 1.5) {
          if (Math.abs(dx) >= CLAIM_PX) {
            axis = undefined
          }
          return
        }
        if (axis === 'minimize' && dy < 0) {
          // Only downwards minimises; an upward drag is the page scrolling.
          axis = undefined
          return
        }
        claimed = true
      }
      if (axis === 'minimize') {
        // Held until the finger lifts, so a change of mind can still scroll.
        event.preventDefault()
        return
      }
      // Up is more, and the travel is measured from where the finger went down.
      const travel = window.innerHeight * FULL_TRAVEL_RATIO
      const next = Math.min(100, Math.max(0, startValue - (dy / travel) * 100))
      const applied = axis === 'brightness' ? setBrightnessPercent(next) : setVolumePercent(next)
      if (applied !== undefined) {
        showHud(axis, applied)
      }
      event.preventDefault()
      event.stopPropagation()
    },
    { passive: false, capture: true },
  )

  const end = (event: TouchEvent) => {
    if (claimed && axis === 'minimize') {
      const dy = (event.changedTouches[0]?.clientY ?? startY) - startY
      // A short flick is enough; the app decides what "minimised" looks like.
      if (dy > CLAIM_PX * 3) {
        emit('minimize-player')
      }
    }
    axis = undefined
    claimed = false
  }

  document.addEventListener('touchend', end, { capture: true })
  document.addEventListener('touchcancel', end, { capture: true })
}
