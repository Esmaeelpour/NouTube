/* The sites whose own router can take us to a /watch page without loading a
 * fresh document. music.youtube.com is left out on purpose: it is a separate
 * origin, so a link to a video there is a full navigation anyway. */
const ROUTABLE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com']

/* Only regular YouTube watch pages belong in the separate player. */
export function isWatchUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ROUTABLE_HOSTS.includes(url.host) &&
      url.pathname === '/watch'
    )
  } catch {
    return false
  }
}

/* Any page of the site, not just /watch: a player sitting on one has YouTube's
 * router live in it and can be sent to a video without a page load. */
export function isRoutableYoutubePage(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && ROUTABLE_HOSTS.includes(url.host)
  } catch {
    return false
  }
}
