import Foundation
import Observation

/// Signed-in app data: the viewer, conversation list, unread badge and public profile cache.
@MainActor
@Observable
final class AppStore {
    private let api: APIClient

    var me: APIMe?
    var conversations: [APIConversation] = []
    var unreadTotal = 0
    private(set) var profiles: [String: APIPublicProfile] = {}

    private var resolvedProfileIDs: Set<String> = []

    init(api: APIClient) {
        self.api = api
    }

    var myUserID: String { me?.id ?? "" }

    func reset() {
        me = nil
        conversations = []
        unreadTotal = 0
        profiles = [:]
        resolvedProfileIDs = []
    }

    // MARK: - Loads

    func loadMe() async {
        me = try? await api.request("GET", "/api/me")
    }

    func loadConversations() async {
        if let list: [APIConversation] = try? await api.request("GET", "/api/conversations") {
            conversations = list
        }
    }

    func refreshUnread() async {
        if let value: APIUnreadCount = try? await api.request("GET", "/api/unread-count") {
            unreadTotal = value.total
        }
    }

    // MARK: - Public profiles

    /// Resolves public profiles for the requested users once; known users are cached.
    func ensureProfiles(_ userIDs: [String]) async {
        let unresolved = Set(userIDs).subtracting(resolvedProfileIDs).sorted()
        guard !unresolved.isEmpty else { return }
        guard let list = try? await api.publicProfiles(ids: unresolved) else { return }
        for profile in list {
            profiles[profile.userID] = profile
        }
        for id in unresolved {
            resolvedProfileIDs.insert(id)
        }
    }

    func profile(_ userID: String) -> APIPublicProfile? {
        profiles[userID]
    }

    func invalidateProfile(_ userID: String) {
        profiles.removeValue(forKey: userID)
        resolvedProfileIDs.remove(userID)
    }

    // MARK: - Server events

    func handle(_ event: LinkitServerEvent) {
        switch event {
        case .sync:
            Task {
                await loadConversations()
                await refreshUnread()
            }
        case .unread(let total):
            unreadTotal = total
        case .refreshConversations:
            Task {
                await loadConversations()
                await refreshUnread()
            }
        case .message:
            Task {
                await loadConversations()
            }
        }
    }
}
