import { describe, expect, it } from 'bun:test'
import { isRoutableYoutubePage, isWatchUrl } from './split-watch-url'

describe('isWatchUrl', () => {
  it('matches watch pages on the regular site', () => {
    expect(isWatchUrl('https://m.youtube.com/watch?v=abc123')).toBe(true)
    expect(isWatchUrl('https://www.youtube.com/watch?v=abc123&list=PL1')).toBe(true)
    expect(isWatchUrl('https://youtube.com/watch?v=abc123')).toBe(true)
  })

  it('leaves every other page with the browsing view', () => {
    expect(isWatchUrl('https://m.youtube.com/')).toBe(false)
    expect(isWatchUrl('https://m.youtube.com/shorts/abc123')).toBe(false)
    expect(isWatchUrl('https://music.youtube.com/watch?v=abc123')).toBe(false)
    expect(isWatchUrl('about:blank')).toBe(false)
    expect(isWatchUrl('')).toBe(false)
  })
})

describe('isRoutableYoutubePage', () => {
  it('takes any page of the site, not only /watch', () => {
    expect(isRoutableYoutubePage('https://m.youtube.com/')).toBe(true)
    expect(isRoutableYoutubePage('https://m.youtube.com/@channel')).toBe(true)
    expect(isRoutableYoutubePage('https://m.youtube.com/shorts/abc123')).toBe(true)
    expect(isRoutableYoutubePage('https://www.youtube.com/watch?v=abc123')).toBe(true)
  })

  // A page with no router of its own, or one whose router cannot reach
  // youtube.com/watch without a full navigation.
  it('rejects everything the router cannot route from', () => {
    expect(isRoutableYoutubePage('about:blank')).toBe(false)
    expect(isRoutableYoutubePage('')).toBe(false)
    expect(isRoutableYoutubePage('https://music.youtube.com/')).toBe(false)
    expect(isRoutableYoutubePage('https://accounts.google.com/signin')).toBe(false)
    expect(isRoutableYoutubePage('https://notyoutube.com/watch?v=abc123')).toBe(false)
  })
})
