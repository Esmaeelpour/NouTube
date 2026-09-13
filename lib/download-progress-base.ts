export type ProgressPayload = {
  /* The download this belongs to (see lib/download-queue). Absent from shells
   * that predate the manager, where the URL is the only handle. */
  id?: string
  url: string
  line: string
  done: boolean
  error?: boolean
  filePath?: string
  progress?: number
  eta?: number
}

type ProgressListener = (payload: ProgressPayload) => void

const listeners = new Set<ProgressListener>()

export function onDownloadProgress(fn: ProgressListener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function downloadProgress(payload: ProgressPayload) {
  listeners.forEach((listener) => listener(payload))
}
