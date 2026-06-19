# Local LLM Runtime

There is intentionally no `runtime.ts` barrel. Import the module that owns the behavior you need so dependency boundaries stay visible.

## Module Map

- `availability.ts`: native availability plus model/device eligibility.
- `backendPolicy.ts`, `backendStatus.ts`, and `status.ts`: backend/runtime resolution, observed backend tracking, and runtime status labels.
- `catalog.ts` and `provider.ts`: local model catalog lookup, provider normalization, and capability selectors.
- `executionPolicy.ts`, `memoryPolicy.ts`, `contextWindowPolicy.ts`, `samplingPolicy.ts`, `requestOverrides.ts`, and `platformPolicy.ts`: policy composition and its focused inputs.
- `download*.ts` and `install.ts`: model artifact install flow, progress, retry/backoff, resumable state, and final provider updates.
- `native.ts` and `nativeTypes.ts`: React Native bridge calls and native request/response contracts.
- `generateSession.ts`, `streamSession.ts`, `warmupSession.ts`, and `requestConfig.ts`: generate, stream, warmup, and shared request preparation.
- `plainPrompt.ts`, `structuredConversation.ts`, `structuredBudget.ts`, `structuredMessages.ts`, `promptContent.ts`, and `toolAdapter.ts`: prompt shaping, budgeting, OpenAPI tool mapping, and native structured conversation assembly.
- `modelArtifacts.ts`, `constants.ts`, and `types.ts`: artifact selectors, shared constants, and local LLM TypeScript contracts.

## Provider Modernization Notes

- Android uses the LiteRT-LM bridge through `native.ts` and `android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt`. Audit the Gradle dependency against the current LiteRT-LM release in a native build before enabling newer runtime features such as MTP/speculative decoding.
- iOS uses the LiteRT-LM bridge behind the same `nativeTypes.ts` request contract as Android; keep platform-specific runtime details out of TypeScript prompt assembly.
- `downloads.ts` preserves the existing Expo FileSystem behavior for now. A production-grade large-model installer should move to native WorkManager/URLSession so downloads can resume safely after process death and report OS-visible progress without JS lifecycle pressure.
