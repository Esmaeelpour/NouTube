import { ui$, updateUrl } from '@/states/ui'
import { onReceiveAuthUrl } from './supabase/auth'
import { settings$ } from '@/states/settings'
import { debounce } from 'es-toolkit'
import { isSupportedUrl, normalizeSupportedUrl } from './supported-url'
import { removeTrackingParams } from './tracking-url'
import { isSplitWatchEnabled, isWatchUrl, openInPlayer } from './split-view'

export { getPageType } from './page-type'

export function fixPageTitle(title: string) {
  return title.replace(/ - YouTube( Music)*$/, '')
}

export function fixSharingUrl(v: string) {
  return removeTrackingParams(v)
}

export function getVideoThumbnail(id: string) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`
}

/* https://www.youtube.com/watch?v=<id> */
export function getVideoId(url: string) {
  try {
    return new URL(url).searchParams.get('v')
  } catch {
    return ''
  }
}

export function getThumbnail(url: string) {
  const id = getVideoId(url)
  return id ? getVideoThumbnail(id) : undefined
}

export function openSharedUrl(url: string) {
  if (url.startsWith('noutube:auth')) {
    onReceiveAuthUrl(url)
    return
  }
  try {
    const fixed = fixSharingUrl(url)
    if (!isSupportedUrl(fixed)) {
      return
    }
    const normalized = normalizeSupportedUrl(fixed)
    // A video belongs in the player half wherever it came from -- a share, a
    // deep link, another app. updateUrl loads it into the browsing webview,
    // which in the split watch view leaves the same video open in both halves
    // at once, with the player still holding whatever it had.
    if (isSplitWatchEnabled() && isWatchUrl(normalized)) {
      openInPlayer(normalized)
      return
    }
    updateUrl(normalized)
  } catch (error) {
    console.error(error)
  }
}

export const setPageUrl = debounce(async function (url: string) {
  if (!url) {
    return
  }
  ui$.pageUrl.set(url)
  const { host } = new URL(url)
  settings$.home.set(host === 'music.youtube.com' ? 'yt-music' : 'yt')
}, 300)
