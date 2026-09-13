import { ActivityIndicator, Pressable, ScrollView, TextInput, View, useColorScheme } from 'react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useValue } from '@legendapp/state/react'
import { ui$ } from '@/states/ui'
import { settings$ } from '@/states/settings'
import { BaseModal } from './BaseModal'
import { NouText } from '../NouText'
import { NouButton } from '../button/NouButton'
import { NouSwitch } from '../switch/NouSwitch'
import { mainClient } from '@/lib/main-client'
import { downloads$ } from '@/states/downloads'
import { queueDownload } from '@/lib/downloads'
import { downloadId, isFinished } from '@/lib/download-queue'
import { DownloadList } from '../download/DownloadList'
import { t } from 'i18next'
import type { FormatOption } from '@/lib/main-client'
import { findPinnedFormats, togglePinnedFormat } from '@/lib/download-format'
import { listFormats } from '@/lib/list-formats'
import { isAndroid, nIf } from '@/lib/utils'
import MaterialIcons from '@react-native-vector-icons/material-icons'

type Phase = 'idle' | 'loading' | 'choosing' | 'error'

export const ToolsModal = () => {
  const toolsModalOpen = useValue(ui$.toolsModalOpen)
  const toolsModalUrl = useValue(ui$.toolsModalUrl)
  const isOpen = toolsModalOpen || !!toolsModalUrl
  const downloadPath = useValue(settings$.downloadPath)
  const useCookies = useValue(settings$.downloadUseCookies)
  const downloadPresets = useValue(settings$.downloadPresets)
  const [url, setUrl] = useState('')
  const [resolvedDownloadsPath, setResolvedDownloadsPath] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [formats, setFormats] = useState<FormatOption[]>([])
  const [parsedTitle, setParsedTitle] = useState('')
  const [loadedUrl, setLoadedUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [showAllFormats, setShowAllFormats] = useState(false)
  const activeDownloads = useValue(downloads$)
  const loadingUrlRef = useRef('')
  const scrollRef = useRef<ScrollView>(null)
  const downloadsSectionYRef = useRef(0)
  const scrollToDownloadsRef = useRef(false)
  const isDark = useColorScheme() !== 'light'
  const effectiveDownloadPath = downloadPath || resolvedDownloadsPath

  const onClose = () => {
    ui$.toolsModalOpen.set(false)
    ui$.toolsModalUrl.set('')
  }

  const loadFormats = useCallback((targetUrl: string) => {
    loadingUrlRef.current = targetUrl
    setPhase('loading')
    setFormats([])
    setShowAllFormats(false)
    setParsedTitle('')
    setLoadedUrl('')
    setErrorMsg('')
    listFormats(targetUrl, settings$.downloadUseCookies.peek())
      .then((result) => {
        if (loadingUrlRef.current !== targetUrl) return
        setFormats(result.formats)
        setParsedTitle(result.title)
        setLoadedUrl(targetUrl)
        setPhase('choosing')
      })
      .catch((err: any) => {
        if (loadingUrlRef.current !== targetUrl) return
        setErrorMsg(err?.message || t('modals.failedToLoadFormats'))
        setPhase('error')
      })
  }, [])

  useEffect(() => {
    mainClient.getDownloadsPath().then(setResolvedDownloadsPath)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    if (toolsModalUrl) {
      setUrl(toolsModalUrl)
      loadFormats(toolsModalUrl)
    } else {
      setUrl('')
      setPhase('idle')
    }
    setFormats([])
  }, [isOpen, toolsModalUrl, loadFormats])

  // The format list stays up after a download starts, so another format of the same video can
  // be grabbed without resolving the URL again -- and now it keeps its own place in the queue
  // rather than taking over the one already running.
  const handleDownload = (opt: FormatOption) => {
    const targetUrl = loadedUrl || toolsModalUrl || url
    queueDownload({
      url: targetUrl,
      title: parsedTitle || targetUrl,
      formatId: opt.formatId,
      formatLabel: opt.label || opt.formatId,
    })

    // The progress card sits above the format list, which can be long enough that the card is
    // off screen when a format further down was picked — so scroll it into view. On the first
    // download the section is not laid out yet, hence the flag picked up by its onLayout.
    if (downloadsSectionYRef.current) {
      scrollToDownloads()
    } else {
      scrollToDownloadsRef.current = true
    }

  }

  const scrollToDownloads = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, downloadsSectionYRef.current - 12), animated: true })
  }

  if (!isOpen) return null

  const hasAdvancedFormats = formats.some((opt) => opt.advanced)
  const presets = Array.isArray(downloadPresets) ? downloadPresets : []
  const pinnedFormats = findPinnedFormats(formats, presets)
  const pinnedByFormatId = new Map(pinnedFormats.map((pinned) => [pinned.format.formatId, pinned]))
  const listedFormats = showAllFormats ? formats : formats.filter((opt) => !opt.advanced)
  // Pinned formats lead the list even when they are extra formats, so pins remove the need to
  // expand the list at all.
  const visibleFormats = [
    ...pinnedFormats.map((pinned) => pinned.format),
    ...listedFormats.filter((opt) => !pinnedByFormatId.has(opt.formatId)),
  ]

  // Only the format already on its way is spoken for; every other one can still be queued.
  const pendingFormat = (formatId: string) => {
    const existing = activeDownloads[downloadId(loadedUrl || toolsModalUrl || url, formatId)]
    return Boolean(existing) && !isFinished(existing as any)
  }

  const togglePin = (opt: FormatOption) => {
    settings$.downloadPresets.set(togglePinnedFormat(presets, opt, pinnedByFormatId.get(opt.formatId)))
  }


  return (
    <BaseModal onClose={onClose}>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="p-5 gap-4"
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center justify-between">
          <NouText className="text-lg font-semibold">{t('modals.downloadVideo', 'Download video')}</NouText>
        </View>

        <View className="gap-1">
          <NouText className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">URL</NouText>
          <TextInput
            className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 text-sm text-zinc-900 dark:text-zinc-100"
            value={url}
            onChangeText={(v) => {
              setUrl(v)
              setPhase('idle')
              setFormats([])
            }}
            onSubmitEditing={() => {
              const trimmed = url.trim()
              if (trimmed) loadFormats(trimmed)
            }}
            returnKeyType="go"
            placeholder="https://www.youtube.com/watch?v=..."
            placeholderTextColor={isDark ? '#71717a' : '#a1a1aa'}
          />
        </View>

        {nIf(
          !isAndroid && (phase === 'idle' || phase === 'choosing'),
          <View className="gap-1">
            <NouText className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">{t('modals.folder')}</NouText>
            <Pressable
              className="flex-row items-center gap-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 active:bg-zinc-100 dark:active:bg-zinc-800"
              onPress={async () => {
                const picked = await mainClient.selectFolder()
                if (picked) settings$.downloadPath.set(picked)
              }}
            >
              <NouText className="flex-1 text-sm text-zinc-700 dark:text-zinc-300" numberOfLines={1}>
                {effectiveDownloadPath || t('modals.downloadsFolder')}
              </NouText>
              <NouText className="text-xs text-zinc-400 dark:text-zinc-500">{t('buttons.browse')}</NouText>
            </Pressable>
          </View>,
        )}

        {nIf(
          phase === 'idle' || phase === 'choosing' || phase === 'error',
          <View className="gap-1">
            <NouSwitch
              label={t('modals.downloadUseCookies')}
              value={useCookies}
              onPress={() => settings$.downloadUseCookies.set(!settings$.downloadUseCookies.peek())}
            />
            <NouText className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('modals.downloadUseCookiesHint')}
            </NouText>
          </View>,
        )}

        {nIf(
          phase === 'idle' || phase === 'error',
          <View className="flex-row justify-end">
            <NouButton disabled={!url.trim()} onPress={() => loadFormats(url.trim())}>
              {t('buttons.next')}
            </NouButton>
          </View>,
        )}

        <DownloadList
          onLayout={(e) => {
            downloadsSectionYRef.current = e.nativeEvent.layout.y
            if (scrollToDownloadsRef.current) {
              scrollToDownloadsRef.current = false
              scrollToDownloads()
            }
          }}
        />
        {phase === 'loading' && <ActivityIndicator color={isDark ? 'white' : '#3f3f46'} />}

        {phase === 'choosing' && (
          <View className="gap-3">
            {!!parsedTitle && (
              <NouText className="text-sm font-medium text-zinc-600 dark:text-zinc-400 italic px-1">
                {parsedTitle}
              </NouText>
            )}
            {visibleFormats.map((opt) => {
              const isPinned = pinnedByFormatId.has(opt.formatId)
              return (
                <View
                  key={opt.formatId}
                  className={
                    isPinned
                      ? 'rounded-xl border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 p-4 gap-3'
                      : 'rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-4 gap-3'
                  }
                >
                  <View className="flex-row items-center gap-3">
                    <View className="flex-1 gap-1">
                      <View className="flex-row items-center gap-2">
                        <NouText className="font-semibold">{opt.label}</NouText>
                        {nIf(
                          isPinned,
                          <NouText className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                            {t('modals.pinnedFormat')}
                          </NouText>,
                        )}
                      </View>
                      <NouText className="text-sm text-zinc-500 dark:text-zinc-400">{opt.description}</NouText>
                    </View>
                    <Pressable
                      onPress={() => togglePin(opt)}
                      accessibilityLabel={isPinned ? t('modals.unpinFormat') : t('modals.pinFormat')}
                      className="h-11 w-11 items-center justify-center rounded-full active:bg-zinc-200 dark:active:bg-zinc-800"
                    >
                      <MaterialIcons
                        name="push-pin"
                        size={20}
                        color={isPinned ? (isDark ? '#818cf8' : '#4f46e5') : isDark ? '#71717a' : '#a1a1aa'}
                      />
                    </Pressable>
                    <Pressable
                      disabled={pendingFormat(opt.formatId)}
                      onPress={() => handleDownload(opt)}
                      className={
                        pendingFormat(opt.formatId)
                          ? 'h-11 w-11 items-center justify-center rounded-full bg-zinc-300 dark:bg-zinc-700'
                          : 'h-11 w-11 items-center justify-center rounded-full bg-indigo-600 dark:bg-indigo-500 active:bg-indigo-700 dark:active:bg-indigo-400'
                      }
                    >
                      <MaterialIcons name="download" size={20} color="#fff" />
                    </Pressable>
                  </View>
                </View>
              )
            })}
            {nIf(
              hasAdvancedFormats,
              <Pressable
                onPress={() => setShowAllFormats(!showAllFormats)}
                className="flex-row items-center justify-center gap-1 rounded-lg py-2 active:bg-zinc-200 dark:active:bg-zinc-800"
              >
                <NouText className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                  {showAllFormats ? t('modals.showFewerFormats') : t('modals.showAllFormats')}
                </NouText>
                <MaterialIcons
                  name={showAllFormats ? 'expand-less' : 'expand-more'}
                  size={18}
                  color={isDark ? '#818cf8' : '#4f46e5'}
                />
              </Pressable>,
            )}
          </View>
        )}

        {phase === 'error' && (
          <View className="gap-3">
            <NouText className="text-sm text-red-500 dark:text-red-400">
              {errorMsg || t('modals.failedToLoadFormats')}
            </NouText>
          </View>
        )}

      </ScrollView>
    </BaseModal>
  )
}
