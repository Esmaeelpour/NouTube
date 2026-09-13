import { describeDownloadError } from './download-error'
import type { ProgressPayload } from './download-progress-base'

/* The download manager's state, kept apart from the store and the native calls
 * so the parts that decide anything can be tested on their own.
 *
 * A download is one format of one video. It is identified by both, because
 * asking for the 1080p and the audio-only version of the same video is two
 * downloads, not one replacing the other -- which is what keying them by URL
 * used to do. */

export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error' | 'canceled'

export interface DownloadRecord {
  id: string
  url: string
  title: string
  formatId: string
  formatLabel: string
  status: DownloadStatus
  /* Percent, 0-100. */
  progress: number
  /* Seconds left as yt-dlp last reported them, 0 when it has not said. */
  etaSeconds: number
  /* yt-dlp's last output line, kept for the details view and for diagnosis. */
  line: string
  /* An i18n key when the failure is one we recognise (see download-error). */
  errorKey: string
  /* yt-dlp's own words, for the failures we do not. */
  errorDetail: string
  savedPath: string
  createdAt: number
  finishedAt: number
}

export type DownloadRecords = Record<string, DownloadRecord>

/* One at a time: yt-dlp is CPU-bound while it merges, and two of them on a
 * phone make both slower without finishing any sooner. */
export const MAX_ACTIVE_DOWNLOADS = 1

export const downloadId = (url: string, formatId: string) => `${url}::${formatId}`

const FINISHED: DownloadStatus[] = ['done', 'error', 'canceled']

export const isFinished = (record: DownloadRecord) => FINISHED.includes(record.status)
export const isActive = (record: DownloadRecord) => record.status === 'downloading'

export function createRecord(input: {
  url: string
  title: string
  formatId: string
  formatLabel: string
  now?: number
}): DownloadRecord {
  return {
    id: downloadId(input.url, input.formatId),
    url: input.url,
    title: input.title,
    formatId: input.formatId,
    formatLabel: input.formatLabel,
    status: 'queued',
    progress: 0,
    etaSeconds: 0,
    line: '',
    errorKey: '',
    errorDetail: '',
    savedPath: '',
    createdAt: input.now ?? Date.now(),
    finishedAt: 0,
  }
}

/* Newest first, and never mid-list: something still running or waiting belongs
 * above the pile of finished ones however long ago it was started. */
export function sortRecords(records: DownloadRecords): DownloadRecord[] {
  return Object.values(records).sort((a, b) => {
    const aDone = isFinished(a) ? 1 : 0
    const bDone = isFinished(b) ? 1 : 0
    if (aDone !== bDone) {
      return aDone - bDone
    }
    return b.createdAt - a.createdAt
  })
}

export const activeCount = (records: DownloadRecords) => Object.values(records).filter(isActive).length

/* The download to start next, or nothing while the slots are full. Oldest
 * queued first, so the queue is a queue. */
export function nextQueued(records: DownloadRecords, maxActive = MAX_ACTIVE_DOWNLOADS): DownloadRecord | undefined {
  if (activeCount(records) >= maxActive) {
    return undefined
  }
  return Object.values(records)
    .filter((record) => record.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)[0]
}

/* A native progress event folded onto the record it belongs to. Returns the
 * updated record, or nothing when the event is for a download that is gone or
 * already finished -- a cancelled download's last events still arrive. */
export function applyProgress(
  record: DownloadRecord | undefined,
  payload: ProgressPayload,
  now = Date.now(),
): DownloadRecord | undefined {
  if (!record || isFinished(record)) {
    return undefined
  }
  const line = payload.line || record.line
  if (!payload.done) {
    return {
      ...record,
      status: 'downloading',
      // yt-dlp reports 0 at the start of each stage; keep the bar from walking
      // backwards when it moves from video to audio to merge.
      progress: Math.max(record.progress, Math.round(payload.progress ?? 0)),
      etaSeconds: Math.max(0, Math.round(payload.eta ?? 0)),
      line,
    }
  }
  if (payload.error) {
    const { messageKey, detail } = describeDownloadError(line)
    return {
      ...record,
      status: 'error',
      etaSeconds: 0,
      line,
      errorKey: messageKey ?? '',
      errorDetail: detail,
      finishedAt: now,
    }
  }
  return {
    ...record,
    status: 'done',
    progress: 100,
    etaSeconds: 0,
    line,
    errorKey: '',
    errorDetail: '',
    savedPath: payload.filePath ?? record.savedPath,
    finishedAt: now,
  }
}

/* Back to the queue, as if it had just been asked for. */
export function retriedRecord(record: DownloadRecord, now = Date.now()): DownloadRecord {
  return {
    ...record,
    status: 'queued',
    progress: 0,
    etaSeconds: 0,
    line: '',
    errorKey: '',
    errorDetail: '',
    savedPath: '',
    createdAt: now,
    finishedAt: 0,
  }
}

export function canceledRecord(record: DownloadRecord, now = Date.now()): DownloadRecord {
  return { ...record, status: 'canceled', etaSeconds: 0, finishedAt: now }
}

/* Anything that was running when the app was last closed cannot still be
 * running now: the process died with it. Left as they were, they would sit at
 * "downloading" for ever and hold the queue's only slot. */
export function reconcileOnLoad(records: DownloadRecords, now = Date.now()): DownloadRecords {
  const reconciled: DownloadRecords = {}
  for (const [id, record] of Object.entries(records || {})) {
    if (!record?.id) {
      continue
    }
    reconciled[id] =
      record.status === 'downloading' || record.status === 'queued'
        ? { ...record, status: 'canceled', etaSeconds: 0, finishedAt: record.finishedAt || now }
        : record
  }
  return reconciled
}

export function withoutFinished(records: DownloadRecords): DownloadRecords {
  const kept: DownloadRecords = {}
  for (const [id, record] of Object.entries(records)) {
    if (!isFinished(record)) {
      kept[id] = record
    }
  }
  return kept
}

/* "2:05 left", but as parts -- the wording belongs to the UI. */
export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return ''
  }
  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
