# Board test migration

Baseline: the original 29-test suite took 24.55s wall time (23.7s Playwright),
recorded on this machine in task artifact `baseline-host`. No retries.

Every original board assertion is retained below, before replacing its selector.
All interaction targets come from Chrome AX role/name and backend node handles.
Visual-only details use container screenshots; existing `ghostTransform` unit tests
also assert exact touch ghost enlargement and vertical offset.

| Original board test | Replacement coverage |
| --- | --- |
| Complete game | Same four-move journey; AX status, move list, queen and 64 disabled squares |
| Keyboard/64 squares | AX grid snapshot/count, keyboard move, status; public controller encapsulation retained |
| Theme/bundled pieces | Injected board screenshots verify colors/art; request checks verify all 12 local SVGs load with no remote/data URLs |
| Mouse drag | AX targets, final pawn and move list |
| Exact boundary | AX descriptions for both adjacent drop targets, final pawn and move list |
| Touch feedback | AX drop target, screenshot while held and after release; core ghostTransform unit asserts size/offset |
| Quick taps | AX selection/move list, no AX annotation preview after long-press threshold |
| Long press | AX highlight/arrow previews, committed annotations on both endpoints, unchanged move list |
| Source before callback | Callback inspects the AX-resolved source node synchronously; held description must survive until callback |
| Disabled mid-drag | AX pawn and empty move list after controlled disable |
| Promotion keyboard | AX dialog/buttons, wrap focus in both directions, Escape cancellation, queen and SAN |
| Promotion reset | AX dialog disappears, original black pawn restored |
| Selection reset | AX selected state clears |
| Controlled annotations | AX annotation labels and screenshot of color/translucent shaft/head; successful move through overlay |
| Game restore/external result | Direct API move/snapshot injection; AX restored pawn, timeout status, 64 disabled squares |
| Drawn timeout | Injected FEN/result, AX status and live announcement |
| Puzzle lifecycle | Wrong move rejected, automatic reply, preserved last move, completion disabled, restored enabled position |
| Opponent-first puzzle | Injected solution/player; AX opening reply and enabled solver |
| Product-controlled reply | Injected attempt/reply; AX pawn and live completion announcement |
| Analysis navigation/restore | Injected annotated branch/restore; AX annotations, right-drag/right-click, tap clears all; encapsulation and PGN retained |
| Narrow viewport | AX grid geometry and document overflow; phone screenshot |
| Held during thinking | AX held source before/after opponent update and final two-ply move list |
| Held piece captured | AX held source disappears after capture and only opponent move recorded |
| Selection while waiting | AX selection persists across opponent update, one-tap reply |
| Grab cursor | Computed cursor on AX-resolved squares before/during drag; no CSS target lookup |

Runtime accessibility correction: last move, check, legal destinations, held pieces,
drop targets and annotation previews were visual-only. Square descriptions expose
these states without changing square names or public API. This requires a package
release; this task does not tag or publish.

## Verification

`bun run ci` passes lint, typecheck, 97 unit tests, build/package verification,
and all 45 browser tests. All 24 PNG baselines were generated and visually
reviewed in the official Playwright 1.61.1 Linux/amd64 image. There are 27 committed
AX text snapshots. Example assertion mapping is in `examples-test-coverage.md`.

| Run | Tests | Playwright time | Command wall time |
| --- | --- | --- | --- |
| Original host baseline | 29 | 23.7s | 24.55s |
| Migrated host | 29 | 8.0s | 8.97s |
| Full container 1 | 45 | 25.2s | 47.14s |
| Full container 2 | 45 | 24.9s | 52.06s |
| Full container 3 | 45 | 25.2s | 48.47s |
| Full container 4 | 45 | 25.0s | 47.15s |
| Full container 5 | 45 | 25.1s | 45.83s |

The host timings are on the same machine; the original used bundled Chromium,
while the migrated host command uses installed Chrome. Both include the build
and exclude screenshots. Full runs include every screenshot and run Linux/amd64
on an ARM64 Docker host; their wall times also include fresh container dependency
installation. Five consecutive full runs passed without retries or timeout
increases. Logs are retained as task artifacts `real-ax-ci`, `real-ax-host`, and
`real-ax-full-1` through `real-ax-full-5`.
