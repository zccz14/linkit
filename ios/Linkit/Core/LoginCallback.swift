import Foundation

/// The tokens Auth Mini appends when it redirects back to the instance origin.
struct LoginCallbackTokens: Equatable, Sendable {
    var accessToken: String
    var tokenType: String
    var sessionID: String
    var refreshToken: String
    var expiresIn: Int
    var expiresAt: Date?
    var state: String?
}

enum LoginCallbackError: LocalizedError, Equatable {
    case notACallback
    case missingTokens
    case stateMismatch

    var errorDescription: String? {
        switch self {
        case .notACallback:
            return "The sign-in callback does not belong to this Linkit instance."
        case .missingTokens:
            return "The sign-in callback did not include a complete session."
        case .stateMismatch:
            return "The sign-in callback state did not match this sign-in attempt."
        }
    }
}

/// Pure parsing of the Auth Mini redirect contract for hash-router callbacks.
///
/// For `redirect_uri=https://<origin>/#/auth/callback` Auth Mini appends the tokens to the
/// hash route query, e.g. `#/auth/callback?access_token=…&state=…`; a plain fragment
/// (`#access_token=…`) is accepted too for completeness.
enum LoginCallback {
    static func isCallbackURL(_ url: URL, instanceHost: String) -> Bool {
        guard let host = url.host else { return false }
        return host.caseInsensitiveCompare(instanceHost) == .orderedSame
    }

    static func parse(callbackURL url: URL, expectedState: String?) throws -> LoginCallbackTokens {
        let pairs = queryPairs(fromFragment: url.fragment ?? "")
        guard
            let accessToken = pairs["access_token"], !accessToken.isEmpty,
            let sessionID = pairs["session_id"], !sessionID.isEmpty,
            let refreshToken = pairs["refresh_token"], !refreshToken.isEmpty
        else { throw LoginCallbackError.missingTokens }
        let state = pairs["state"]
        if let expectedState, state != expectedState { throw LoginCallbackError.stateMismatch }
        return LoginCallbackTokens(
            accessToken: accessToken,
            tokenType: pairs["token_type"] ?? "Bearer",
            sessionID: sessionID,
            refreshToken: refreshToken,
            expiresIn: Int(pairs["expires_in"] ?? "") ?? 900,
            expiresAt: pairs["expires_at"].flatMap(parseTimestamp),
            state: state
        )
    }

    static func queryPairs(fromFragment fragment: String) -> [String: String] {
        let queryPart: String
        if fragment.hasPrefix("/") {
            guard let mark = fragment.firstIndex(of: "?") else { return [:] }
            queryPart = String(fragment[fragment.index(after: mark)...])
        } else {
            queryPart = fragment
        }
        var pairs: [String: String] = [:]
        for item in queryPart.split(separator: "&", omittingEmptySubsequences: true) {
            let parts = item.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard let rawKey = parts.first, !rawKey.isEmpty else { continue }
            let rawValue = parts.count > 1 ? String(parts[1]) : ""
            let key = decodeComponent(String(rawKey))
            let value = decodeComponent(rawValue)
            pairs[key] = value
        }
        return pairs
    }

    private static func decodeComponent(_ value: String) -> String {
        value.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? value
    }

    private static func parseTimestamp(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
}
