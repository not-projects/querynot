import { existsSync, lstatSync, readdirSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const architectureSuffixes = new Map([
  ['x64', 'x64'],
  ['arm64', 'aarch64']
]);

/**
 * @param {string} directory
 * @param {string} [arch]
 */
export function normalizeMacosUpdaterArtifacts(directory, arch = process.arch) {
  const suffix = architectureSuffixes.get(arch);
  if (!suffix) {
    throw new Error(`unsupported macOS updater architecture: ${arch}`);
  }

  const root = resolve(directory);
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('macOS updater bundle path must be a real directory');
  }

  const entries = readdirSync(root, { withFileTypes: true });
  const payloadEntries = entries.filter((entry) =>
    entry.name.endsWith('.app.tar.gz')
  );
  if (payloadEntries.length !== 1) {
    throw new Error(
      `expected exactly one macOS updater archive; found ${payloadEntries.length}`
    );
  }

  const payloadEntry = payloadEntries[0];
  if (!payloadEntry.isFile() || payloadEntry.isSymbolicLink()) {
    throw new Error('macOS updater archive must be a regular file');
  }
  const signatureName = `${payloadEntry.name}.sig`;
  const signatureEntry = entries.find((entry) => entry.name === signatureName);
  if (
    !signatureEntry ||
    !signatureEntry.isFile() ||
    signatureEntry.isSymbolicLink()
  ) {
    throw new Error('macOS updater archive signature is missing or invalid');
  }

  const baseName = payloadEntry.name.slice(0, -'.app.tar.gz'.length);
  const payloadName = `${baseName}_${suffix}.app.tar.gz`;
  const normalizedSignatureName = `${payloadName}.sig`;
  const payloadPath = resolve(root, payloadEntry.name);
  const signaturePath = resolve(root, signatureName);
  const normalizedPayloadPath = resolve(root, payloadName);
  const normalizedSignaturePath = resolve(root, normalizedSignatureName);
  if (
    existsSync(normalizedPayloadPath) ||
    existsSync(normalizedSignaturePath)
  ) {
    throw new Error('normalized macOS updater artifact already exists');
  }

  renameSync(payloadPath, normalizedPayloadPath);
  renameSync(signaturePath, normalizedSignaturePath);
  return { payloadName, signatureName: normalizedSignatureName };
}
