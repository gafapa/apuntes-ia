# Application review — 2026-10-12

This review covers local persistence, imports and backups, public downloads, the HTTP/WebSocket API, Electron navigation, dependency advisories, executable downloads and CI. Existing map and interface work in the working tree was preserved. All destructive and malformed-input checks used temporary directories and fictional data. No student or teacher documents were submitted to external services.

## Findings and changes

| Area | Verified problem | Change |
| --- | --- | --- |
| Dependencies | Ten npm advisories, including nested KaTeX and the packaging proxy dependency chain | Updated compatible packages; deduplicated KaTeX 0.19.0 and replaced the vulnerable proxy chain with global-agent 4.1.3. npm audit reports zero advisories. |
| Persistence | Direct writes could leave incomplete files; missing and damaged state were sometimes treated alike; shutdown could race delayed saves | Serialized atomic file replacement, ordered deletion, explicit corrupt-file errors and queue/token flushing before shutdown. |
| Concurrent creation | Identical titles could choose the same destination | Atomically reserve subject/document directories. Ten concurrent creations are covered by regression tests. |
| ZIP imports | Normalized traversal names, Windows alternate streams, symbolic links and oversized payloads were insufficiently constrained | Validate original entry names and declared sizes; bound actual decompressed bytes and use exclusive output creation. |
| Backup restore | A later corrupt subject could leave earlier subjects restored | Validate metadata first, extract into staging, publish metadata last and roll back owned destinations on failure. HTTP restore awaits completion before removing its uploaded file. |
| Uploads | Truncated multipart streams could replace a valid file | Stage uploads, check truncation and publish only complete files. A second backup/import file is rejected. |
| Public downloads | URLs and redirects could reach local services; size checks occurred after allocation | Validate and pin public DNS answers, check each redirect and enforce limits while streaming, including thumbnail downloads. |
| Browser boundary | Host/Origin checks did not cover every cross-site request; Electron accepted URL prefixes | Strict loopback and origin checks for HTTP/WebSocket, Fetch Metadata checks and exact Electron origin comparison. Production CSP and response headers are enabled. |
| Data files | A filesystem link could expose a file outside the configured data root | Resolve and check the real target before serving a data file. |
| Engine configuration | Inherited object keys could be mistaken for configured engines; prototype-like IDs affected usage buckets | Require own engine/profile keys and explicitly create usage entries. |
| Windows file opening | Shell parsing could interpret special filename characters | Open files directly through Explorer without cmd/start. |
| Executable assets | Downloaded Pandoc/Typst archives and cached binaries lacked integrity checks | Require GitHub release SHA-256 digests and retain per-binary hash manifests; provide offline cache verification. |
| Development launcher | Shell wrappers could leave descendant servers alive | Launch local executable entry points directly, flush the owned server and wait for child-tree termination. |
| CI | Mutable action tags and limited checks | Pin checkout/setup-node by commit, disable persisted checkout credentials, add audit/build gates, least privilege for checks and bounded job timeouts. |

Archive defaults are 10,000 files, 200 MiB per file and 1 GiB total decompressed content. Public source downloads are limited to 40 MiB, image downloads to 20 MiB and thumbnails to 5 MiB. These are rejection limits, not guarantees that all inputs below the limits are inexpensive to process.

## Validation

- TypeScript type checking passed.
- All 57 tests passed, including 16 security regressions and the existing quota, job lifecycle, import, PDF image, export and map checks.
- The production web and Electron main-process builds passed.
- A clean installation from the package lock completed in a temporary directory; npm audit reported zero vulnerabilities.
- The Windows Pandoc 3.12.1 and Typst 0.15.1 downloads and their offline cached SHA-256 checks passed.
- Both GitHub workflow files parsed successfully. The packaging proxy initialization smoke check passed.
- The production interface loaded in a separate Electron profile with fictional data; the home and document views produced no JavaScript or CSP errors.
- KaTeX formulas and Mermaid SVG diagrams rendered under the production CSP.
- Windows directory packaging with Electron 44.7.0 succeeded using the separately installed distribution. This is not a signed installer or published release qualification.
- Public HTTPS download smoke checks passed with a bounded Wikimedia response.

## Update status and limits

Electron 44.7.0 was first qualified separately. Following the user's request to apply it, the queue and token state were flushed, the previous session was closed, a clean workspace installation completed and the application was relaunched. The selected document was reopened. The running renderer reports Electron 44.7.0.

GeoTIFF remains on 2.1.3. Version 3 is a major migration used by the optional map-data generation script; it has no current npm advisory and was not changed without qualifying the raster-generation workflow.

Atomic replacement prevents partial individual files; it does not make a multi-file operation crash-atomic or resolve simultaneous read-modify-write conflicts in all metadata operations. Restore rollback is tested for reported failures; power-loss recovery across the complete restore remains an additional improvement. The download protections do not make arbitrary public content trustworthy.

This review does not certify macOS/Linux runtime behavior, installer signing, hosted Actions results, model-generated document accuracy or a published release. The existing AI engines still follow the application's configured processing and permission policies; the local security changes do not imply that invoking a cloud-backed engine is offline.

## Advisory sources

- [KaTeX advisory GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)
- [sprintf-js advisory GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
- [Undici Agent documentation](https://undici.nodejs.org/#/docs/api/Agent)
