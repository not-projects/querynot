import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import type {
  AvailableUpdateView,
  UpdateDownloadProgressView
} from './generated/contracts';
import { hasNativeRuntime, invokeCommand } from './native';

type UpdaterPhase = 'idle' | 'checking' | 'installing' | 'handoff';

export function updateProgressPercent(
  progress: UpdateDownloadProgressView | null
): number | null {
  if (!progress?.content_length || progress.content_length <= 0) return null;
  return Math.min(
    100,
    Math.round((progress.downloaded_bytes / progress.content_length) * 100)
  );
}

export function formatUpdateBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function safeUpdaterError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'safe_message' in error) {
    const message = (error as { safe_message?: unknown }).safe_message;
    if (typeof message === 'string') return message;
  }
  return 'The signed update operation did not complete. The current installation remains available.';
}

class UpdaterState {
  phase = $state<UpdaterPhase>('idle');
  configured = $state<boolean | null>(null);
  availableUpdate = $state<AvailableUpdateView | null>(null);
  progress = $state<UpdateDownloadProgressView | null>(null);
  errorText = $state<string | null>(null);
  lastCheckedAt = $state<number | null>(null);

  private initialized = false;
  private silentCheckAttempted = false;
  private unlisten: UnlistenFn | null = null;

  get isChecking(): boolean {
    return this.phase === 'checking';
  }

  get isInstalling(): boolean {
    return this.phase === 'installing' || this.phase === 'handoff';
  }

  get progressPercent(): number | null {
    return updateProgressPercent(this.progress);
  }

  get progressLabel(): string | null {
    if (!this.progress) return null;
    const downloaded = formatUpdateBytes(this.progress.downloaded_bytes);
    if (!this.progress.content_length) return `${downloaded} downloaded`;
    return `${downloaded} of ${formatUpdateBytes(this.progress.content_length)}`;
  }

  async initialize(): Promise<void> {
    if (this.initialized || !hasNativeRuntime()) return;
    this.initialized = true;
    try {
      this.unlisten = await listen<UpdateDownloadProgressView>(
        'update_download_progress',
        (event) => {
          this.progress = event.payload;
        }
      );
    } catch {
      this.initialized = false;
    }
  }

  async checkSilently(): Promise<void> {
    if (this.silentCheckAttempted || !hasNativeRuntime()) return;
    this.silentCheckAttempted = true;
    await this.check(false);
  }

  async checkManually(): Promise<void> {
    await this.check(true);
  }

  async install(
    prepareForApplicationExit: () => Promise<void>
  ): Promise<string> {
    if (!this.availableUpdate) {
      throw new Error('Check for a signed update before installing it.');
    }
    this.phase = 'installing';
    this.progress = null;
    this.errorText = null;
    try {
      await prepareForApplicationExit();
      const response = await invokeCommand('install_update', {
        confirmed: true
      });
      this.phase = 'handoff';
      return response.message;
    } catch (error) {
      this.phase = 'idle';
      this.errorText = safeUpdaterError(error);
      throw error;
    }
  }

  dispose(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.initialized = false;
  }

  private async check(reportError: boolean): Promise<void> {
    if (!hasNativeRuntime() || this.isInstalling) return;
    this.phase = 'checking';
    if (reportError) this.errorText = null;
    try {
      const response = await invokeCommand('check_for_updates', null);
      this.configured = response.configured;
      this.availableUpdate = response.update;
      this.lastCheckedAt = Date.now();
    } catch (error) {
      if (reportError) this.errorText = safeUpdaterError(error);
    } finally {
      this.phase = 'idle';
    }
  }
}

export const updater = new UpdaterState();
