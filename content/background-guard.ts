import { log } from './utils'

// YouTube stops background playback on purpose: mobile web pauses for
// non-premium users when it believes the page is hidden, and inactivity
// prompts ("Video paused. Continue watching?", ytmusic-you-there-renderer)
// pause after a few hours. The WebView reports itself as always visible, so
// the page can't tell it is backgrounded — but the native side can, and it
// mirrors the real app visibility into window.NouTubeBackground
// (NouTubeView.onWindowVisibilityChanged).
//
// While the app is in the background the user cannot reach the page, so a
// pause that was not commanded through NouTube.pause() (media notification,
// bluetooth, sleep timer) and is not an audio interruption (call, another
// app playing — NouTubeI.canAutoResume) can only come from YouTube itself:
// dismiss the prompt if one is shown and resume.

const PLAYING = 1
const PAUSED = 2
const BUFFERING = 3

// Attempts that are plain playVideo() calls before the seek nudge is brought
// in, and the point at which the guard stops fighting altogether.
const NUDGE_AFTER_ATTEMPTS = 2
const MAX_RESUME_ATTEMPTS = 5
// Ticks (5s each) a clock may stand still before playback counts as stalled.
const STALL_TICKS = 3

const bridgeToken = () => window.NouTubeToken || ''

let appPaused = false
let wasPlaying = false
let pausedByInterruption = false
let pausedTicks = 0
let resumeAttempts = 0
let stalledTicks = 0
let lastTime = -1

const isBackground = () => window.NouTubeBackground === true

function confirmYouThereDialogs() {
  // "Continue watching?" prompts. Only click when the dialog has exactly one
  // button, so a wrong guess is impossible; with more buttons playVideo()
  // below resumes playback just as well and YouTube drops the prompt itself.
  for (const selector of ['ytmusic-you-there-renderer', 'ytm-confirm-dialog-renderer']) {
    const dialog = document.querySelector(selector)
    if (!dialog) {
      continue
    }
    const buttons = dialog.querySelectorAll('button')
    if (buttons.length === 1) {
      ;(buttons[0] as HTMLElement).click()
      return true
    }
    // A dialog left in the DOM but not clickable must not hide the next one.
  }
  return false
}

const getTime = (player: any) => {
  const time = player.getCurrentTime?.()
  return typeof time == 'number' && Number.isFinite(time) ? time : -1
}

// A backgrounded renderer that stopped filling the media buffer leaves the
// player sitting on an empty one: it reports itself as playing (or buffering
// for good) while the clock stands still, and playVideo() on its own changes
// nothing because nothing is paused. Seeking is what re-primes the buffer --
// the same thing the user does by hand with the notification's rewind button --
// so the resume does that first once the plain attempts have not taken.
function nudgePlayback(player: any) {
  const time = getTime(player)
  if (time > 0) {
    player.seekTo?.(Math.max(0, time - 3), true)
  }
  player.playVideo?.()
}

export function installBackgroundGuard() {
  // Track pauses the app itself asked for (media notification, bluetooth,
  // sleep timer): those episodes are never fought, however long they last.
  const nouTube = window.NouTube as any
  if (nouTube && !nouTube.__nouGuardedPause) {
    const originalPause = nouTube.pause.bind(nouTube)
    const originalPlay = nouTube.play.bind(nouTube)
    nouTube.pause = () => {
      appPaused = true
      return originalPause()
    }
    nouTube.play = () => {
      appPaused = false
      return originalPlay()
    }
    nouTube.__nouGuardedPause = true
  }

  // A pause from YouTube's own controls bypasses NouTube.pause(). Record it
  // synchronously while the app is visible so immediately backgrounding the
  // app cannot race the polling loop below and restart user-paused playback.
  document.addEventListener(
    'pause',
    (event) => {
      const player = document.getElementById('movie_player')
      if (!isBackground() && event.target instanceof Node && player?.contains(event.target)) {
        appPaused = true
      }
    },
    true,
  )

  // Playback that starts right before the app is backgrounded would otherwise
  // not be seen by the poll below at all, and a YouTube pause in that window
  // would look like a video that was never playing.
  for (const type of ['play', 'playing']) {
    document.addEventListener(
      type,
      (event) => {
        const player = document.getElementById('movie_player')
        if (event.target instanceof Node && player?.contains(event.target)) {
          appPaused = false
          wasPlaying = true
        }
      },
      true,
    )
  }

  setInterval(() => {
    const player = document.getElementById('movie_player') as any
    if (!player?.getPlayerState) {
      return
    }

    const state = player.getPlayerState()
    // Progress, not the reported state, is what says playback is healthy: a
    // stalled player goes on calling itself PLAYING with the clock frozen.
    const time = getTime(player)
    const advancing = time < 0 || time !== lastTime
    lastTime = time

    if (advancing && (state === PLAYING || state === BUFFERING)) {
      stalledTicks = 0
      if (state === PLAYING) {
        appPaused = false
        wasPlaying = true
        pausedByInterruption = false
        pausedTicks = 0
        resumeAttempts = 0
      }
      return
    }

    if (!isBackground()) {
      // The user can interact with the page again; whatever is paused now is
      // their business.
      wasPlaying = false
      pausedByInterruption = false
      pausedTicks = 0
      resumeAttempts = 0
      stalledTicks = 0
      return
    }

    // Playing or buffering with a clock that has not moved: stalled, not
    // paused. Nothing paused it, so appPaused says nothing about it -- only a
    // real audio interruption is a reason to leave it alone.
    if (state === PLAYING || state === BUFFERING) {
      // Same bar as the resume below: only something that was playing can have
      // stalled, so a video the user never started is left alone.
      if (!wasPlaying || pausedByInterruption) {
        return
      }
      stalledTicks++
      if (stalledTicks < STALL_TICKS || resumeAttempts >= MAX_RESUME_ATTEMPTS) {
        return
      }
      stalledTicks = 0
      resumeAttempts++
      log(`background guard: unsticking a stalled player (attempt ${resumeAttempts})`)
      nudgePlayback(player)
      return
    }

    stalledTicks = 0
    if (state !== PAUSED || !wasPlaying || appPaused || pausedByInterruption) {
      return
    }
    pausedTicks++
    if (resumeAttempts >= MAX_RESUME_ATTEMPTS) {
      return
    }
    if (window.NouTubeI?.canAutoResume?.(bridgeToken()) === false) {
      // Our own stream lingers as "active" for ~10s after a pause, so give it
      // a few ticks to clear. Still blocked after that means a call or another
      // app really took the audio over: stay paused for good — if the
      // interruption ends, the user resumes from the media notification, not us.
      if (pausedTicks >= 6) {
        pausedByInterruption = true
      }
      return
    }

    resumeAttempts++
    const dismissed = confirmYouThereDialogs()
    log(`background guard: resuming (attempt ${resumeAttempts}, dialog: ${dismissed})`)
    // The first attempts assume YouTube paused a healthy player. Once those
    // have not taken, the buffer is the likelier culprit -- resume the way the
    // user has to, by seeking first.
    if (resumeAttempts > NUDGE_AFTER_ATTEMPTS) {
      nudgePlayback(player)
    } else {
      player.playVideo?.()
    }
  }, 5000)
}
