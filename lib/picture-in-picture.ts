import NouTubeViewModule from '@/modules/nou-tube-view'
import { ui$ } from '@/states/ui'
import { getPlayerWebview } from './split-view'
import { isAndroid } from './utils'

type PictureInPictureNativeModule = {
  addListener?: (eventName: string, listener: (payload: any) => void) => { remove?: () => void }
}

/**
 * Fires when Android pins the app to a floating window and when it lets go.
 * The video itself is shrunk by the page (content/picture-in-picture.ts); this
 * is only how the app chrome learns to get out of its way.
 */
export function addPictureInPictureListener(listener: (active: boolean) => void) {
  const nativeModule = NouTubeViewModule as PictureInPictureNativeModule
  if (!isAndroid || typeof nativeModule.addListener !== 'function') {
    return undefined
  }
  return nativeModule.addListener('pictureInPicture', (payload) => listener(Boolean(payload?.active)))
}

/**
 * Pin the playing video to a floating window, answering whether it happened.
 *
 * Back used to leave this to the system: the webview navigated (or the activity
 * finished), the activity paused on the way out and Android pinned whatever was
 * on screen by then -- which is how a pinned window ended up showing the page
 * the webview had just gone back to, and why the transition came out of a
 * window that was already tearing itself down. Asking for it up front keeps the
 * video where it is and lets the system animate from it.
 */
export async function enterPictureInPicture() {
  if (!isAndroid) {
    return false
  }
  // In the split watch view the video always belongs to the player webview,
  // even when the browsing one is the foreground page.
  const view = getPlayerWebview() || ui$.webview.peek()
  if (typeof view?.enterPictureInPicture !== 'function') {
    return false
  }
  try {
    return Boolean(await view.enterPictureInPicture())
  } catch (error) {
    console.error('enterPictureInPicture failed', error)
    return false
  }
}
