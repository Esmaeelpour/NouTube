import { BackHandler } from 'react-native'
import { useEffect, useRef, useState } from 'react'
import { useObserveEffect } from '@legendapp/state/react'
import { ui$ } from '@/states/ui'
import { handleSplitBack } from '@/lib/split-view'
import { openSharedUrl } from '@/lib/page'
import { enterPictureInPicture } from '@/lib/picture-in-picture'
import { Asset } from 'expo-asset'
import { useIncomingShare } from 'expo-sharing'
import { parseSharedUrl } from '@/lib/share-intent'
import * as Linking from 'expo-linking'
import { MainPage } from '@/components/page/MainPage'
import { isAndroid, nIf } from '@/lib/utils'
import NouTubeViewModule from '@/modules/nou-tube-view'
import { settings$ } from '@/states/settings'
import { sleepTimer$ } from '@/states/sleep-timer'
import { showToast } from '@/lib/toast'
import { t } from 'i18next'
import { addSleepTimerListener, getNativeSleepTimerRemainingMs, hasSleepTimerNativeSupport } from '@/lib/sleep-timer-native'

// The activity can be recreated while the process (and this JS runtime) stays
// alive on the media service, so the launch intent has to be read on every
// mount. Every read of it that follows the tap we already served returns that
// same link again, so remember the last one and let a re-read pass. A `url`
// event is always a fresh tap -- even of a link already watched -- and is never
// filtered.
let lastHandledDeepLink: string | null = null

function openDeepLink(url: string) {
  lastHandledDeepLink = url
  openSharedUrl(url)
}

const syncNativeSettings = () => {
  const settings = settings$.get()
  NouTubeViewModule.setSettings({
    proxyEnabled: settings.proxyEnabled,
    proxyType: settings.proxyType,
    proxyHost: settings.proxyHost,
    proxyPort: settings.proxyPort,
    showMediaNotificationPrevButton: settings.showMediaNotificationPrevButton,
    showMediaNotificationNextButton: settings.showMediaNotificationNextButton,
    showMediaNotificationRewindButton: settings.showMediaNotificationRewindButton,
    showMediaNotificationForwardButton: settings.showMediaNotificationForwardButton,
    showMediaNotificationSpeedButton: settings.showMediaNotificationSpeedButton,
    showMediaNotificationCloseButton: settings.showMediaNotificationCloseButton,
    playbackRate: settings.playbackRate,
    blockAds: settings.blockAds,
  })
}

export default function HomeScreen() {
  const [scriptOnStart, setScriptOnStart] = useState('')
  const { resolvedSharedPayloads, clearSharedPayloads, isResolving } = useIncomingShare()
  const handledPayloadKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (isResolving) {
      return
    }
    if (resolvedSharedPayloads.length === 0) {
      handledPayloadKeyRef.current = null
      return
    }

    const payload = resolvedSharedPayloads[0]
    const key = `${payload.contentType ?? 'text'}:${payload.contentUri ?? ''}:${payload.value}`
    if (handledPayloadKeyRef.current === key) {
      return
    }
    handledPayloadKeyRef.current = key

    let url: string | null = null
    if (payload.contentType === 'website' && payload.contentUri) {
      url = payload.contentUri
    } else {
      url = parseSharedUrl({ webUrl: payload.contentUri ?? undefined, text: payload.value ?? undefined })
    }

    if (url) {
      openSharedUrl(url)
    }

    clearSharedPayloads()
  }, [resolvedSharedPayloads, isResolving, clearSharedPayloads])

  useEffect(() => {
    ;(async () => {
      const [{ localUri }] = await Asset.loadAsync(require('../assets/scripts/main.bjs'))
      if (localUri) {
        const res = await fetch(localUri)
        const content = await res.text()
        setScriptOnStart(content)
      }
    })()

    // @ts-expect-error
    NouTubeViewModule.addListener('log', (evt) => {
      console.log('[kotlin]', evt.msg)
    })

    if (isAndroid) {
      syncNativeSettings()
    }

    let sleepTimerSubscription: { remove?: () => void } | undefined
    if (isAndroid && hasSleepTimerNativeSupport()) {
      void getNativeSleepTimerRemainingMs()
        .then((remainingMs) => sleepTimer$.setRemainingMs(remainingMs))
        .catch((error) => {
          console.error('getSleepTimerRemainingMs failed', error)
        })

      sleepTimerSubscription = addSleepTimerListener((evt) => {
        sleepTimer$.setRemainingMs(evt.remainingMs ?? null)
        if (evt.reason === 'expired') {
          showToast(t('sleepTimer.expiredToast'))
        }
      })
    } else {
      sleepTimer$.clear()
    }

    // Back keeps the video and moves the user: back to the page they came from
    // with the video carrying on in the mini player, and only once there is no
    // page left to go back to does the video take over -- pinned to a floating
    // window as the app steps out of the way.
    const back = async () => {
      // The split watch view keeps the browsing page alive underneath, so this
      // is both halves at once: the page returns and the video drops into the
      // mini player rather than stopping.
      if (handleSplitBack()) {
        return
      }
      const webview = ui$.webview.get()
      // A shell without the query: its goBack already steps back where it can
      // and leaves the app where it cannot, which is this order minus the pin.
      if (typeof webview?.canGoBack !== 'function') {
        void webview?.goBack?.()
        return
      }
      if (await webview.canGoBack()) {
        void webview.goBack()
        return
      }
      // Nowhere left to go back to, so leaving is the only way out: hand the
      // video to a floating window on the way.
      if (await enterPictureInPicture()) {
        return
      }
      // Nothing playing, or picture-in-picture turned off: goBack leaves the
      // app when the webview has no history of its own.
      void webview.goBack()
    }

    const backSubscription = BackHandler.addEventListener('hardwareBackPress', function () {
      void back().catch((error) => console.error('back failed', error))
      return true
    })

    return () => {
      sleepTimerSubscription?.remove?.()
      backSubscription.remove()
    }
  }, [])

  useEffect(() => {
    // Neither source is enough on its own: a cold start (or a recreated
    // activity) only exposes the link through getInitialURL(), while a link
    // arriving at a live activity only fires the `url` event.
    void Linking.getInitialURL()
      .then((url) => {
        if (url && url !== lastHandledDeepLink) {
          openDeepLink(url)
        }
      })
      .catch((error) => {
        console.error('getInitialURL failed', error)
      })

    const subscription = Linking.addEventListener('url', (e) => {
      openDeepLink(e.url)
    })
    return () => subscription.remove()
  }, [])

  useObserveEffect(ui$.url, () => {
    ui$.queueModalOpen.set(false)
  })

  useObserveEffect(settings$, () => {
    if (isAndroid) {
      syncNativeSettings()
    }
  })

  return nIf(scriptOnStart, <MainPage contentJs={scriptOnStart} />)
}
