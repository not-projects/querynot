import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const publicKeyDerPrefix = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {string} encoded @param {string} label */
function decodeCanonicalBase64(encoded, label) {
  const value = encoded.trim();
  requireCondition(
    /^[A-Za-z0-9+/]+={0,2}$/.test(value),
    `${label} is not canonical base64`
  );
  const decoded = Buffer.from(value, 'base64');
  requireCondition(
    decoded.toString('base64') === value,
    `${label} is not canonical base64`
  );
  return decoded;
}

/** @param {Buffer} raw */
function ed25519PublicKey(raw) {
  requireCondition(raw.length === 32, 'updater public key has the wrong size');
  return createPublicKey({
    key: Buffer.concat([publicKeyDerPrefix, raw]),
    format: 'der',
    type: 'spki'
  });
}

/**
 * Verify the same Minisign envelope consumed by tauri-plugin-updater. Tauri
 * stores both the public-key document and `.sig` document as canonical base64.
 *
 * @param {{payload?: Buffer, installer?: Buffer, signature: string, publicKey: string}} input
 */
export function verifyUpdaterSignature({
  payload,
  installer,
  signature,
  publicKey
}) {
  const updaterPayload = payload ?? installer;
  requireCondition(
    Buffer.isBuffer(updaterPayload) && updaterPayload.length > 0,
    'updater payload is empty'
  );

  const publicDocument = decodeCanonicalBase64(
    publicKey,
    'QUERYNOT_UPDATER_PUBLIC_KEY'
  ).toString('utf8');
  const publicLines = publicDocument.trimEnd().split('\n');
  requireCondition(
    publicLines.length === 2 &&
      /^untrusted comment: minisign public key: [A-Fa-f0-9]{16}$/.test(
        publicLines[0]
      ),
    'QUERYNOT_UPDATER_PUBLIC_KEY is not a Minisign public-key document'
  );
  const publicPacket = decodeCanonicalBase64(
    publicLines[1],
    'Minisign public-key packet'
  );
  requireCondition(
    publicPacket.length === 42 &&
      (publicPacket.subarray(0, 2).equals(Buffer.from('Ed')) ||
        publicPacket.subarray(0, 2).equals(Buffer.from('ED'))),
    'Minisign public-key packet is invalid'
  );

  const signatureDocument = decodeCanonicalBase64(
    signature,
    'updater signature'
  ).toString('utf8');
  const signatureLines = signatureDocument.trimEnd().split('\n');
  requireCondition(
    signatureLines.length === 4 &&
      signatureLines[0].startsWith('untrusted comment: ') &&
      signatureLines[2].startsWith('trusted comment: '),
    'updater signature is not a Minisign signature document'
  );
  const signaturePacket = decodeCanonicalBase64(
    signatureLines[1],
    'Minisign signature packet'
  );
  const globalSignature = decodeCanonicalBase64(
    signatureLines[3],
    'Minisign global signature'
  );
  requireCondition(
    signaturePacket.length === 74 && globalSignature.length === 64,
    'Minisign signature packet has the wrong size'
  );
  const algorithm = signaturePacket.subarray(0, 2).toString('ascii');
  requireCondition(
    algorithm === 'ED' || algorithm === 'Ed',
    'Minisign signature algorithm is unsupported'
  );
  requireCondition(
    timingSafeEqual(
      publicPacket.subarray(2, 10),
      signaturePacket.subarray(2, 10)
    ),
    'updater signature key ID does not match QUERYNOT_UPDATER_PUBLIC_KEY'
  );

  const publicKeyObject = ed25519PublicKey(publicPacket.subarray(10, 42));
  const installerSignature = signaturePacket.subarray(10, 74);
  const signedInstaller =
    algorithm === 'ED'
      ? createHash('blake2b512').update(updaterPayload).digest()
      : updaterPayload;
  requireCondition(
    verify(null, signedInstaller, publicKeyObject, installerSignature),
    'updater payload signature does not verify with QUERYNOT_UPDATER_PUBLIC_KEY'
  );

  const trustedComment = signatureLines[2].slice('trusted comment: '.length);
  requireCondition(
    verify(
      null,
      Buffer.concat([installerSignature, Buffer.from(trustedComment, 'utf8')]),
      publicKeyObject,
      globalSignature
    ),
    'updater trusted-comment signature does not verify with QUERYNOT_UPDATER_PUBLIC_KEY'
  );

  return {
    status: 'pass',
    format: 'minisign',
    algorithm: algorithm === 'ED' ? 'Ed25519-BLAKE2b' : 'Ed25519-legacy',
    public_key_id: publicLines[0].slice(-16).toUpperCase()
  };
}

function main() {
  const [payloadPath, signaturePath] = process.argv.slice(2);
  requireCondition(
    payloadPath && signaturePath,
    'usage: node scripts/verify-updater-signature.mjs <payload> <signature>'
  );
  const publicKey = process.env.QUERYNOT_UPDATER_PUBLIC_KEY?.trim();
  requireCondition(
    publicKey,
    'QUERYNOT_UPDATER_PUBLIC_KEY is required to verify the updater signature'
  );
  const result = verifyUpdaterSignature({
    payload: readFileSync(resolve(payloadPath)),
    signature: readFileSync(resolve(signaturePath), 'utf8').trim(),
    publicKey
  });
  process.stdout.write(
    `verified ${result.algorithm} updater signature with public key ${result.public_key_id}\n`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  main();
