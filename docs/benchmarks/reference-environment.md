# Benchmark reference environment

Status: Phase 0 development reference; Phase 5 production benchmark evidence required
Recorded: 2026-08-13

| Attribute | Value |
| --- | --- |
| Host/virtualization | Microsoft WSL2 development environment |
| Guest OS | Ubuntu 22.04.3 LTS, kernel `6.18.33.2-microsoft-standard-WSL2` |
| Architecture | x86-64 |
| CPU | Intel Core i7-12700H, 10 cores/20 logical CPUs |
| Memory | 15.48 GiB visible to WSL |
| Storage | Host-backed development filesystem; production SSD benchmark still required |
| Node/npm | Node 22.22.1, npm 10.9.4 |
| Rust | rustc 1.94.0, cargo 1.94.0 |
| GTK/WebKitGTK | GTK 3.24.33, WebKitGTK 2.50.4 |
| Display/power | Not controlled in WSL; Phase 5 native record required |

## Fixed procedure

Production benchmarks use release builds on an otherwise idle native reference machine with at least four modern CPU cores, 16 GiB RAM, and SSD storage. Each percentile contains at least 30 independent samples after one discarded setup run. Raw samples, fixture generator version, power mode, display scale, OS/runtime patches, commit, and command are retained under `evidence/benchmarks/`.

The ordinary-result fixture is 10,000 rows by 12 mixed-type columns at approximately 1 KiB encoded payload per row, including nulls, Unicode, and variable-width text. The large-schema fixture contains at least 100 namespaces and 10,000 objects. This development record does not satisfy any PRD performance target by itself.
