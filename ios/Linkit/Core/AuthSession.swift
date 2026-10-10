import Foundation
import Observation

enum AuthError: LocalizedError, Equatable {
    case notConfigured
    case noSession
    case sessionExpired

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "The Linkit instance configuration is unavailable. Check the server address and try again."
        case .noSession:
            return "There is no stored Auth Mini session to use."
        case .sessionExpired:
            return "The Auth Mini session has expired. Sign in again."
        }
    }
}

/// Owns the Auth Mini session for one Linkit instance.
///
/// Sign-in opens the Auth Mini login page in an in-app web view with
/// `redirect_uri=<origin>/#/auth/callback`; the redirect carries the session tokens in the
/// hash route, which `LoginCallback` parses. Access tokens are kept in memory and refreshed
/// against `/session/refresh`; the rotating refresh token and session id live in the keychain.
@MainActor
@Observable
final class AuthSession {
    enum Phase: Equatable {
        case starting
        case signedOut
        case signingIn
        case signedIn
    }

    private(set) var phase: Phase = .starting
    private(set) var config: APIConfig?
    private(set) var lastError: String?
    private(set) var meID: String?
    private(set) var instanceURL: URL

    private var accessToken: String?
    private var accessTokenExpiry: Date?
    private var pendingLoginState: String?

    static let defaultInstance = URL(string: "https://linkit.ntnl.io")!
    private static let instanceDefaultsKey = "linkit.instance.url"
    private static let refreshAccount = "session.refresh_token"
    private static let sessionAccount = "session.session_id"

    init() {
        let stored = UserDefaults.standard.string(forKey: Self.instanceDefaultsKey)
        instanceURL = stored.flatMap(URL.init(string:)) ?? Self.defaultInstance
    }

    var apiBaseURL: URL { instanceURL }

    /// The hostname Auth Mini derives the audience from; tokens must match the instance.
    private var loginOrigin: URL {
        config?.publicOrigin.flatMap(URL.init(string:)) ?? instanceURL
    }

    // MARK: - Lifecycle

    func bootstrap() async {
        await loadConfig()
        if Keychain.string(for: Self.refreshAccount) != nil,
           Keychain.string(for: Self.sessionAccount) != nil {
            if (try? await forceRefresh()) != nil {
                phase = .signedIn
                return
            }
        }
        phase = .signedOut
    }

    func loadConfig() async {
        var components = URLComponents(url: instanceURL, resolvingAgainstBaseURL: false)
        components?.path = "/api/config"
        guard let url = components?.url else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            config = try JSONDecoder().decode(APIConfig.self, from: data)
            lastError = nil
        } catch {
            lastError = "Could not reach the Linkit instance at \(instanceURL.absoluteString)."
        }
    }

    func switchInstance(_ url: URL) async {
        instanceURL = url
        UserDefaults.standard.set(url.absoluteString, forKey: Self.instanceDefaultsKey)
        clearSession()
        config = nil
        phase = .starting
        await bootstrap()
    }

    func setMeID(_ id: String) {
        meID = id
    }

    // MARK: - Sign-in

    /// Builds the Auth Mini login URL for this instance and moves to `signingIn`.
    func beginLogin() async throws -> URL {
        if config == nil { await loadConfig() }
        guard let issuerString = config?.authIssuer,
              let issuer = URL(string: issuerString)
        else { throw AuthError.notConfigured }

        var originString = loginOrigin.absoluteString
        while originString.hasSuffix("/") { originString.removeLast() }

        let state = UUID().uuidString
        pendingLoginState = state
        var query = [
            URLQueryItem(name: "redirect_uri", value: originString + "/#/auth/callback"),
            URLQueryItem(name: "state", value: state),
        ]
        // Loopback instances must name the audience explicitly; Auth Mini rejects a
        // loopback redirect without `aud`.
        if let host = loginOrigin.host, ["localhost", "127.0.0.1", "::1"].contains(host) {
            query.append(URLQueryItem(name: "aud", value: host))
        }
        var queryComponents = URLComponents()
        queryComponents.queryItems = query
        guard let queryString = queryComponents.percentEncodedQuery else { throw AuthError.notConfigured }

        var issuerBase = issuer.absoluteString
        while issuerBase.hasSuffix("/") { issuerBase.removeLast() }
        guard let url = URL(string: "\(issuerBase)/web/#/login?\(queryString)") else {
            throw AuthError.notConfigured
        }
        phase = .signingIn
        return url
    }

    func cancelLogin() {
        pendingLoginState = nil
        if phase == .signingIn { phase = .signedOut }
    }

    func completeLogin(callbackURL: URL) async throws {
        guard let host = callbackURL.host,
              let expectedHost = loginOrigin.host,
              host.caseInsensitiveCompare(expectedHost) == .orderedSame
        else { throw LoginCallbackError.notACallback }
        let tokens = try LoginCallback.parse(callbackURL: callbackURL, expectedState: pendingLoginState)
        store(tokens: tokens)
        pendingLoginState = nil
        lastError = nil
        phase = .signedIn
    }

    // MARK: - Tokens

    func validAccessToken() async throws -> String {
        if let token = accessToken, let expiry = accessTokenExpiry, expiry.timeIntervalSinceNow > 60 {
            return token
        }
        return try await forceRefresh()
    }

    @discardableResult
    func forceRefresh() async throws -> String {
        guard let refreshToken = Keychain.string(for: Self.refreshAccount),
              let sessionID = Keychain.string(for: Self.sessionAccount)
        else {
            handleUnauthorized()
            throw AuthError.noSession
        }
        if config?.authIssuer == nil { await loadConfig() }
        guard let issuerString = config?.authIssuer, let issuer = URL(string: issuerString) else {
            throw AuthError.notConfigured
        }

        var components = URLComponents(url: issuer, resolvingAgainstBaseURL: false)
        components?.path = "/session/refresh"
        guard let url = components?.url else { throw AuthError.notConfigured }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode([
            "session_id": sessionID,
            "refresh_token": refreshToken,
        ])

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIHTTPError(status: -1, message: "Could not reach Auth Mini to refresh the session.")
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let tokens = try? JSONDecoder().decode(SessionTokenResponse.self, from: data)
        else {
            handleUnauthorized()
            throw AuthError.sessionExpired
        }
        Keychain.set(tokens.sessionID, for: Self.sessionAccount)
        Keychain.set(tokens.refreshToken, for: Self.refreshAccount)
        accessToken = tokens.accessToken
        accessTokenExpiry = Date().addingTimeInterval(TimeInterval(tokens.expiresIn))
        return tokens.accessToken
    }

    func handleUnauthorized() {
        clearSession()
        meID = nil
        if phase != .starting { phase = .signedOut }
    }

    func signOut() async {
        if let token = accessToken, let issuerString = config?.authIssuer, let issuer = URL(string: issuerString) {
            var components = URLComponents(url: issuer, resolvingAgainstBaseURL: false)
            components?.path = "/session/logout"
            if let url = components?.url {
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                _ = try? await URLSession.shared.data(for: request)
            }
        }
        clearSession()
        meID = nil
        phase = .signedOut
    }

    private func store(tokens: LoginCallbackTokens) {
        Keychain.set(tokens.sessionID, for: Self.sessionAccount)
        Keychain.set(tokens.refreshToken, for: Self.refreshAccount)
        accessToken = tokens.accessToken
        accessTokenExpiry = tokens.expiresAt ?? Date().addingTimeInterval(TimeInterval(tokens.expiresIn))
    }

    private func clearSession() {
        Keychain.remove(Self.sessionAccount)
        Keychain.remove(Self.refreshAccount)
        accessToken = nil
        accessTokenExpiry = nil
        pendingLoginState = nil
    }
}
