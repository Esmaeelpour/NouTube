import { ui$, updateUrl } from '@/states/ui'
import { onReceiveAuthUrl } from './supabase/auth'
import { settings$ } from '@/states/settings'
import { debounce } from 'es-toolkit'
import { isSupportedUrl, normalizeSupportedUrl } from './supported-url'
import { removeTrackingParams } from './tracking-url'

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
    // A video ought to go to the player half in the split watch view, and
    // openInPlayer is how the app does that everywhere else -- but a deep link
    // at cold start reaches this before the player webview exists, and the
    // queued load never lands: the player opens blank. Until that path is
    // understood, the browsing webview takes it and plays it, which is wrong
    // but not broken.
    updateUrl(normalizeSupportedUrl(fixed))
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
