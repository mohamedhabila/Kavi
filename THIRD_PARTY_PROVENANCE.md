# Third-Party Provenance

This file records code and generated assets in Kavi that have explicit upstream lineage or special attribution requirements.

It intentionally moves provenance details out of inline implementation comments and into one public inventory that contributors and maintainers can review.

## Scope

This file focuses on:

- local source files with known historical carry-forward lineage
- generated assets built from third-party editor packages
- dependency patches that modify upstream code shipped in the app

It does not replace the dependency license inventory in `THIRD_PARTY_NOTICES.md`.

## Status Legend

- `Verified`: upstream package or repository and license were confirmed from installed package metadata or the patch target.
- `Maintainer-attested first-party lineage`: the code remains first-party Kavi
  code. For this inventory, these modules were reviewed as maintainer-owned
  first-party code and are published under this repository's MIT license.

## Inventory

| Surface                                                                                                                                                | Upstream / Source                                          | Status                                  | License | Notes                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `patches/@dylankenneally+react-native-ssh-sftp+1.6.8.patch`                                                                                            | `@dylankenneally/react-native-ssh-sftp`                    | Verified                                | MIT     | Local patch adds host fingerprint capture, verified host-key flows, and JavaScript bridge support needed for secure SSH target handling on Android and iOS.                                                              |
| `assets/editor/editor.html`, `android/app/src/main/assets/editor/editor.html`, `assets/editor/runtime/*`, `scripts/build-editor-assets.js`             | CodeMirror packages (`codemirror`, `@codemirror/*`)        | Verified                                | MIT     | Editor HTML is generated locally from installed CodeMirror packages during `npm install` and `npm run build:editor-assets`. The generated bundle is committed so native builds do not depend on a runtime bundling step. |
| `src/services/cron/parse.ts`, `src/utils/string-normalization.ts`                                                                                      | Earlier first-party Kavi utility history                   | Maintainer-attested first-party lineage | MIT     | These compact helpers were reviewed as first-party project code carried forward from earlier first-party iterations of the same product lineage.                                                                         |
| `src/services/links/detect.ts`, `src/services/terminal/ansi.ts`, `src/services/terminal/safeText.ts`                                                   | Earlier first-party Kavi utility history                   | Maintainer-attested first-party lineage | MIT     | Inline implementation comments now defer to this inventory, which records the provenance while confirming the modules remain first-party code.                                                                           |
| `src/services/browser/automation.ts`, `src/services/browser/types.ts`, `src/services/browser/traceStore.ts`, `src/engine/tools/browser-definitions.ts` | Earlier first-party Kavi browser automation surface        | Maintainer-attested first-party lineage | MIT     | The browser automation layer is first-party project code under the same ownership and license as the rest of Kavi.                                                                                                       |
| `src/services/media/service.ts`, `src/engine/toolResultGuard.ts`, `src/engine/toolResultPairingGuard.ts`, `src/engine/loopDetection.ts`                | Earlier first-party Kavi runtime and orchestration history | Maintainer-attested first-party lineage | MIT     | These runtime guardrails were reviewed as first-party project code rather than third-party imports.                                                                                                                      |
| `src/i18n/locales/*.ts`                                                                                                                                | Earlier first-party Kavi localization baseline             | Maintainer-attested first-party lineage | MIT     | The localization baseline remains a first-party project asset.                                                                                                                                                           |
| `src/services/llm/LlmService.ts`                                                                                                                       | Earlier first-party Kavi transport history                 | Maintainer-attested first-party lineage | MIT     | The file is heavily evolved. Earlier transport patterns were reviewed as first-party lineage, so no additional third-party attribution is required beyond this record.                                                   |

## Patch-Package Notes

The SSH patch is intentionally retained in-repo because Kavi depends on verified host-key flows that are not provided by the upstream package version currently in use.

If this patch is ever upstreamed or replaced, update this file and `CONTRIBUTING.md` at the same time.

## Maintenance Checklist For This File

1. Add a new entry before merging any future dependency patch or historical carry-forward module that changes attribution or license obligations.
2. If an entry comes from outside the Kavi first-party lineage, record the upstream repository and license before it lands on the default branch.
3. Re-check the dependency patch against the exact version in `package-lock.json` after every dependency upgrade.
4. Run `npm run check:licenses` after dependency changes and update `THIRD_PARTY_NOTICES.md` when the generated inventory changes.
