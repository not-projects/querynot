# Retained release evidence

This directory retains redacted, repository-safe evidence for the release gates in the product requirements. Evidence records never contain credentials, connection endpoints, SQL text with sensitive literals, database metadata, result values, certificate paths, or user file paths.

Every evidence record identifies:

- the exact source commit;
- tested operating system, architecture, runtime, and database/library versions;
- a synthetic or disposable fixture identifier;
- the checked-in command or manual procedure;
- pass, fail, blocked, or not-run status; and
- links to any report, screenshot, recording, benchmark, checksum, or review artifact retained in this directory.

Automated output is evidence only when produced by the checked-in command on the stated commit. Human-only gates such as multi-day dogfood, opt-in beta, installation review, and manual safety review remain incomplete until a named reviewer records a redacted result; they are never inferred from unit tests.
