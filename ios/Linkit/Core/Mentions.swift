import Foundation

struct MentionCandidate: Hashable, Sendable {
    var userID: String
    var username: String
    var userType: String
    var hasProfile: Bool
}

struct MentionSegment: Equatable, Sendable {
    var text: String
    var username: String?
}

/// `<@user_id>` mention tokens, mirroring `web/src/lib/mention.ts`.
enum Mentions {
    private static let tokenRegex = try! NSRegularExpression(
        pattern: "<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>"
    )

    /// Replaces every typed `@username` that names a candidate with the canonical
    /// `<@user_id>` token so the stored message body carries stable mentions.
    static func tokenize(_ text: String, members: [MentionCandidate]) -> String {
        let characters = Array(text)
        let names = members.map { (member: $0, characters: Array($0.username)) }
        var result = ""
        var index = 0
        while index < characters.count {
            let previous: Character? = index > 0 ? characters[index - 1] : nil
            if characters[index] == "@", !isHandlePrefix(previous) {
                if let match = longestMention(at: index + 1, in: characters, names: names) {
                    result += "<@\(match.member.userID)>"
                    index += 1 + match.characters.count
                    continue
                }
            }
            result.append(characters[index])
            index += 1
        }
        return result
    }

    /// Splits a stored body into plain and mention segments for rendering. Only tokens
    /// whose user ID is one of the message's mentions become `@username`.
    static func split(_ text: String, mentions: [APIMessageMention]) -> [MentionSegment] {
        let fullRange = NSRange(text.startIndex..<text.endIndex, in: text)
        let matches = tokenRegex.matches(in: text, range: fullRange)
        var segments: [MentionSegment] = []
        var copied = text.startIndex
        for match in matches {
            guard
                let range = Range(match.range, in: text),
                let idRange = Range(match.range(at: 1), in: text)
            else { continue }
            let id = String(text[idRange])
            guard let mention = mentions.first(where: { $0.userID.lowercased() == id.lowercased() }) else { continue }
            if copied < range.lowerBound {
                segments.append(MentionSegment(text: String(text[copied..<range.lowerBound]), username: nil))
            }
            segments.append(MentionSegment(text: "@\(mention.username)", username: mention.username))
            copied = range.upperBound
        }
        if copied < text.endIndex {
            segments.append(MentionSegment(text: String(text[copied...]), username: nil))
        }
        return segments
    }

    static func displayText(_ text: String, mentions: [APIMessageMention]) -> String {
        split(text, mentions: mentions).map(\.text).joined()
    }

    // MARK: - Username matching

    static func isHandleContinuation(_ character: Character) -> Bool {
        if character == "-" || character == "_" { return true }
        return character.unicodeScalars.allSatisfy { scalar in
            CharacterSet.letters.contains(scalar) || CharacterSet.numeric.contains(scalar)
        }
    }

    static func isHandlePrefix(_ character: Character?) -> Bool {
        guard let character, character.isASCII else { return false }
        return character.isLetter || character.isNumber || character == "-" || character == "_"
    }

    static func asciiLowercased(_ value: String) -> String {
        String(value.map { character in
            guard character.isASCII, character.isUppercase else { return character }
            return Character(character.lowercased())
        })
    }

    private static func sameCharacterIgnoringASCIICase(_ left: Character, _ right: Character) -> Bool {
        if left == right { return true }
        return String(asciiLowercased(String(left))) == asciiLowercased(String(right))
    }

    private static func matchesUsername(at start: Int, in characters: [Character], username: [Character]) -> Bool {
        if start + username.count > characters.count { return false }
        for offset in 0..<username.count {
            if !sameCharacterIgnoringASCIICase(characters[start + offset], username[offset]) { return false }
        }
        let nextIndex = start + username.count
        guard nextIndex < characters.count else { return true }
        return !isHandleContinuation(characters[nextIndex])
    }

    private static func longestMention(
        at start: Int,
        in characters: [Character],
        names: [(member: MentionCandidate, characters: [Character])]
    ) -> (member: MentionCandidate, characters: [Character])? {
        var longest: (member: MentionCandidate, characters: [Character])?
        for name in names {
            if let current = longest, name.characters.count <= current.characters.count { continue }
            if matchesUsername(at: start, in: characters, username: name.characters) { longest = name }
        }
        return longest
    }
}
