import Foundation
import Observation

/// Root application object: the Auth Mini session, the API client, chat data and the event stream.
@MainActor
@Observable
final class AppModel {
    let auth: AuthSession
    let api: APIClient
    let store: AppStore
    let events: EventHub
    let locale: LocaleController

    var activeConversation: ConversationModel?

    private var started = false

    init() {
        let auth = AuthSession()
        let api = APIClient(auth: auth)
        self.auth = auth
        self.api = api
        self.store = AppStore(api: api)
        self.events = EventHub(api: api, auth: auth)
        self.locale = LocaleController()
    }

    func startIfNeeded() async {
        guard !started else { return }
        started = true
        await auth.bootstrap()
        if auth.phase == .signedIn {
            await signedIn()
        }
    }

    func signedIn() async {
        await store.loadMe()
        if let id = store.me?.id { auth.setMeID(id) }
        applyProfilePreferences()
        await store.loadConversations()
        await store.refreshUnread()
        events.onEvent = { [weak self] event in
            self?.route(event)
        }
        events.start()
    }

    func signedOutCleanup() {
        events.stop()
        events.onEvent = nil
        activeConversation = nil
        store.reset()
    }

    func signOut() async {
        events.stop()
        events.onEvent = nil
        activeConversation = nil
        await auth.signOut()
        store.reset()
    }

    /// The signed-in profile owns the language preference, matching the web app.
    func applyProfilePreferences() {
        guard let profile = store.me?.profile else { return }
        let languages = profile.lang
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
        if !languages.isEmpty {
            locale.setLanguage(LocaleController.resolve(from: languages))
        }
    }

    func saveProfile(
        username: String,
        intro: String,
        language: String?,
        theme: String?,
        avatarAttachmentID: String?
    ) async throws {
        let update = APIProfileUpdate(
            username: username,
            intro: intro,
            lang: language,
            theme: theme,
            avatarAttachmentID: avatarAttachmentID
        )
        let saved: APIProfile = try await api.request("PUT", "/api/profile", jsonBody: update)
        store.me = APIMe(id: saved.userID, root: store.me?.root ?? false, profile: saved)
        if language != nil {
            applyProfilePreferences()
        }
        store.invalidateProfile(saved.userID)
        await store.ensureProfiles([saved.userID])
    }

    private func route(_ event: LinkitServerEvent) {
        store.handle(event)
        if case .message(let conversationID, let message) = event,
           let active = activeConversation,
           active.conversationID == conversationID {
            active.receive(message)
            Task { await active.markRead() }
        }
    }
}
