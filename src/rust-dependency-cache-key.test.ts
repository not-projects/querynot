import { describe, expect, it } from 'vitest';

import {
  normalizeCargoLock,
  normalizeCargoManifest,
  rustDependencyCacheKey
} from '../scripts/rust-dependency-cache-key.mjs';

describe('Rust dependency cache key', () => {
  it('ignores workspace and internal path version bumps', () => {
    const before = `[workspace.package]
version = "0.1.8"
edition = "2024"

[dependencies]
querynot-core = { path = "../querynot-core", version = "0.1.8" }
serde = "1.0.229"
`;
    const after = before.replaceAll('0.1.8', '0.1.9');

    expect(normalizeCargoManifest(before)).toBe(normalizeCargoManifest(after));
  });

  it('retains external dependency and feature changes', () => {
    const baseline = `[dependencies]
serde = { version = "1.0.229", features = ["derive"] }
`;

    expect(normalizeCargoManifest(baseline)).not.toBe(
      normalizeCargoManifest(baseline.replace('1.0.229', '1.0.230'))
    );
    expect(normalizeCargoManifest(baseline)).not.toBe(
      normalizeCargoManifest(baseline.replace('"derive"', '"std"'))
    );
  });

  it('excludes workspace packages but retains registry packages from Cargo.lock', () => {
    const lockfile = `# generated
version = 4

[[package]]
name = "querynot"
version = "0.1.8"
dependencies = ["serde"]

[[package]]
name = "serde"
version = "1.0.229"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "abc"
`;

    expect(normalizeCargoLock(lockfile)).not.toContain('name = "querynot"');
    expect(normalizeCargoLock(lockfile)).toContain('name = "serde"');
  });

  it('produces a deterministic repository key', () => {
    const environment = { RUSTFLAGS: '-C target-cpu=x86-64' };
    expect(rustDependencyCacheKey(undefined, environment)).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(rustDependencyCacheKey(undefined, environment)).toBe(
      rustDependencyCacheKey(undefined, environment)
    );
    expect(rustDependencyCacheKey(undefined, environment)).not.toBe(
      rustDependencyCacheKey(undefined, {
        RUSTFLAGS: '-C target-cpu=x86-64-v2'
      })
    );
  });
});
