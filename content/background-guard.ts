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
// in, and the point after which the guard stops pressing and only checks back
// now and then.
const NUDGE_AFTER_ATTEMPTS = 2
const MAX_RESUME_ATTEMPTS = 5
// Ticks (5s each) a clock may stand still before playback counts as stalled.
const STALL_TICKS = 3
// Every resume is heard: playback stops and starts again, and a nudge repeats
// the last few seconds. Leave room between attempts so a guard that is losing
// is a couple of blips rather than a stutter -- and once it has clearly lost,
// back off to the occasional look rather than either stuttering on or giving
// up on the video for good.
const ATTEMPT_COOLDOWN_TICKS = 6
const SLOW_RETRY_TICKS = 24
// Playback that came back and stayed back has recovered, and the next trouble
// deserves the full allowance again. Recovering for one tick before stopping
// again has not: that is the guard and YouTube taking turns, and counting it
// as recovery is what let them do it forever.
const HEALTHY_TICKS_TO_RESET = 12

const bridgeToken = () => window.NouTubeToken || ''

let appPaused = false
let wasPlaying = false
let pausedByInterruption = false
let pausedTicks = 0
let resumeAttempts = 0
let stalledTicks = 0
let lastVideoTime = -1
let healthyTicks = 0
let ticksSinceAttempt = ATTEMPT_COOLDOWN_TICKS
let lastTime = -1

const isBackground = () => window.NouTubeBackground === true

/* Whether another resume may be heard yet. The first few come reasonably
 * quickly, because most background pauses give way to one; after that the
 * guard is losing an argument and pressing harder only makes the noise. */
const canAttempt = () =>
  ticksSinceAttempt >= (resumeAttempts >= MAX_RESUME_ATTEMPTS ? SLOW_RETRY_TICKS : ATTEMPT_COOLDOWN_TICKS)

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

/* The media element behind the player, as a second opinion. The player API can
 * report a stale time of its own accord, and acting on that alone means
 * interrupting playback that was never in trouble -- which the user hears as
 * the video stopping and starting on its own. */
const getVideoElement = () => {
  const video = document.querySelector('#movie_player video')
  return video instanceof HTMLVideoElement ? video : null
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

    ticksSinceAttempt++
    const state = player.getPlayerState()
    // Progress, not the reported state, is what says playback is healthy: a
    // stalled player goes on calling itself PLAYING with the clock frozen.
    const time = getTime(player)
    const video = getVideoElement()
    const videoTime = video ? video.currentTime : -1
    const advancing = time < 0 || time !== lastTime
    // A video element that is still moving, or that has not been asked to
    // play at all, is not a stalled one whatever the player API says.
    const videoStuck = Boolean(video) && !video!.paused && videoTime === lastVideoTime
    lastTime = time
    lastVideoTime = videoTime

    if (advancing && (state === PLAYING || state === BUFFERING)) {
      stalledTicks = 0
      if (state === PLAYING) {
        appPaused = false
        wasPlaying = true
        pausedByInterruption = false
        pausedTicks = 0
        healthyTicks++
        if (healthyTicks >= HEALTHY_TICKS_TO_RESET) {
          resumeAttempts = 0
        }
      }
      return
    }
    healthyTicks = 0

    if (!isBackground()) {
      // The user can interact with the page again; whatever is paused now is
      // their business.
      wasPlaying = false
      pausedByInterruption = false
      pausedTicks = 0
      resumeAttempts = 0
      stalledTicks = 0
      ticksSinceAttempt = ATTEMPT_COOLDOWN_TICKS
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
      // Both clocks have to have stopped. One of them standing still on its
      // own is the reading being stale, not the playback being stuck.
      if (!videoStuck) {
        stalledTicks = 0
        return
      }
      stalledTicks++
      if (stalledTicks < STALL_TICKS || !canAttempt()) {
        return
      }
      stalledTicks = 0
      resumeAttempts++
      ticksSinceAttempt = 0
      log(`background guard: unsticking a stalled player (attempt ${resumeAttempts})`)
      nudgePlayback(player)
      return
    }

    stalledTicks = 0
    if (state !== PAUSED || !wasPlaying || appPaused || pausedByInterruption) {
      return
    }
    pausedTicks++
    if (!canAttempt()) {
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
    ticksSinceAttempt = 0
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
