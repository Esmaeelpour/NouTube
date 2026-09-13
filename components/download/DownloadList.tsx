import { ActivityIndicator, Pressable, View, useColorScheme } from 'react-native'
import { useValue } from '@legendapp/state/react'
import { t } from 'i18next'
import MaterialIcons from '@react-native-vector-icons/material-icons'
import { NouText } from '../NouText'
import { downloads$ } from '@/states/downloads'
import {
  cancelDownload,
  clearFinishedDownloads,
  openDownloadedFile,
  removeDownload,
  retryDownload,
} from '@/lib/downloads'
import { formatEta, isFinished, sortRecords, type DownloadRecord } from '@/lib/download-queue'
import { isAndroid, nIf } from '@/lib/utils'

/* The download list: everything the user has asked for, in one place, with the
 * one action each row is actually waiting for. Finished downloads stay until
 * they are cleared -- the list is the record of what was downloaded, not a
 * progress popup that forgets. */

const cardClass = (status: DownloadRecord['status']) => {
  const base = 'rounded-xl border p-4 gap-2 '
  if (status === 'error') {
    return base + 'border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30'
  }
  if (status === 'downloading' || status === 'queued') {
    return base + 'border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/30'
  }
  return base + 'border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900'
}

const actionClass =
  'bg-zinc-200 dark:bg-zinc-800 px-3 py-1.5 rounded-lg active:bg-zinc-300 dark:active:bg-zinc-700'
const actionTextClass = 'text-xs font-semibold text-zinc-700 dark:text-zinc-300'

const Action = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} className={actionClass}>
    <NouText className={actionTextClass}>{label}</NouText>
  </Pressable>
)

const DownloadRow = ({ item }: { item: DownloadRecord }) => {
  const isDark = useColorScheme() !== 'light'
  const eta = formatEta(item.etaSeconds)
  const percent = Math.min(100, Math.max(0, Number.isFinite(item.progress) ? item.progress : 0))

  return (
    <View className={cardClass(item.status)}>
      <View className="flex-row items-start justify-between gap-3">
        <Pressable
          className="flex-1 gap-1"
          disabled={item.status !== 'done' || !item.savedPath}
          onPress={() => openDownloadedFile(item.savedPath)}
        >
          <NouText className="text-sm font-semibold text-zinc-900 dark:text-zinc-100" numberOfLines={2}>
            {item.title || item.url}
          </NouText>
          {nIf(
            Boolean(item.formatLabel),
            <NouText className="text-xs text-zinc-500 dark:text-zinc-400">{item.formatLabel}</NouText>,
          )}
        </Pressable>
        {nIf(item.status === 'error', <MaterialIcons name="error-outline" size={18} color={isDark ? '#f87171' : '#dc2626'} />)}
        {nIf(item.status === 'done', <MaterialIcons name="check-circle" size={18} color={isDark ? '#86efac' : '#16a34a'} />)}
        {nIf(item.status === 'downloading', <ActivityIndicator size="small" color={isDark ? '#7dd3fc' : '#0284c7'} />)}
        {nIf(
          item.status === 'queued',
          <MaterialIcons name="schedule" size={18} color={isDark ? '#a1a1aa' : '#71717a'} />,
        )}
      </View>

      {nIf(
        item.status === 'downloading',
        <View className="gap-1">
          <View className="h-2 overflow-hidden rounded-full bg-sky-100 dark:bg-sky-950">
            <View
              className="h-full rounded-full bg-sky-500 dark:bg-sky-400"
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <NouText className="text-xs text-sky-700 dark:text-sky-200">{`${percent}%`}</NouText>
            {nIf(
              Boolean(eta),
              <NouText className="text-xs text-sky-700 dark:text-sky-200">
                {t('modals.downloadEta', '{{eta}} left', { eta })}
              </NouText>,
            )}
          </View>
        </View>,
      )}

      {nIf(
        item.status === 'queued',
        <NouText className="text-xs text-sky-700 dark:text-sky-200">
          {t('modals.downloadQueued', 'Waiting for the download ahead of it')}
        </NouText>,
      )}

      {nIf(
        item.status === 'done',
        <NouText className="text-xs text-zinc-500 dark:text-zinc-400" numberOfLines={2}>
          {isAndroid ? t('modals.downloadSavedAndroid', 'Saved to the Downloads folder') : t('modals.downloadComplete')}
        </NouText>,
      )}

      {nIf(
        item.status === 'canceled',
        <NouText className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('modals.downloadCanceled', 'Canceled')}
        </NouText>,
      )}

      {nIf(
        item.status === 'error',
        <NouText className="text-sm font-medium text-red-700 dark:text-red-300">
          {item.errorKey ? t(item.errorKey) : item.errorDetail || t('modals.downloadFailed')}
        </NouText>,
      )}

      <View className="mt-1 flex-row justify-end gap-2">
        {nIf(!isFinished(item), <Action label={t('buttons.cancel')} onPress={() => void cancelDownload(item.id)} />)}
        {nIf(
          item.status === 'done' && Boolean(item.savedPath),
          <Action label={t('buttons.open')} onPress={() => openDownloadedFile(item.savedPath)} />,
        )}
        {nIf(
          item.status === 'error' || item.status === 'canceled',
          <Action label={t('buttons.retry')} onPress={() => retryDownload(item.id)} />,
        )}
        {nIf(isFinished(item), <Action label={t('buttons.remove')} onPress={() => removeDownload(item.id)} />)}
      </View>
    </View>
  )
}

export const DownloadList = ({ onLayout }: { onLayout?: (event: any) => void }) => {
  const records = useValue(downloads$)
  const items = sortRecords(records || {})
  if (!items.length) {
    return null
  }
  const hasFinished = items.some(isFinished)

  return (
    <View className="gap-4" onLayout={onLayout}>
      <View className="flex-row items-center justify-between">
        <NouText className="text-sm font-bold uppercase tracking-widest text-zinc-500">
          {t('modals.downloadHistory')}
        </NouText>
        {nIf(
          hasFinished,
          <Pressable
            onPress={() => clearFinishedDownloads()}
            className="px-2 py-1 rounded-md active:bg-zinc-200 dark:active:bg-zinc-800"
          >
            <NouText className="text-xs text-zinc-500 font-medium">
              {t('buttons.clearFinished', 'Clear finished')}
            </NouText>
          </Pressable>,
        )}
      </View>
      {items.map((item) => (
        <DownloadRow key={item.id} item={item} />
      ))}
    </View>
  )
}
