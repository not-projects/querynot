# Compatibility and conformance matrix

Status: QueryNot 0.1.12 current live cross-platform release
Selection date: 2026-08-27

Version `0.1.12` is the current live release for Windows 11 x86-64, Linux x86-64, and macOS 13 or later on Intel and Apple silicon under ADR 0016. Its dedicated QueryNot updater key, exact-candidate publication, draft and public GitHub asset-digest checks, stable updater-endpoint hashes, and Ed25519-BLAKE2b signature checks passed for every platform payload. Historical `0.1.0` and `0.1.1` evidence remains immutable.

The rows below describe the live `0.1.12` publication matrix after the exact multi-platform candidate, GitHub draft/public digest checks, and bounded updater-endpoint smoke test passed. The optional full-package public deep audit was intentionally skipped for this fast patch shipment. Phase 5 continues to describe the historical `0.1.0` Windows-only boundary, and `evidence/release-updates/0.1.1` retains the first signed-channel records. Native hardware, vault, accessibility, performance, dogfood, and beta observations remain explicit follow-up evidence until performed.

## MySQL 5.7 compatibility in 0.1.12

The live `0.1.12` release recognizes every well-formed MySQL `5.7.x` identity as the legacy 5.7 compatibility line and keeps ordinary query writes, manual transactions, destructive-statement confirmation, and safe staged row mutations enabled. Non-5.7.44 patches state that 5.7.44 remains the exact automated conformance fixture. Malformed identities and unrecognized MySQL/MariaDB lines remain query-only; the passing `0.1.12` candidate feasibility gate exercises 5.7.44 and does not represent every 5.7 patch as independently certified.

## Application platforms

| Matrix ID | Operating system | Architecture | Web runtime/package | Current status |
| --- | --- | --- | --- | --- |
| `windows-11-x64` | Windows 11 | x86-64 | Microsoft Edge WebView2; NSIS + MSI | Current live `0.1.12` distribution row |
| `windows-10-22h2-x64` | Windows 10 22H2 | x86-64 | WebView2; NSIS + MSI | Deferred; no `0.1.12` support claim |
| `macos-13-intel` | macOS 13 or later | Intel | System WebKit; x86-64 DMG; candidate built on `macos-15-intel` | Current live `0.1.12` distribution row; Apple notarization is not claimed |
| `macos-13-apple` | macOS 13 or later | Apple silicon | System WebKit; aarch64 DMG; candidate built on `macos-15` | Current live `0.1.12` distribution row; Apple notarization is not claimed |
| `linux-x64` | Linux x86-64 | x86-64 | WebKitGTK 4.1; AppImage + Debian + RPM; candidate built on Ubuntu 22.04 | Current live `0.1.12` distribution row; unlisted distro/runtime combinations are not blanket-certified |
| `ubuntu-24.04-x64` | Ubuntu 24.04 LTS | x86-64 | WebKitGTK 4.1; portable compile check | Compile coverage retained; native package observation remains follow-up evidence |

## Database fixtures

| Matrix ID | Exact selected patch | Authentication | TLS | Lifecycle | Current evidence |
| --- | --- | --- | --- | --- | --- |
| `sqlite-bundled` | 3.51.3 through SQLx/libsqlite3-sys in the release build | File permissions | Not applicable | Current bundled library | Phase 2 query journey, Phase 4 keyed editing contract, and the Windows release build pass |
| `mysql-5.7.44` | 5.7.44 | `mysql_native_password` | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy/EOL; persistent warning required | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mysql-8.0.46` | 8.0.46 | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Legacy line at selection date | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mysql-8.4.10` | 8.4.10 LTS | `caching_sha2_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mariadb-10.11.18` | 10.11.18 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |
| `mariadb-11.4.12` | 11.4.12 LTS | `mysql_native_password` over protected transport | Custom-CA identity verification and client certificate at TLS 1.2 pass; system trust rejects the private fixture CA | Maintained LTS | Phase 5 local candidate conformance passes the full adapter/table contract |

MySQL 8.0 reached the lifecycle date identified by the vendor before this selection date; it is treated like a legacy compatibility line in UI/release notes even though the approved PRD separately calls out the mandatory 5.7 indicator. No safety control is weakened for either line.

The retained Phase 4 reports cover the full Phase 3 contract plus deterministic keyset paging, labelled read-only fallbacks in the local planner, bound hostile structured filters, typed validation, insert/update/delete, generated-value refresh, optimistic conflicts, and atomic rollback. Positive system-trust validation against a publicly trusted target and native Windows trust-store behavior remain post-release owner observations; fixture automation intentionally never contacts a non-fixture database.

## Current live signed 0.1.12 release

- Release: [`v0.1.12`](https://github.com/not-projects/querynot/releases/tag/v0.1.12)
- Candidate run: [`33077747652`](https://github.com/not-projects/querynot/actions/runs/33077747652)
- Publication run: [`33079149205`](https://github.com/not-projects/querynot/actions/runs/33079149205)
- Source commit: `c0cff8b4364c19a3364d55fbeb8bb55bcbac52e7`
- Public verification: GitHub's byte-size and SHA-256 records for all 18 public assets match the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`
- Verification scope: routine publication gates passed; the optional full-package public deep audit was intentionally not run

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.12_x64-setup.exe` | 3,402,799 | `7a0cd5d726217c1ea6f3c866712f53a0520ff22ba79451605edd8495b392b5a8` |
| Windows MSI | `QueryNot_0.1.12_x64_en-US.msi` | 4,550,656 | `cff428d9b461aa08165e839353beae249456d9174c16dbf412f48d750cbec219` |
| Linux AppImage | `QueryNot_0.1.12_amd64.AppImage` | 82,188,792 | `8296d98dacfc87e3dae515d3a14388d5457932a5c5a023b0ca075d623d5c119b` |
| Linux DEB | `QueryNot_0.1.12_amd64.deb` | 4,665,426 | `76d87c2dd003d9299dd312b87bb729d15d90fce60a946dc48f641af34cab8c9f` |
| Linux RPM | `QueryNot-0.1.12-1.x86_64.rpm` | 4,666,164 | `e32c539fe0a92701c1db3a16477976ba678a1e95a45dee15582c4d4047380825` |
| macOS Intel DMG | `QueryNot_0.1.12_x64.dmg` | 4,288,809 | `792068faaaef997f72d49a5fe475176ddd988555bc1749345fcbff1e93034bff` |
| macOS Apple-silicon DMG | `QueryNot_0.1.12_aarch64.dmg` | 3,957,132 | `1c5d4cf1cc1b4b389fb25b0ef72f7fbe4c6523c494100aee09c99c0bfbdf59a0` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,279,985 | `cb4d2cc29a91b26deb4996f33d2a700f60a0afc627283bf0ff5103b9d463c808` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,980,742 | `70250528e61b17d6ff0f612e9a9fadc3e99b7168438275b0402bdd4fb2e1b4ac` |

- `latest.json`: 6,864 bytes; SHA-256 `2c4f789af039386e798539ae384d23898de5ca69179649a1b21d9ec7589c6cbf`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 660 bytes; SHA-256 `8f07aa4ccd8dd17ab698c9899c3c5bdb26af735b455b183344f9646b2294b2e6`; all seven installable-package checks pass.

## Previous 0.1.11 signed cross-platform release

- Release: [`v0.1.11`](https://github.com/not-projects/querynot/releases/tag/v0.1.11)
- Candidate run: [`33067804227`](https://github.com/not-projects/querynot/actions/runs/33067804227)
- Publication run: [`33069003334`](https://github.com/not-projects/querynot/actions/runs/33069003334)
- Source commit: `dc661c15cf0c77bd904e6d3ed4c963bf2b620ebc`
- Public verification: GitHub's byte-size and SHA-256 records for all 18 public assets match the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`
- Verification scope: routine publication gates passed; the optional full-package public deep audit was intentionally not run

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.11_x64-setup.exe` | 3,402,293 | `e052673f907dc6de545a5b2b6e7753ac6de7dd22b014da02301f37ae5e0417cd` |
| Windows MSI | `QueryNot_0.1.11_x64_en-US.msi` | 4,546,560 | `3561682fd4c9e43d247eb087ee64a2977c262c4019ddd80ed841524b523af88b` |
| Linux AppImage | `QueryNot_0.1.11_amd64.AppImage` | 82,192,888 | `4c4223eb094cd9a6ec1055d937b9eb7ff71664b54a2b3d25cf2e85017dfe0755` |
| Linux DEB | `QueryNot_0.1.11_amd64.deb` | 4,664,544 | `b95efef8fa3ee1771db33e12f2429f811a7fc66c48f0c08e64c428fa5fc12a82` |
| Linux RPM | `QueryNot-0.1.11-1.x86_64.rpm` | 4,665,367 | `d39a9a564e64b0ae02627ca1ac83b799377bfb2a24e7a069fbb967fa13eb9d2f` |
| macOS Intel DMG | `QueryNot_0.1.11_x64.dmg` | 4,289,243 | `1e49491d5f8156bb278f448d0d0e3946346ec723f537b3570a1cf27dae6c8004` |
| macOS Apple-silicon DMG | `QueryNot_0.1.11_aarch64.dmg` | 3,956,560 | `2cdd423c12b0e9bc082555e65019306fa44f6d8c889328bcbc5be050193349e8` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,279,854 | `59280eb974d3d613c2370750a2c7b9eb4c937e4f1077f06121714eb0cb60f434` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,979,846 | `c59ce8873319eaceaf728da804d95f89862368f6a235804fcf42105d31076f98` |

- `latest.json`: 7,029 bytes; SHA-256 `3c8c1147b7ef9d4df338ff8c3fb6f1d0a912b81a38f28aa39c33acd34870a794`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 660 bytes; SHA-256 `28679d86e3ec259f07e225a1b45fd872d523b2cca413585d67ecbfe8c3d844a7`; all seven installable-package checks pass.

## Previous 0.1.10 signed cross-platform release

- Release: [`v0.1.10`](https://github.com/not-projects/querynot/releases/tag/v0.1.10)
- Candidate run: [`33060484825`](https://github.com/not-projects/querynot/actions/runs/33060484825)
- Publication run: [`33061391281`](https://github.com/not-projects/querynot/actions/runs/33061391281)
- Source commit: `69c62df67f987e502effdb1dfca390296fbd0dbd`
- Public verification: GitHub's byte-size and SHA-256 records for all 18 public assets match the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.10_x64-setup.exe` | 3,401,578 | `948dffc1fd698a477dab0148b214005cfb17accd1514455dcafb350684342a6a` |
| Windows MSI | `QueryNot_0.1.10_x64_en-US.msi` | 4,546,560 | `bbccb69a274824892aba4d9c9a43554ec513b276389f4f999b7766f0df8c62c1` |
| Linux AppImage | `QueryNot_0.1.10_amd64.AppImage` | 82,192,888 | `e89ed6e06e57570fe362c1aa5eed019aa85ed5653eaa585b33c6c81e6290bba1` |
| Linux DEB | `QueryNot_0.1.10_amd64.deb` | 4,664,258 | `69f3c34b49021344264920ff03a6226bd2794dd33eed238bcaceafc476c40e0a` |
| Linux RPM | `QueryNot-0.1.10-1.x86_64.rpm` | 4,665,176 | `599050e2e8afac616718356b725449224ad34f522be84cea8093fa7278bdbfb1` |
| macOS Intel DMG | `QueryNot_0.1.10_x64.dmg` | 4,288,527 | `2929a018f874b546f05a2a9c06e5c083b66cc2c42fd54393ab9527b37584c273` |
| macOS Apple-silicon DMG | `QueryNot_0.1.10_aarch64.dmg` | 3,956,131 | `87974dab1379fc26fe50028bc2a0a0066c255378b7f361773d5cb459a7a7b1cb` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,278,902 | `83e799857b867e22bbb56a1fe5e5e1345cc4de5668084432a1405a167a15dbc0` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,979,379 | `a1cd61b2807aa2c7fadaabd872e72cdf326a89c6621708cb4ba5a4bbdb11dbc0` |

- `latest.json`: 7,248 bytes; SHA-256 `28d300193ba84aa41ea5c2dfc04eaa770c4456d6ed0c37dc7c217cc0493a88b2`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 660 bytes; SHA-256 `ff86eb8d5caf710d104e3d8c1b0fdaad11c827c738df5777c7fcf78426725ced`; all seven installable-package checks pass.

## Previous 0.1.9 signed cross-platform release

- Release: [`v0.1.9`](https://github.com/not-projects/querynot/releases/tag/v0.1.9)
- Candidate run: [`32983327124`](https://github.com/not-projects/querynot/actions/runs/32983327124)
- Publication run: [`33006398204`](https://github.com/not-projects/querynot/actions/runs/33006398204)
- Source commit: `753bb44ce099694fdde931ca97f18cf1ec7c84cb`
- Public verification: GitHub's byte-size and SHA-256 records for all 18 public assets match the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.9_x64-setup.exe` | 3,398,332 | `c15a186b012905d00c3c64bb3629746edda1ff9580bf7b35b4b1299eeeaf1699` |
| Windows MSI | `QueryNot_0.1.9_x64_en-US.msi` | 4,546,560 | `da05412c34ef29c1c4e963fc175e2ca33180e347c0a3c780e3654cdb533ec778` |
| Linux AppImage | `QueryNot_0.1.9_amd64.AppImage` | 82,184,696 | `72c525104665f6406a64b5157a5813ef46f7ca6fdedea4d3ccdda795125fd13b` |
| Linux DEB | `QueryNot_0.1.9_amd64.deb` | 4,660,836 | `73b984cdf61827ee552d265fec136a92c88863677d27722b83f7ddcf3966f4b3` |
| Linux RPM | `QueryNot-0.1.9-1.x86_64.rpm` | 4,662,179 | `67a64d96c231812f6aeaac8f75ef9814f262a87ffea0699c5ae4e8dfeda98aa5` |
| macOS Intel DMG | `QueryNot_0.1.9_x64.dmg` | 4,285,644 | `dc04518c0206d8f86e8dbc4a55bfda043aea42ebd0bdfd54999dbcde600c6a4d` |
| macOS Apple-silicon DMG | `QueryNot_0.1.9_aarch64.dmg` | 3,952,799 | `52b16a7093ce10dbf047d00f2c23b09d6aae29d6cc8d2c63313853bba1f827a7` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,275,745 | `aa40dbf23c949c608b2792b4557bad8b0efd8caf7c6ae9231a926fa64a71564e` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,975,050 | `796f4b3f4fc9b9a59110eaf89a7cf0a5fc975b89aa6fd5f7ddafbd351ace8a3f` |

- `latest.json`: 7,629 bytes; SHA-256 `61c503bfbf109bc96dfca9dc2059719adcaaef060074b9ddd60f5c6ac6b975a1`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 653 bytes; SHA-256 `11a55ee4b307c04f97eddaae13aa6a9c94c4ed29d02175b0655c6bae7e30d6ef`; all seven installable-package checks pass.

## Previous 0.1.8 signed cross-platform release

- Release: [`v0.1.8`](https://github.com/not-projects/querynot/releases/tag/v0.1.8)
- Candidate run: [`32957518397`](https://github.com/not-projects/querynot/actions/runs/32957518397)
- Publication run: [`32959627927`](https://github.com/not-projects/querynot/actions/runs/32959627927)
- Source commit: `99512612a493c78619d1b5c6f291ca6ae181b00e`
- Public verification: GitHub's byte-size and SHA-256 records for all 18 public assets match the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.8_x64-setup.exe` | 3,393,827 | `5c25cf5f4c191c168e0357d361bb620fcdd2b7a039a174d50d967c27ba61e593` |
| Windows MSI | `QueryNot_0.1.8_x64_en-US.msi` | 4,538,368 | `32c25cbe540dd5041560ec2c9953c81ea1018c19a4e433886e302d6faa9e1b89` |
| Linux AppImage | `QueryNot_0.1.8_amd64.AppImage` | 82,180,600 | `d31426de41e6b7045c40354cfd9bdf48bacbdd276a2d2f073bb024619f402ce1` |
| Linux DEB | `QueryNot_0.1.8_amd64.deb` | 4,656,752 | `5e10382a35366c10a1b0fa7455af645c38e08c5d41ca17bc26465c5ed56d12cc` |
| Linux RPM | `QueryNot-0.1.8-1.x86_64.rpm` | 4,657,539 | `77ec938a7573bbe2b36180d74506e26b19e91cc48f72fca34ec27f339fa63359` |
| macOS Intel DMG | `QueryNot_0.1.8_x64.dmg` | 4,280,037 | `76970336be47f3c8b96da381437ba38e1884c0752eccaff90176e2b3b3964c3e` |
| macOS Apple-silicon DMG | `QueryNot_0.1.8_aarch64.dmg` | 3,947,760 | `dbba775d973aabbd4cc596f82b63d511528442ea5853e603a4238863e1fc1a44` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,271,955 | `184f03b09cb895ef7f5795564c778a79b420c497fa6add277421751d767130f7` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,971,713 | `d2b5f501f6c1a98a7e50e828b1a2b41d115a84832600f066316226c8bb0b040a` |

- `latest.json`: 7,133 bytes; SHA-256 `d2bfb0dab1bc9f4b38af7b856e1596f875d1a6fb77ae76fb2afaf2ae6d634435`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 653 bytes; SHA-256 `3fee4a88a66a019b506871a2f0904eef9fe2016fc5aba7f26380e202e1080a10`; all seven installable-package checks pass.

## Previous 0.1.7 signed cross-platform release

- Release: [`v0.1.7`](https://github.com/not-projects/querynot/releases/tag/v0.1.7)
- Candidate run: [`32846689294`](https://github.com/not-projects/querynot/actions/runs/32846689294)
- Publication run: [`32850309155`](https://github.com/not-projects/querynot/actions/runs/32850309155)
- Source commit: `3b2b05899737c875d20b2e48cdb0693bef0599e9`
- Public verification: all 18 assets are byte-identical to the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.7_x64-setup.exe` | 3,392,462 | `9e93fca026a1af80aef7fce7ed503b74373026ee697aff12151111c0b41684a6` |
| Windows MSI | `QueryNot_0.1.7_x64_en-US.msi` | 4,538,368 | `f272d22a214f59674f3691b5231a79aaf7a4b3b76f5cfa655f40ef5ffe5a6074` |
| Linux AppImage | `QueryNot_0.1.7_amd64.AppImage` | 82,184,696 | `ab35c13aed2047106801917169da8eefd8c3418a202774c84f59f4684d8c7d93` |
| Linux DEB | `QueryNot_0.1.7_amd64.deb` | 4,654,586 | `c238a0df969214a9b413f6d5355da60233dae6b2cb0a43703c6304509102ad14` |
| Linux RPM | `QueryNot-0.1.7-1.x86_64.rpm` | 4,655,279 | `66ba2bc87ee2e86771671b43149b4532e443b7d1a75c618b6fff07d244c9404f` |
| macOS Intel DMG | `QueryNot_0.1.7_x64.dmg` | 4,281,853 | `59c5a19e9e7de6b9daef5b15b5904ffc10b9f2ebae3b489a6b4383d579c1e6d8` |
| macOS Apple-silicon DMG | `QueryNot_0.1.7_aarch64.dmg` | 3,945,642 | `cc026877dfe15ad3d71238953409e5a82114bbb5e2051aff06c9cd4109643aaa` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,269,618 | `4d5c36724c118738a395b0573ee9c9d7129930cd107cc91e07efa885ab486815` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,969,947 | `ca5dbd07817d208696573cf8ff28fcdc7d8dc14a2f8d5308266cf7044ac9fc8c` |

- `latest.json`: 7,292 bytes; SHA-256 `2bd8394d3ce91bc57f06028bb154ccd8f374274933886dad21b37288f5b9754a`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 653 bytes; SHA-256 `7926f975cfb182b53d5fae9ecc430c502a54b827e6c2f57a5831d8f5618915d7`; all seven installable-package checks pass.

## Previous 0.1.6 signed cross-platform release

- Release: [`v0.1.6`](https://github.com/not-projects/querynot/releases/tag/v0.1.6)
- Candidate run: [`32721015915`](https://github.com/not-projects/querynot/actions/runs/32721015915)
- Publication run: [`32724430634`](https://github.com/not-projects/querynot/actions/runs/32724430634)
- Source commit: `849fb7c27fb7aed87e65da2105ecd8eb74b7edc9`
- Public verification: all 18 assets are byte-identical to the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.6_x64-setup.exe` | 3,389,592 | `4fc2b5fe6176fadd413a8cff3451c9eb1a169a10cfa1dc10967e4e182c5f68f7` |
| Windows MSI | `QueryNot_0.1.6_x64_en-US.msi` | 4,534,272 | `44b0a7484c1f48f927888fad572b28de3746843096ec1cef9e3ca4920a7810ad` |
| Linux AppImage | `QueryNot_0.1.6_amd64.AppImage` | 82,184,696 | `2dffc12fb1b56fcf7488d7c45abb1dc32eacd9473c2f40791943b7fbfa4a8be9` |
| Linux DEB | `QueryNot_0.1.6_amd64.deb` | 4,651,272 | `8f92bd870a84aa1d8656569596ce55d81c0912ce569746c7b742bcf6b8a987a7` |
| Linux RPM | `QueryNot-0.1.6-1.x86_64.rpm` | 4,651,912 | `d6599f8855c1af2868de2b48ca8751a9841eb54d6c4475e4459a0f41676942a7` |
| macOS Intel DMG | `QueryNot_0.1.6_x64.dmg` | 4,279,419 | `ffe59fd2023966080c2d4cfa76f3d11b6ecbb003abcc65a4423a939eee9d5f54` |
| macOS Apple-silicon DMG | `QueryNot_0.1.6_aarch64.dmg` | 3,943,057 | `82d5a39c8a06cbf36dbfdbb92edf652da7dc9d3bde36fc2d9aa53fea477043ac` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,266,393 | `fbf42acf36b1a6d00112592b5cb5b4133155389f8410bbe9b6c6a0fba978e865` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,966,989 | `dd8ff9239f5c82f5a17c7ac702b166633fe4e6c2e2131715b1720a1803f8bcbe` |

- `latest.json`: 7,098 bytes; SHA-256 `dafc1a3b3695ee4562bac3d243de7cd7735c68e5d249a8c9b147a9a9cb45d087`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 653 bytes; SHA-256 `e7284665838586de53526fea23c7381c07e64557bf83c5cd23fe72c539483de3`; all seven installable-package checks pass.

## Previous 0.1.5 signed cross-platform release

- Release: [`v0.1.5`](https://github.com/not-projects/querynot/releases/tag/v0.1.5)
- Candidate run: [`32663343245`](https://github.com/not-projects/querynot/actions/runs/32663343245)
- Publication run: [`32665401024`](https://github.com/not-projects/querynot/actions/runs/32665401024)
- Source commit: `fb3ee515448d8131d17f677ca532940565f4c097`
- Public verification: all 18 assets are byte-identical to the reviewed candidate; all seven updater signatures pass with public key ID `FD25C4E1F33E86DD`

| Role | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows NSIS | `QueryNot_0.1.5_x64-setup.exe` | 3,385,773 | `4f312e371c7bbd4a70dae0796cde2f15cc54bd264d01a7a6af23b343fae3af58` |
| Windows MSI | `QueryNot_0.1.5_x64_en-US.msi` | 4,530,176 | `d0b1b433f23130e31029b5858cb4ef5961a1d88435e0f76f68aeec6af61cec92` |
| Linux AppImage | `QueryNot_0.1.5_amd64.AppImage` | 82,176,504 | `191db834f6c1cd70310c38c2f9a908fd83a59a36884731d5028268c6b8e637cf` |
| Linux DEB | `QueryNot_0.1.5_amd64.deb` | 4,646,892 | `e1a66da11b41badc54eb42513fda869cac4b63c6c8571a5c2564254621b0f6fa` |
| Linux RPM | `QueryNot-0.1.5-1.x86_64.rpm` | 4,647,731 | `fdfbcf141b479ea294727c8ebca8a4a8e897e996efcaf689e319519e4a8b087b` |
| macOS Intel DMG | `QueryNot_0.1.5_x64.dmg` | 4,284,814 | `325c5e339add029bd93a02add6641f38ecd75437ea508960f48485c8aa089f98` |
| macOS Apple-silicon DMG | `QueryNot_0.1.5_aarch64.dmg` | 3,938,038 | `ecb5751793512e5d32db617a4eb9b13f035361e646986291699ee01039cee5db` |
| macOS Intel updater | `QueryNot_x64.app.tar.gz` | 4,262,317 | `818c90d7468e4ef11111180b27da551a1589ec9c7e3a64d409c8602ecfcbb384` |
| macOS Apple-silicon updater | `QueryNot_aarch64.app.tar.gz` | 3,961,918 | `e0f6056b0d3909e06b51c77724cd6bbf58cbbd37327358fd6ada9792a4fd8d01` |

- `latest.json`: 6,687 bytes; SHA-256 `effe8c04f57772cc692a2e01864566c6376c3fd59d6b3051f2e7bdc8ed5ca9d8`; exact keys `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `linux-x86_64-appimage`, `linux-x86_64-deb`, `linux-x86_64-rpm`, `windows-x86_64`, and `windows-x86_64-nsis`.
- `SHA256SUMS`: 653 bytes; SHA-256 `79ddef44aa1d5bf385fe59582132b0c99bb983e8f82f3eb7bdc4d6cd89491599`; all seven installable-package checks pass.

## Previous 0.1.4 signed Windows artifact

- Release: [`v0.1.4`](https://github.com/not-projects/querynot/releases/tag/v0.1.4)
- Candidate run: `32590531115`
- Publication run: `32591104372`
- Source commit: `3aad76c0214b93f0432fec9ee223f32badea2869`
- Installer: `QueryNot_0.1.4_x64-setup.exe`
- Size: 3,386,329 bytes
- SHA-256: `e77efb4fc59c36d8294e7ed544ddaeb167db94d1302e21dbe56161fc1aa17a48`
- Updater signature: Ed25519-BLAKE2b verification passed with public key ID `FD25C4E1F33E86DD`

## Historical 0.1.0 Windows artifact

- Candidate run: `31815252436`
- Source commit: `e241ee0973f17906ead8b32d868f76a01685baba`
- Installer: `QueryNot_0.1.0_x64-setup.exe`
- Size: 3,120,243 bytes
- SHA-256: `80753f765bcae143750b2de1b765405b710ad858fb637c1cfb80c9a06090058c`
- Updater artifacts: none

The historical WSL2 Debian and AppImage packages remain development evidence only. The public `0.1.12` Linux packages came from the native Ubuntu candidate job and passed the combined release contract. Native hardware observations remain follow-up evidence, and cross-platform compilation alone is still not a support claim.
