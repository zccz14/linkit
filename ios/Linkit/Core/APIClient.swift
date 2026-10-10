import Foundation

/// JSON client for the Linkit HTTP API. Every signed-in request carries the current
/// Auth Mini access token; a `401` is answered by one forced refresh and one retry.
@MainActor
final class APIClient {
    private let auth: AuthSession
    private let session: URLSession

    init(auth: AuthSession) {
        self.auth = auth
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration)
    }

    // MARK: - Signed-in requests

    func request<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await perform(method, path: path, query: query, bodyData: nil, contentType: nil)
        return try Self.decode(data)
    }

    func request<T: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], jsonBody: some Encodable) async throws -> T {
        let bodyData = try JSONEncoder().encode(jsonBody)
        let data = try await perform(method, path: path, query: query, bodyData: bodyData, contentType: "application/json")
        return try Self.decode(data)
    }

    func requestVoid(_ method: String, _ path: String, query: [URLQueryItem] = []) async throws {
        _ = try await perform(method, path: path, query: query, bodyData: nil, contentType: nil)
    }

    func requestVoid(_ method: String, _ path: String, query: [URLQueryItem] = [], jsonBody: some Encodable) async throws {
        let bodyData = try JSONEncoder().encode(jsonBody)
        _ = try await perform(method, path: path, query: query, bodyData: bodyData, contentType: "application/json")
    }

    func uploadAttachment(fileName: String, mediaType: String, data: Data) async throws -> APIAttachment {
        let boundary = "linkit-\(UUID().uuidString)"
        var body = Data()
        let safeName = fileName.replacingOccurrences(of: "\"", with: "")
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n".utf8))
        body.append(Data("Content-Type: \(mediaType)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        let responseData = try await perform(
            "POST",
            path: "/api/attachments",
            query: [],
            bodyData: body,
            contentType: "multipart/form-data; boundary=\(boundary)"
        )
        return try Self.decode(responseData)
    }

    func downloadAttachmentContent(id: String) async throws -> Data {
        try await perform("GET", path: "/api/attachments/\(id)/content", query: [], bodyData: nil, contentType: nil)
    }

    func downloadAttachmentAvatar(id: String) async throws -> Data {
        try await perform("GET", path: "/api/attachments/\(id)/avatar", query: [], bodyData: nil, contentType: nil)
    }

    /// A long-lived authorized request for the SSE event stream.
    func makeEventStream() async throws -> (URLSession.AsyncBytes, URLResponse) {
        var request = try await authorizedRequest("GET", "/api/events")
        request.timeoutInterval = 3600
        return try await session.bytes(for: request)
    }

    // MARK: - Public requests

    func publicProfiles(ids: [String]) async throws -> [APIPublicProfile] {
        var request = URLRequest(url: url("/api/public/profiles/batch"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["user_ids": ids])
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response, data: data)
        return try Self.decode(data)
    }

    func publicProfile(userID: String) async throws -> APIPublicProfile {
        var request = URLRequest(url: url("/api/public/profiles/\(userID)"))
        request.httpMethod = "GET"
        let (data, response) = try await session.data(for: request)
        try Self.validate(response: response, data: data)
        return try Self.decode(data)
    }

    // MARK: - Plumbing

    private func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: auth.apiBaseURL, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.path = path
        if !query.isEmpty { components.queryItems = query }
        return components.url ?? auth.apiBaseURL
    }

    private func authorizedRequest(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        bodyData: Data? = nil,
        contentType: String? = nil
    ) async throws -> URLRequest {
        let token = try await auth.validAccessToken()
        var request = URLRequest(url: url(path, query: query))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let bodyData { request.httpBody = bodyData }
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        return request
    }

    private func perform(
        _ method: String,
        path: String,
        query: [URLQueryItem],
        bodyData: Data?,
        contentType: String?
    ) async throws -> Data {
        var request = try await authorizedRequest(method, path, query: query, bodyData: bodyData, contentType: contentType)
        var (data, response) = try await session.data(for: request)
        if (response as? HTTPURLResponse)?.statusCode == 401 {
            let token = try await auth.forceRefresh()
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            (data, response) = try await session.data(for: request)
        }
        try Self.validate(response: response, data: data)
        return data
    }

    private static func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIHTTPError(status: -1, message: "The server returned no response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(APIErrorEnvelope.self, from: data))?.error.message
                ?? "Request failed (\(http.statusCode))"
            throw APIHTTPError(status: http.statusCode, message: message)
        }
    }

    private static func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIHTTPError(status: -1, message: "The server response could not be read.")
        }
    }
}
