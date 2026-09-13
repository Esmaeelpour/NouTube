import { settleViewportLayout } from './utils'

const styleId = '_nou_pip'
const ancestorClass = '_nou_pip_ancestor'
let transition = 0
let outerDimensions: Map<string, PropertyDescriptor | undefined> | undefined
let ancestorObserver: MutationObserver | undefined
let remarkTimer: ReturnType<typeof setTimeout> | undefined

// Everything but the video and the chain it hangs from is hidden while pinned,
// and that chain is marked by hand. The next video -- autoplay, the queue, or
// one opened from the app -- arrives through YouTube's router rather than as a
// new document, so the style survives it while the marks do not: the new
// player would be built inside a display:none ancestor, where it neither
// renders nor starts. Re-mark whatever the page is playing now instead.
// The page's own player, not whatever <video> happens to come first in the
// document. A watch page carries more than one: the related videos and the
// feed underneath bring their own preview elements, and picking one of those
// is how a floating window ends up playing a video the user was not watching,
// with the real player hidden behind the marks it never got.
function getPlayerVideo(): HTMLVideoElement | null {
  const inPlayer = document.querySelector('#movie_player video')
  if (inPlayer instanceof HTMLVideoElement && inPlayer.videoWidth > 0) {
    return inPlayer
  }
  const videos = Array.from(document.querySelectorAll('video')).filter(
    (video): video is HTMLVideoElement => video instanceof HTMLVideoElement && video.videoWidth > 0,
  )
  // Failing that, the one actually playing, and failing that the first real one.
  return videos.find((video) => !video.paused) ?? videos[0] ?? null
}

function markVideoAncestors() {
  const video = getPlayerVideo()
  const wanted = new Set<Element>()
  for (let parent = video?.parentElement; parent; parent = parent.parentElement) {
    wanted.add(parent)
  }
  for (const marked of document.querySelectorAll('.' + ancestorClass)) {
    if (!wanted.has(marked)) {
      marked.classList.remove(ancestorClass)
    }
  }
  for (const parent of wanted) {
    parent.classList.add(ancestorClass)
  }
}

// The marks are class changes on the very nodes being watched, so re-marking
// feeds the observer its own work: coalesce into one pass per turn of events.
function scheduleRemark() {
  if (remarkTimer || !window.NouTubePip) {
    return
  }
  remarkTimer = setTimeout(() => {
    remarkTimer = undefined
    if (window.NouTubePip) {
      markVideoAncestors()
    }
  }, 200)
}

function watchVideoAncestors() {
  markVideoAncestors()
  window.addEventListener('yt-navigate-finish', scheduleRemark)
  ancestorObserver ||= new MutationObserver(scheduleRemark)
  ancestorObserver.observe(document.body, { childList: true, subtree: true })
}

function unwatchVideoAncestors() {
  clearTimeout(remarkTimer)
  remarkTimer = undefined
  window.removeEventListener('yt-navigate-finish', scheduleRemark)
  ancestorObserver?.disconnect()
}

// YouTube uses outer window area to detect background playback on Android.
// Keep that measurement stable during native PiP; innerWidth/innerHeight still
// describe the real viewport and size the video to the floating window.
export function preparePictureInPicture() {
  if (window.NouTubePip) return
  outerDimensions = new Map()
  for (const key of ['outerWidth', 'outerHeight'] as const) {
    outerDimensions.set(key, Object.getOwnPropertyDescriptor(window, key))
    const value = Math.max(window[key], key === 'outerWidth' ? screen.width : screen.height)
    Object.defineProperty(window, key, { configurable: true, get: () => value })
  }
  window.NouTubePip = true
}

export async function setPictureInPicture(active: boolean) {
  const currentTransition = ++transition
  if (!active) {
    const wasPlaying = !getPlayerVideo()?.paused
    window.NouTubePip = false
    unwatchVideoAncestors()
    document.getElementById(styleId)?.remove()
    document.querySelectorAll('.' + ancestorClass).forEach((element) => element.classList.remove(ancestorClass))
    // Android reports PiP exit before the expansion animation has finished.
    // Restore the outer measurements after the full-size viewport settles.
    await new Promise((resolve) => setTimeout(resolve, 500))
    if (currentTransition !== transition) return
    for (const [key, descriptor] of outerDimensions || []) {
      if (descriptor) Object.defineProperty(window, key, descriptor)
      else Reflect.deleteProperty(window, key)
    }
    outerDimensions = undefined
    // The window is still growing back out of the floating one, so the player
    // has to be told more than once (see settleViewportLayout).
    settleViewportLayout()
    if (wasPlaying) window.NouTube.play()
    return
  }

  preparePictureInPicture()
  if (document.fullscreenElement) await document.exitFullscreen()
  if (!window.NouTubePip) return
  document.getElementById(styleId)?.remove()
  watchVideoAncestors()
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `
    body *:not(._nou_pip_ancestor):not(video) { display: none !important; }
    ._nou_pip_ancestor {
      position: fixed !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      transform: none !important;
      overflow: visible !important;
    }
    html, body { background: black !important; }
    video {
      visibility: visible !important;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      object-fit: contain !important;
      transform: none !important;
      z-index: 2147483647 !important;
    }
  `
  document.head.appendChild(style)
  settleViewportLayout()
  window.NouTube.play()
}

const bridgeToken = () => window.NouTubeToken || ''
const SETTINGS_KEY = 'nou:settings'
let reported = ''

// Picture-in-Picture is an opt-in setting; reporting no video is what keeps the
// native side disarmed (see NouPictureInPicture.setVideo), so the switch lives
// here.
function isPictureInPictureEnabled(): boolean {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return settings.pictureInPicture === true
  } catch {
    return false
  }
}

// The native side enters Picture-in-Picture from onUserLeaveHint, which cannot
// wait for an answer from the page (the activity has paused by the time one
// arrives), so hand it the video it would show ahead of time instead. A zero
// size means there is nothing to show and PiP stays disarmed.
function reportPictureInPictureVideo() {
  const video = getPlayerVideo()
  const onVideoPage = !!document.fullscreenElement || document.location.pathname == '/watch'
  // In the split watch view the video belongs to the player webview. The
  // browsing one has the feed, whose previews play by themselves -- letting it
  // arm the floating window is the other way a pinned window ends up showing
  // something the user was not watching.
  const isBrowsingView = (window as any).NouTubeRole === 'browse'
  const showable =
    isPictureInPictureEnabled() &&
    !isBrowsingView &&
    onVideoPage &&
    video &&
    !video.paused &&
    !video.ended &&
    video.videoWidth > 0
  const size = showable ? [video.videoWidth, video.videoHeight] : [0, 0]
  const key = size.join('x')
  if (key == reported) {
    return
  }
  reported = key
  window.NouTubeI?.setPictureInPictureVideo?.(bridgeToken(), size[0], size[1])
}

export function watchPictureInPictureVideo() {
  if (!window.isAndroid || !window.NouTubeI?.setPictureInPictureVideo) {
    return
  }

  // Media events do not bubble, and YouTube swaps the video element around, so
  // listen for them on the way down instead of binding to one element.
  for (const type of ['play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata', 'resize']) {
    document.addEventListener(type, reportPictureInPictureVideo, true)
  }
  for (const type of ['yt-navigate-finish', 'fullscreenchange', 'popstate', 'noutube:settings']) {
    window.addEventListener(type, reportPictureInPictureVideo)
  }
  reportPictureInPictureVideo()
}
