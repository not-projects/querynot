export const QUERYNOT_UPDATE_ENDPOINT =
  'https://github.com/not-projects/querynot/releases/latest/download/latest.json';

/**
 * Produce the Tauri CLI overlay required when updater artifacts are enabled.
 * The caller validates the signing environment first; keeping this overlay
 * ephemeral makes the Actions repository variable the sole public-key source.
 *
 * @param {string | undefined} publicKey
 */
export function updaterBuildConfig(publicKey) {
  const normalized = publicKey?.trim();
  if (!normalized) {
    throw new Error(
      'QUERYNOT_UPDATER_PUBLIC_KEY is required for the Tauri updater build configuration'
    );
  }

  return JSON.stringify({
    plugins: {
      updater: {
        endpoints: [QUERYNOT_UPDATE_ENDPOINT],
        pubkey: normalized
      }
    }
  });
}
