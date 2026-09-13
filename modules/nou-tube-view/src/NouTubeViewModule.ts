import { NativeModule, requireNativeModule } from 'expo'

declare class NouTubeViewModule extends NativeModule {
  executeJavaScript(script: string): Promise<string>
  executeJavaScriptAsync(script: string): Promise<string>
  loadUrl(url: string): void
  goBack(): Promise<void>
  /* Whether goBack would step back a page rather than leave the app. */
  canGoBack(): Promise<boolean>
  /* Pin the video this view is playing to a floating window, answering false
   * when there is nothing to pin (see NouPictureInPicture.enterNow). */
  enterPictureInPicture(): Promise<boolean>
  /* Point the media notification and the system media controls at this view.
   * Only meaningful with more than one view alive (see lib/split-view.ts). */
  claimMediaSession(): Promise<void>
  fetchFeed(url: string): Promise<{ ok: boolean; status: number; statusText: string; body: string }>
  setSettings(settings: {
    proxyEnabled?: boolean
    proxyType?: 'http' | 'socks'
    proxyHost?: string
    proxyPort?: string
    showMediaNotificationPrevButton?: boolean
    showMediaNotificationNextButton?: boolean
    showMediaNotificationRewindButton?: boolean
    showMediaNotificationForwardButton?: boolean
    showMediaNotificationSpeedButton?: boolean
    showMediaNotificationCloseButton?: boolean
    playbackRate?: number
    blockAds?: boolean
  }): void
  extractTakeoutCsvFiles(uri: string): Promise<Array<{ name: string; uri: string }>>
  setSleepTimer(durationMs: number): Promise<void>
  clearSleepTimer(): Promise<void>
  getSleepTimerRemainingMs(): Promise<number | null>
  listFormats(
    url: string,
    useCookies: boolean,
  ): Promise<{ title: string; formats: Array<{ formatId: string; label: string; description: string }> }>
  downloadVideo(
    url: string,
    formatId: string,
    outputDir: string,
    useCookies: boolean,
    downloadId: string,
  ): Promise<void>
  /* Kills the yt-dlp process of a running download; false when it had already
   * finished on its own. */
  cancelDownload(downloadId: string): Promise<boolean>
  getDownloadsPath(): Promise<string>
  updateYtDlp(): Promise<void>
  setLocaleStrings(strings: Record<string, string>): void
  getSystemCaptionStyle(): {
    enabled: boolean
    fontScale: number
    locale?: string | null
    foregroundColor?: number | null
    backgroundColor?: number | null
    windowColor?: number | null
    edgeType?: number | null
    edgeColor?: number | null
  }
  isSystemDesktopMode(): boolean
  translateText(text: string, targetLanguage: string): Promise<{ text: string; sourceLanguage?: string }>
  getTranslationSupportedLanguages(): string[]
}

export default requireNativeModule<NouTubeViewModule>('NouTubeView')
