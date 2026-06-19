import CLiteRTLM
import Foundation

public actor Engine {
  public let engineConfig: EngineConfig
  private var handle: OpaquePointer?

  public init(engineConfig: EngineConfig) {
    self.engineConfig = engineConfig
  }

  public func isInitialized() -> Bool {
    handle != nil
  }

  public func initialize() throws {
    if isInitialized() {
      throw LiteRTLMError.engine(.alreadyInitialized)
    }

    let backend = engineConfig.backend.rawValue
    let visionBackend = engineConfig.visionBackend?.rawValue
    let audioBackend = engineConfig.audioBackend?.rawValue

    guard let settings = litert_lm_engine_settings_create(
      engineConfig.modelPath,
      backend,
      visionBackend,
      audioBackend
    ) else {
      throw LiteRTLMError.engine(.failedToCreateSettings)
    }
    defer { litert_lm_engine_settings_delete(settings) }

    if let maxNumTokens = engineConfig.maxNumTokens {
      litert_lm_engine_settings_set_max_num_tokens(settings, Int32(maxNumTokens))
    }
    if let cacheDir = engineConfig.cacheDir {
      litert_lm_engine_settings_set_cache_dir(settings, cacheDir)
    }
    if let enableSpeculativeDecoding = ExperimentalFlags.enableSpeculativeDecoding {
      litert_lm_engine_settings_set_enable_speculative_decoding(settings, enableSpeculativeDecoding)
    }

    guard let engine = litert_lm_engine_create(settings) else {
      throw LiteRTLMError.engine(.failedToCreateEngine)
    }
    handle = engine
  }

  public func createConversation(with config: ConversationConfig? = nil) throws -> Conversation {
    guard let handle else {
      throw LiteRTLMError.engine(.notInitialized)
    }

    let conversationConfig = config ?? ConversationConfig()
    let systemMessageCount = conversationConfig.initialMessages.filter { $0.role == .system }.count
    if conversationConfig.systemMessage != nil && systemMessageCount > 0 {
      throw LiteRTLMError.config(.multipleSystemMessages)
    }
    if systemMessageCount > 1 {
      throw LiteRTLMError.config(.multipleSystemMessages)
    }

    guard let sessionConfig = litert_lm_session_config_create() else {
      throw LiteRTLMError.engine(.failedToCreateSessionConfig)
    }
    defer { litert_lm_session_config_delete(sessionConfig) }

    if let sampler = conversationConfig.samplerConfig {
      var params = LiteRtLmSamplerParams(
        type: kLiteRtLmSamplerTypeTopP,
        top_k: Int32(sampler.topK),
        top_p: sampler.topP,
        temperature: sampler.temperature,
        seed: Int32(sampler.seed)
      )
      litert_lm_session_config_set_sampler_params(sessionConfig, &params)
    }

    guard let nativeConfig = litert_lm_conversation_config_create() else {
      throw LiteRTLMError.engine(.failedToCreateConversationConfig)
    }
    defer { litert_lm_conversation_config_delete(nativeConfig) }

    litert_lm_conversation_config_set_session_config(nativeConfig, sessionConfig)
    if let systemMessage = try conversationConfig.systemMessage?.contents.jsonString, !systemMessage.isEmpty {
      litert_lm_conversation_config_set_system_message(nativeConfig, systemMessage)
    }
    let toolsJson = try conversationConfig.toolsJsonString
    if !toolsJson.isEmpty {
      litert_lm_conversation_config_set_tools(nativeConfig, toolsJson)
    }
    let messages = conversationConfig.initialMessages.map { $0.toJson }
    if !messages.isEmpty {
      let data = try JSONSerialization.data(withJSONObject: messages, options: [])
      if let string = String(data: data, encoding: .utf8), !string.isEmpty {
        litert_lm_conversation_config_set_messages(nativeConfig, string)
      }
    }
    litert_lm_conversation_config_set_enable_constrained_decoding(
      nativeConfig,
      ExperimentalFlags.enableConversationConstrainedDecoding
    )

    guard let conversation = litert_lm_conversation_create(handle, nativeConfig) else {
      throw LiteRTLMError.engine(.failedToCreateConversation)
    }
    return Conversation(handle: conversation)
  }

  deinit {
    if let handle {
      litert_lm_engine_delete(handle)
    }
  }
}
