import AppIntents
import Foundation

/// "Talk to Kavi": opens Kavi in voice, listening (Siri, Shortcuts, Spotlight, the Action button).
@available(iOS 16.0, *)
struct TalkToKaviIntent: AppIntent {
  static let title: LocalizedStringResource = "Talk to Kavi"
  static let description = IntentDescription("Opens Kavi listening, ready for what you say.")
  static let openAppWhenRun = true

  @MainActor
  func perform() async throws -> some IntentResult {
    KaviLaunchRequestStore.shared.submit("kavi://assist")
    return .result()
  }
}

/// "Ask Kavi": sends Kavi a request and opens the conversation where it answers.
@available(iOS 16.0, *)
struct AskKaviIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask Kavi"
  static let description = IntentDescription("Sends Kavi a request and opens the conversation.")
  static let openAppWhenRun = true

  @Parameter(title: "Request", requestValueDialog: "What should Kavi do?")
  var request: String

  @MainActor
  func perform() async throws -> some IntentResult {
    // Only unreserved characters stay literal: URLComponents would leave "&" and "+" in the
    // value, which the link reader treats as a separator and a space.
    let unreserved = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
    let encoded = request.addingPercentEncoding(withAllowedCharacters: unreserved) ?? ""
    KaviLaunchRequestStore.shared.submit("kavi://ask?text=\(encoded)")
    return .result()
  }
}

@available(iOS 16.0, *)
struct KaviAppShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: TalkToKaviIntent(),
      phrases: ["Talk to \(.applicationName)", "Start a \(.applicationName) conversation"],
      shortTitle: "Talk to Kavi",
      systemImageName: "waveform"
    )
    AppShortcut(
      intent: AskKaviIntent(),
      phrases: ["Ask \(.applicationName)"],
      shortTitle: "Ask Kavi",
      systemImageName: "text.bubble"
    )
  }
}
