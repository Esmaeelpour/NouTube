import { downloads$ } from '@/states/downloads'
import { settings$ } from '@/states/settings'
import { mainClient } from './main-client'
import {
  applyProgress,
  canceledRecord,
  createRecord,
  downloadId,
  isFinished,
  nextQueued,
  retriedRecord,
  withoutFinished,
  type DownloadRecord,
} from './download-queue'
import { onDownloadProgress, type ProgressPayload } from './download-progress'

/* The download manager: the one place that starts, stops and remembers
 * downloads. The decisions live in download-queue, the store in
 * states/downloads; this is the wiring between those and yt-dlp. */

let installed = false
let downloadsPath = ''

const record = (id: string): DownloadRecord | undefined => downloads$[id].peek() as DownloadRecord | undefined

/* Which record an event belongs to. The native side echoes the id back, but a
 * shell that predates it only says which URL it was for -- fall back to the
 * running download of that URL, which is the one it can only have been. */
function idForPayload(payload: ProgressPayload & { id?: string }): string | undefined {
  if (payload.id && record(payload.id)) {
    return payload.id
  }
  const running = Object.values(downloads$.peek() as Record<string, DownloadRecord>).find(
    (entry) => entry.url === payload.url && entry.status === 'downloading',
  )
  return running?.id
}

/* Start the next queued download if a slot is free. Called after every change
 * that could open one. */
function pump() {
  const next = nextQueued(downloads$.peek() as Record<string, DownloadRecord>)
  if (!next) {
    return
  }
  downloads$[next.id].status.set('downloading')
  const path = settings$.downloadPath.peek() || downloadsPath
  const useCookies = Boolean(settings$.downloadUseCookies.peek())
  // The promise only reports what the events already carry, and it rejects on
  // the same failure they report -- so the events own the outcome and this only
  // has to keep the queue moving if the call never produced any.
  Promise.resolve(mainClient.downloadVideo(next.url, next.formatId, path, useCookies, next.id))
    .catch(() => undefined)
    .then(() => {
      const after = record(next.id)
      if (after && !isFinished(after)) {
        downloads$[next.id].assign({ status: 'error', errorDetail: after.line, finishedAt: Date.now() })
      }
      pump()
    })
}

export function installDownloadManager() {
  if (installed) {
    return
  }
  installed = true
  // Where files land when the user has not chosen a folder. Resolved once,
  // rather than on every download.
  Promise.resolve(mainClient.getDownloadsPath())
    .then((path) => {
      downloadsPath = path || ''
    })
    .catch(() => undefined)

  onDownloadProgress((payload) => {
    const id = idForPayload(payload)
    if (!id) {
      return
    }
    const updated = applyProgress(record(id), payload)
    if (!updated) {
      return
    }
    downloads$[id].assign(updated)
    if (isFinished(updated)) {
      pump()
    }
  })
  // A download queued in a previous run is not resumed: reconcileOnLoad has
  // already finished those, because the file they were writing is gone.
  pump()
}

export function queueDownload(input: { url: string; title: string; formatId: string; formatLabel: string }) {
  const id = downloadId(input.url, input.formatId)
  const existing = record(id)
  // Asking again for something already running or waiting is a no-op, not a
  // second copy of it; asking again for a finished one starts it over.
  if (existing && !isFinished(existing)) {
    return id
  }
  downloads$[id].set(existing ? retriedRecord({ ...existing, ...input, id }) : createRecord(input))
  pump()
  return id
}

export function retryDownload(id: string) {
  const existing = record(id)
  if (!existing || !isFinished(existing)) {
    return
  }
  downloads$[id].set(retriedRecord(existing))
  pump()
}

export async function cancelDownload(id: string) {
  const existing = record(id)
  if (!existing || isFinished(existing)) {
    return
  }
  // Mark it first: the process dies asynchronously and its last progress events
  // are still in flight, and a cancelled record ignores them.
  downloads$[id].set(canceledRecord(existing))
  if (existing.status === 'downloading') {
    try {
      await (mainClient as any).cancelDownload?.(id)
    } catch {
      // The process was already gone, which is the state we wanted anyway.
    }
  }
  pump()
}

export function removeDownload(id: string) {
  const existing = record(id)
  if (existing && !isFinished(existing)) {
    void cancelDownload(id)
  }
  downloads$[id].delete()
  pump()
}

export function clearFinishedDownloads() {
  downloads$.set(withoutFinished(downloads$.peek() as Record<string, DownloadRecord>))
}

export function openDownloadedFile(path: string) {
  if (!path) {
    return
  }
  void Promise.resolve((mainClient as any).openFile?.(path)).catch(() => undefined)
}
