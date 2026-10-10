import Foundation
import Observation

/// Tiny runtime localization layer: the app ships `en` and `zh-Hans` strings and follows
/// the signed-in profile's language priority list, matching the web app.
@MainActor
@Observable
final class LocaleController {
    static let available = ["en", "zh-Hans"]

    private(set) var language: String
    private var bundle: Bundle

    init() {
        let preferred = Self.resolve(from: Locale.preferredLanguages)
        language = preferred
        bundle = Self.bundle(for: preferred)
    }

    /// Maps a language priority list (e.g. `["zh-CN", "en-US"]`) onto a supported language.
    static func resolve(from languages: [String]) -> String {
        for language in languages {
            let lower = language.lowercased()
            if lower.hasPrefix("zh") { return "zh-Hans" }
            if lower.hasPrefix("en") { return "en" }
        }
        return "en"
    }

    func setLanguage(_ language: String) {
        self.language = Self.available.contains(language) ? language : "en"
        bundle = Self.bundle(for: self.language)
    }

    func t(_ key: String) -> String {
        bundle.localizedString(forKey: key, value: nil, table: nil)
    }

    func t(_ key: String, _ arguments: CVarArg...) -> String {
        String(format: t(key), arguments: arguments)
    }

    private static func bundle(for language: String) -> Bundle {
        if let path = Bundle.main.path(forResource: language, ofType: "lproj"),
           let bundle = Bundle(path: path) {
            return bundle
        }
        return Bundle.main
    }
}
