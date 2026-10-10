import Foundation

enum LinkitServerEvent: Sendable {
    case sync
    case unread(total: Int)
    case refreshConversations
    case message(conversationID: String, message: APIMessage)
}

struct SSEFrame: Equatable {
    var event: String?
    var data: String
}

/// Incremental parser for `text/event-stream` frames.
struct SSEFrameParser {
    private var event: String?
    private var dataLines: [String] = []

    mutating func consume(line: String) -> SSEFrame? {
        if line.isEmpty {
            guard !dataLines.isEmpty else {
                event = nil
                return nil
            }
            let frame = SSEFrame(event: event, data: dataLines.joined(separator: "\n"))
            event = nil
            dataLines = []
            return frame
        }
        if line.hasPrefix(":") { return nil }
        let field: String
        var value: String
        if let separator = line.firstIndex(of: ":") {
            field = String(line[line.startIndex..<separator])
            value = String(line[line.index(after: separator)...])
            if value.hasPrefix(" ") { value.removeFirst() }
        } else {
            field = line
            value = ""
        }
        switch field {
        case "event": event = value
        case "data": dataLines.append(value)
        default: break
        }
        return nil
    }
}

/// Keeps one authenticated `/api/events` connection open and reconnects on drop.
@MainActor
final class EventHub {
    var onEvent: (@MainActor (LinkitServerEvent) -> Void)?

    private let api: APIClient
    private let auth: AuthSession
    private var task: Task<Void, Never>?

    init(api: APIClient, auth: AuthSession) {
        self.api = api
        self.auth = auth
    }

    func start() {
        stop()
        task = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let shouldContinue = await self.streamUntilDisconnect()
                if !shouldContinue { return }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    /// Returns false when the stream ended because the session is no longer valid.
    private func streamUntilDisconnect() async -> Bool {
        do {
            let (bytes, response) = try await api.makeEventStream()
            if let http = response as? HTTPURLResponse, http.statusCode == 401 {
                auth.handleUnauthorized()
                return false
            }
            onEvent?(.sync)
            var parser = SSEFrameParser()
            for try await line in bytes.lines {
                if let frame = parser.consume(line: line) {
                    handle(frame)
                }
            }
        } catch {
            if Task.isCancelled { return false }
        }
        return true
    }

    private struct UnreadPayload: Decodable {
        var total: Int
    }

    private struct MessagePayload: Decodable {
        var conversationID: String
        var message: APIMessage

        enum CodingKeys: String, CodingKey {
            case conversationID = "conversation_id"
            case message
        }
    }

    private func handle(_ frame: SSEFrame) {
        switch frame.event {
        case "unread":
            if let payload = try? JSONDecoder().decode(UnreadPayload.self, from: Data(frame.data.utf8)) {
                onEvent?(.unread(total: payload.total))
            }
        case "refresh":
            onEvent?(.refreshConversations)
        case "message":
            if let payload = try? JSONDecoder().decode(MessagePayload.self, from: Data(frame.data.utf8)) {
                onEvent?(.message(conversationID: payload.conversationID, message: payload.message))
            }
        default:
            break
        }
    }
}
