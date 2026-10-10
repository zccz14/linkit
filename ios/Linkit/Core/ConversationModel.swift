import Foundation
import Observation

/// One open conversation: the latest page of messages, older paging, sending and read state.
@MainActor
@Observable
final class ConversationModel {
    let conversationID: String

    private let api: APIClient
    private let store: AppStore

    var detail: APIConversationDetail?
    var messages: [APIMessage] = []
    var olderCursor: String?
    var isLoading = false
    var isLoadingOlder = false
    var errorMessage: String?

    private var knownIDs: Set<String> = []

    init(conversationID: String, api: APIClient, store: AppStore) {
        self.conversationID = conversationID
        self.api = api
        self.store = store
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page: APIMessagePage = try await api.request("GET", "/api/conversations/\(conversationID)/messages")
            detail = try await api.request("GET", "/api/conversations/\(conversationID)")
            messages = page.messages
            knownIDs = Set(messages.map(\.id))
            olderCursor = page.olderCursor
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadOlder() async {
        guard let cursor = olderCursor, !isLoadingOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let page: APIMessagePage = try await api.request(
                "GET",
                "/api/conversations/\(conversationID)/messages",
                query: [URLQueryItem(name: "before_cursor", value: cursor)]
            )
            let fresh = page.messages.filter { !knownIDs.contains($0.id) }
            messages.insert(contentsOf: fresh, at: 0)
            knownIDs.formUnion(fresh.map(\.id))
            olderCursor = page.olderCursor
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func receive(_ message: APIMessage) {
        guard !knownIDs.contains(message.id) else { return }
        knownIDs.insert(message.id)
        messages.append(message)
    }

    func send(body: String, attachmentIDs: [String], urgent: Bool) async throws {
        let body = SendMessageBody(body: body, attachmentIDs: attachmentIDs, urgent: urgent)
        let message: APIMessage = try await api.request(
            "POST",
            "/api/conversations/\(conversationID)/messages",
            jsonBody: body
        )
        receive(message)
        await store.loadConversations()
    }

    func markRead() async {
        try? await api.requestVoid("POST", "/api/conversations/\(conversationID)/read")
        await store.refreshUnread()
    }

    func refreshDetail() async {
        detail = try? await api.request("GET", "/api/conversations/\(conversationID)")
    }

    func apply(conversation: APIConversation) {
        detail = APIConversationDetail(conversation: conversation, members: detail?.members ?? [])
    }
}
