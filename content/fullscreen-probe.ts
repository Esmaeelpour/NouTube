import { isFullscreen } from './fullscreen-controls'

/* Temporary diagnostic: why a tap on YouTube's own fullscreen settings gear
 * never reaches it. Logs, for every tap in fullscreen, what is actually on top
 * at that point, and where the gear thinks it is. Console messages reach
 * logcat, so this is readable with adb on a release build. Remove once the
 * cause is known. */

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
      console.log(`[nou-probe] gear ${selector} -> ${describe(element)}`)
      console.log(
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
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') {
      continue
    }
    console.log(
      `[nou-probe] sheet inFs=${fullscreenElement ? fullscreenElement.contains(element) : 'n/a'} ${describe(element)}`,
    )
  }
}

export function installFullscreenProbe() {
  document.addEventListener(
    'touchstart',
    (event) => {
      if (!isFullscreen() || event.touches.length !== 1) {
        return
      }
      const touch = event.touches[0]
      const x = Math.round(touch.clientX)
      const y = Math.round(touch.clientY)
      console.log(
        `[nou-probe] tap ${x},${y} dpr=${window.devicePixelRatio} vw=${window.innerWidth}x${window.innerHeight}: ` +
          document.elementsFromPoint(x, y).slice(0, 5).map(describe).join(' >> '),
      )
      logGear()
      setTimeout(() => logSheets(document.fullscreenElement), 600)
    },
    { capture: true, passive: true },
  )
}
