import { observable } from '@legendapp/state'
import { syncObservable } from '@legendapp/state/sync'
import { ObservablePersistMMKV } from '@legendapp/state/persist-plugins/mmkv'
import {
  reconcileOnLoad,
  type DownloadRecord,
  type DownloadRecords,
  type DownloadStatus,
} from '@/lib/download-queue'

export type { DownloadRecord, DownloadRecords, DownloadStatus }

/* Every download the user has asked for, finished ones included: a download
 * list that forgets what it downloaded the moment the sheet is closed is not a
 * download list. Persisted for the same reason. */
export const downloads$ = observable<DownloadRecords>({})

syncObservable(downloads$, {
  persist: {
    name: 'downloads',
    plugin: ObservablePersistMMKV,
    transform: {
      // Nothing survives the process it was running in, so a record that was
      // still going when the app was last closed is finished, not running.
      load: (data: DownloadRecords) => reconcileOnLoad(data),
    },
  },
})
