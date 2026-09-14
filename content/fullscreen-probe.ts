import { isFullscreen } from './fullscreen-controls'
import { log } from './utils'

/* Temporary diagnostic: why a tap on YouTube's own fullscreen settings gear
 * never reaches it. Logs, for every tap in fullscreen, what is actually on top
 * at that point, and where the gear thinks it is. It goes out through the
 * app's own log bridge, which reaches logcat, so this is readable with adb
 * on a release build. Remove once the cause is known. */

const describe = (element: Element | null) => {
  if (!element) {
    return 'none'
  }
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const className = typeof element.className === 'string' ? element.className.slice(0, 60) : ''
  return `${element.tagName}#${element.id}.${className}|rect=${Math.round(rect.left)},${Math.round(
    rect.top,
  )},${Math.round(rect.width)}x${Math.round(rect.height)}|pe=${style.pointerEvents}|vis=${
    style.visibility
  }|z=${style.zIndex}`
}

const gearSelectors = [
  '.ytp-settings-button',
  'button[aria-label*="Setting" i]',
  '[class*="settings" i][role="button"]',
  'button[class*="Settings" i]',
]

function logGear() {
  for (const selector of gearSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.top + rect.height / 2)
      log(`[nou-probe] gear ${selector} -> ${describe(element)}`)
      log(
        `[nou-probe] gear top-at-centre ${x},${y}: ` +
          document
            .elementsFromPoint(x, y)
            .slice(0, 4)
            .map(describe)
            .join(' >> '),
      )
    }
  }
}


/* If the gear is reached but nothing appears, the menu is being rendered
 * outside the fullscreen element, where nothing renders. Log what turned up in
 * the document after the tap, and whether it is inside the fullscreen subtree. */
function logSheets(fullscreenElement: Element | null) {
  const candidates = new Set<Element>()
  for (const selector of [
    'dialog',
    '[role="dialog"]',
    '[role="menu"]',
    '[class*="sheet" i]',
    '[class*="popup" i]',
    '[class*="menu" i]',
    'ytm-sheet-container',
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      candidates.add(element)
    }
  }
  for (const element of candidates) {
    const rect = element.getBoundingClientRect()
    if (rect.width < 40 || rect.height < 40) {
      continue
    }
    // Hidden ones included on purpose: a menu that opened where nothing is
    // painted is exactly the thing being looked for.
    const style = getComputedStyle(element)
    if (style.display === 'none') {
      continue
    }
    log(
      `[nou-probe] sheet inFs=${fullscreenElement ? fullscreenElement.contains(element) : 'n/a'} ${describe(element)}`,
    )
  }
}

/* Whether the button is activated at all. If a click reaches it and still
 * nothing opens, the tap is not the problem and the menu is. */
function watchClicks() {
  document.addEventListener(
    'click',
    (event) => {
      if (!isFullscreen()) {
        return
      }
      const target = event.target
      log(`[nou-probe] click on ${describe(target instanceof Element ? target : null)}`)
    },
    true,
  )
}

/* Everything the page adds after a tap, painted or not. A menu that opens
 * inside a hidden host shows up here and nowhere else. */
function watchAdditions() {
  let until = 0
  const observer = new MutationObserver((records) => {
    if (Date.now() > until) {
      return
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) {
          continue
        }
        const rect = node.getBoundingClientRect()
        if (rect.width < 40 || rect.height < 40) {
          continue
        }
        const host = document.fullscreenElement
        log(`[nou-probe] added inFs=${host ? host.contains(node) : 'n/a'} ${describe(node)}`)
      }
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  return () => {
    until = Date.now() + 1500
  }
}

export function installFullscreenProbe() {
  watchClicks()
  const watchFor = watchAdditions()
  document.addEventListener(
    'touchstart',
    (event) => {
      if (!isFullscreen() || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const x = Math.round(touch.clientX)
      const y = Math.round(touch.clientY)
      log(
        `[nou-probe] tap ${x},${y} dpr=${window.devicePixelRatio} vw=${window.innerWidth}x${window.innerHeight}: ` +
          document.elementsFromPoint(x, y).slice(0, 5).map(describe).join(' >> '),
      )
      logGear()
      watchFor()
      setTimeout(() => logSheets(document.fullscreenElement), 600)
    },
    { capture: true, passive: true },
  )
}
