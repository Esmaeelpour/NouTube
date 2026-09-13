import { describe, expect, it } from 'bun:test'
import {
  applyProgress,
  canceledRecord,
  createRecord,
  downloadId,
  formatEta,
  nextQueued,
  reconcileOnLoad,
  retriedRecord,
  sortRecords,
  withoutFinished,
  type DownloadRecords,
} from './download-queue'

const make = (formatId: string, over: Partial<ReturnType<typeof createRecord>> = {}) => ({
  ...createRecord({
    url: 'https://m.youtube.com/watch?v=abc123',
    title: 'A video',
    formatId,
    formatLabel: formatId,
    now: 1000,
  }),
  ...over,
})

const asRecords = (...records: ReturnType<typeof make>[]): DownloadRecords =>
  Object.fromEntries(records.map((record) => [record.id, record]))

describe('identity', () => {
  it('tells two formats of the same video apart', () => {
    expect(downloadId('https://x/watch?v=1', '137')).not.toBe(downloadId('https://x/watch?v=1', '140'))
    expect(make('137').id).not.toBe(make('140').id)
  })
})

describe('nextQueued', () => {
  it('takes the oldest queued download', () => {
    const records = asRecords(make('137', { createdAt: 3000 }), make('140', { createdAt: 2000 }))
    expect(nextQueued(records)?.formatId).toBe('140')
  })

  it('waits while a download is running', () => {
    const records = asRecords(make('137', { status: 'downloading' }), make('140'))
    expect(nextQueued(records)).toBeUndefined()
  })

  it('does not count finished downloads against the limit', () => {
    const records = asRecords(make('137', { status: 'done' }), make('140'))
    expect(nextQueued(records)?.formatId).toBe('140')
  })
})

describe('applyProgress', () => {
  it('moves a queued download to downloading and keeps the highest percent', () => {
    const started = applyProgress(make('137'), { url: 'u', line: '50%', done: false, progress: 50 })
    expect(started?.status).toBe('downloading')
    expect(started?.progress).toBe(50)
    // yt-dlp restarts at 0 for the audio stream and again for the merge.
    const later = applyProgress(started, { url: 'u', line: '0%', done: false, progress: 0 })
    expect(later?.progress).toBe(50)
  })

  it('records the saved path on success', () => {
    const done = applyProgress(make('137'), {
      url: 'u',
      line: 'done',
      done: true,
      filePath: 'content://downloads/1',
    })
    expect(done?.status).toBe('done')
    expect(done?.progress).toBe(100)
    expect(done?.savedPath).toBe('content://downloads/1')
  })

  it('classifies a failure it recognises', () => {
    const failed = applyProgress(make('137'), {
      url: 'u',
      line: 'ERROR: Sign in to confirm you are not a bot',
      done: true,
      error: true,
    })
    expect(failed?.status).toBe('error')
    expect(failed?.errorKey).toBe('modals.downloadErrorSignIn')
    expect(failed?.errorDetail).toContain('Sign in to confirm')
  })

  it('ignores events for a download that already finished', () => {
    expect(applyProgress(make('137', { status: 'canceled' }), { url: 'u', line: '60%', done: false })).toBeUndefined()
    expect(applyProgress(undefined, { url: 'u', line: '60%', done: false })).toBeUndefined()
  })
})

describe('retry and cancel', () => {
  it('clears the error and the progress on retry', () => {
    const failed = make('137', { status: 'error', progress: 40, errorKey: 'modals.downloadErrorBlocked' })
    const retried = retriedRecord(failed, 5000)
    expect(retried.status).toBe('queued')
    expect(retried.progress).toBe(0)
    expect(retried.errorKey).toBe('')
    // Re-queued now, so it goes behind whatever is already waiting.
    expect(retried.createdAt).toBe(5000)
  })

  it('finishes a cancelled download', () => {
    const canceled = canceledRecord(make('137', { status: 'downloading' }), 5000)
    expect(canceled.status).toBe('canceled')
    expect(canceled.finishedAt).toBe(5000)
  })
})

describe('reconcileOnLoad', () => {
  it('does not leave a download running across a restart', () => {
    const records = asRecords(
      make('137', { status: 'downloading' }),
      make('140', { status: 'queued' }),
      make('251', { status: 'done', finishedAt: 42 }),
    )
    const loaded = reconcileOnLoad(records, 9000)
    expect(loaded[make('137').id].status).toBe('canceled')
    expect(loaded[make('140').id].status).toBe('canceled')
    expect(loaded[make('251').id].status).toBe('done')
    expect(loaded[make('251').id].finishedAt).toBe(42)
  })

  it('survives junk in storage', () => {
    expect(reconcileOnLoad({ bad: undefined as any })).toEqual({})
    expect(reconcileOnLoad(undefined as any)).toEqual({})
  })
})

describe('listing', () => {
  it('keeps unfinished downloads above finished ones, newest first', () => {
    const records = asRecords(
      make('137', { status: 'done', createdAt: 5000 }),
      make('140', { status: 'queued', createdAt: 1000 }),
      make('251', { status: 'downloading', createdAt: 2000 }),
    )
    expect(sortRecords(records).map((record) => record.formatId)).toEqual(['251', '140', '137'])
  })

  it('clears only the finished ones', () => {
    const records = asRecords(make('137', { status: 'done' }), make('140', { status: 'downloading' }))
    expect(Object.values(withoutFinished(records)).map((record) => record.formatId)).toEqual(['140'])
  })
})

describe('formatEta', () => {
  it('reads as a clock', () => {
    expect(formatEta(45)).toBe('0:45')
    expect(formatEta(125)).toBe('2:05')
    expect(formatEta(3725)).toBe('1:02:05')
  })

  it('says nothing when there is nothing to say', () => {
    expect(formatEta(0)).toBe('')
    expect(formatEta(-1)).toBe('')
    expect(formatEta(NaN)).toBe('')
  })
})
