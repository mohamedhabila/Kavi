# Local LLM Runtime

There is intentionally no `runtime.ts` barrel. Import the module that owns the
behavior you need so dependency boundaries stay visible.

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

## Platform Notes

- Android uses the LiteRT-LM bridge through `native.ts` and
  `android/app/src/main/java/com/kavi/app/KaviLocalLlmModule.kt`. Validate
  Gradle dependency changes in a native build before enabling newer runtime
  features such as MTP or speculative decoding.
- iOS uses the LiteRT-LM bridge behind the same `nativeTypes.ts` request
  contract as Android. Keep platform-specific runtime details out of
  TypeScript prompt assembly.
- `downloads.ts` uses Expo FileSystem for the current model install flow. Large
  model download changes should preserve resumability, progress reporting, and
  recovery after app restarts.
