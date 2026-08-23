import { resolve } from 'node:path';

/**
 * Validate the dedicated QueryNot updater identity without printing key
 * material. The public key is safe to distribute, but keeping diagnostics to
 * presence and shape avoids accidental secret-adjacent logging in CI.
 *
 * @param {NodeJS.ProcessEnv} environment
 */
export function validateUpdaterSigningEnvironment(environment) {
  const publicKey = environment.QUERYNOT_UPDATER_PUBLIC_KEY?.trim();
  const privateKey = environment.TAURI_SIGNING_PRIVATE_KEY?.trim();
  if (!publicKey) {
    throw new Error(
      'QUERYNOT_UPDATER_PUBLIC_KEY is required for signed cross-platform release packaging'
    );
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) {
    throw new Error(
      'QUERYNOT_UPDATER_PUBLIC_KEY is not a canonical base64 minisign public key'
    );
  }
  let decoded;
  try {
    decoded = Buffer.from(publicKey, 'base64').toString('utf8');
  } catch {
    throw new Error(
      'QUERYNOT_UPDATER_PUBLIC_KEY could not be decoded as a minisign public key'
    );
  }
  if (Buffer.from(decoded, 'utf8').toString('base64') !== publicKey) {
    throw new Error(
      'QUERYNOT_UPDATER_PUBLIC_KEY is not a canonical base64 minisign public key'
    );
  }
  const lines = decoded.trimEnd().split('\n');
  if (
    lines.length !== 2 ||
    !/^untrusted comment: minisign public key: [A-Fa-f0-9]{16}$/.test(
      lines[0]
    ) ||
    !/^RW[A-Za-z0-9+/]{50,}={0,2}$/.test(lines[1])
  ) {
    throw new Error(
      'QUERYNOT_UPDATER_PUBLIC_KEY does not contain the expected minisign public-key document'
    );
  }
  if (!privateKey || privateKey.length < 32) {
    throw new Error(
      'TAURI_SIGNING_PRIVATE_KEY is required for signed cross-platform release packaging'
    );
  }
  return {
    public_key_configured: true,
    private_key_configured: true,
    private_key_password_configured: Boolean(
      environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    )
  };
}

function main() {
  const result = validateUpdaterSigningEnvironment(process.env);
  process.stdout.write(
    `QueryNot cross-platform updater signing environment is configured${
      result.private_key_password_configured
        ? ' with a protected private key'
        : ''
    }.\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  main();
}
