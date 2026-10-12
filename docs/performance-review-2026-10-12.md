# Performance review — 2026-10-12

The comparison uses commit `9f70fe1` as the baseline and local fictional fixtures. No real notes, student data or model requests are part of the benchmark. Existing uncommitted improvements to React subscriptions, preview drawing, number formatting, KaTeX deduplication and lazy loading were preserved, reviewed and included in the measurements.

## Measured results

| Workload | Baseline | Updated | Measurement |
| --- | ---: | ---: | --- |
| Listing 80 sections, repeated | 125.43 ms | 3.86 ms | Median of nine warm samples |
| Searching 1,200 fictional source paragraphs, repeated | 135.54 ms | 3.20 ms | Median of five warm samples |
| First section listing | 156.90 ms | 57.96 ms | One cold sample |
| First source search | 193.78 ms | 100.32 ms | One cold sample |
| Main JavaScript bundle | 1,636.86 kB | Approximately 933 kB | Production build, uncompressed |
| Main JavaScript bundle, gzip | 477.60 kB | Approximately 288 kB | Production build |

These are synthetic local measurements, not promised production response times. Timings vary with machine load, document shape and disk speed. Warm caches do not accelerate a first load to the same degree. Model inference, provider limits and remote content fetching remain separate costs.

Reproduce the server workloads with:

```powershell
node --import tsx scripts/benchmark-performance.mjs <baseline-checkout-path>
```

The baseline checkout must have access to compatible node_modules. The script creates and removes its own temporary fixture directory and prints structural timings only.

## Changes and safeguards

- Section summaries are cached without retaining section text. Each listing checks modification time, change time, size and file identity. Writes through the store invalidate the cache. Concurrent reads are limited to eight, results stay sorted and the cache is bounded to 1,024 summaries. Callers receive copies.
- Independent document-state reads run concurrently rather than waiting one by one.
- Repeated source searches reuse a bounded MiniSearch index. Concurrent cold requests share source loading. File-level fingerprints detect externally rewritten index files; invalidation during loading cannot repopulate the source cache with old data. Folder memories and combined indexes have separate bounds.
- React components subscribe to the state fields they need. A document's flow no longer reacts to job events belonging to other documents. Agent cards and Markdown messages retain the existing memoization improvements.
- The live event list is limited to the server's 400-event window, preventing unbounded growth in a long session.
- Preview drawing caches retain the existing reuse behavior. A single oversized render is excluded from the cache rather than bypassing its memory budget.
- CodeMirror and the FP catalogue retain the existing lazy loading. FP data is requested only for FP selections. The build resolves KaTeX to one implementation.
- Overlapping engine availability checks share a promise, reducing duplicate CLI processes during startup without introducing a time-based stale result.
- Missing `/assets/` requests return 404 instead of the HTML application shell. Rebuilding the production directory while its static server is open requires restarting that test server, because its registered file routes belong to the previous build.

## Validation

Type checking, all 63 tests, the production build and npm audit passed; the audit reported zero advisories. Regressions specifically cover summary mutation isolation, external writes with preserved timestamps, atomic replacement, renaming, deletion, concurrent source searches, source labels and externally rewritten source caches. A separate Electron profile with fictional notes verified Mermaid and image previews and explicit acceptance without changing real documents. The resource-404 regression also passed after the static-response fix.

## Remaining opportunities

Large collections may benefit from pagination of the subject list and incremental section metadata maintained by file watchers. Those require a broader persistence and UI contract than this review. Long document previews could render only visible sections, but export and figure-selection behavior must be qualified before introducing virtualization. Parser-heavy work could move into a worker if profiling real large-document typing shows a main-thread bottleneck. No speed improvement to AI generation itself is claimed.
