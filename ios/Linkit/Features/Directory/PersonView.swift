import SwiftUI

struct PersonView: View {
    let user: APIUserSearchResult

    @Environment(AppModel.self) private var app

    @State private var profile: APIPublicProfile?
    @State private var openedConversation: APIConversation?
    @State private var pushConversation = false
    @State private var isOpening = false
    @State private var errorText: String?

    var body: some View {
        VStack(spacing: 14) {
            Spacer().frame(height: 16)
            SenderAvatar(userID: user.userID, name: user.username, size: 88)
            Text(profile?.username ?? user.username)
                .font(.title2.weight(.semibold))
            if let intro = profile?.intro, !intro.isEmpty {
                Text(intro)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            Button {
                Task { await openDirect() }
            } label: {
                if isOpening {
                    ProgressView()
                } else {
                    Label(app.locale.t("person.message"), systemImage: "bubble.left")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isOpening || isSelf)
            if isSelf {
                Text(app.locale.t("person.self"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let errorText {
                Text(errorText)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            Spacer()
        }
        .navigationTitle(user.username)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            profile = try? await app.api.publicProfile(userID: user.userID)
            await app.store.ensureProfiles([user.userID])
        }
        .navigationDestination(isPresented: $pushConversation) {
            if let openedConversation {
                ConversationView(conversation: openedConversation)
            }
        }
    }

    private var isSelf: Bool {
        user.userID == app.store.myUserID
    }

    private func openDirect() async {
        isOpening = true
        defer { isOpening = false }
        do {
            let encoded = user.username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? user.username
            let conversation: APIConversation = try await app.api.request("POST", "/api/conversations/direct/\(encoded)")
            openedConversation = conversation
            pushConversation = true
            await app.store.loadConversations()
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}
