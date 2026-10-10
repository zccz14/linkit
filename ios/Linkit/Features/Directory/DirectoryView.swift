import SwiftUI

struct DirectoryView: View {
    @Environment(AppModel.self) private var app

    @State private var query = ""
    @State private var users: [APIProfile] = []
    @State private var results: [APIUserSearchResult] = []
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if isSearching {
                    ForEach(results) { user in
                        NavigationLink(value: user) {
                            userRow(userID: user.userID, username: user.username, avatarURL: user.avatarURL, intro: nil)
                        }
                    }
                } else {
                    ForEach(users) { profile in
                        NavigationLink(value: profile) {
                            userRow(userID: profile.userID, username: profile.username, avatarURL: nil, intro: profile.intro)
                        }
                    }
                }
            }
            .listStyle(.plain)
            .overlay {
                if visibleRows.isEmpty {
                    ContentUnavailableView(
                        app.locale.t("dir.emptyTitle"),
                        systemImage: "person.2",
                        description: Text(app.locale.t("dir.emptyDescription"))
                    )
                }
            }
            .searchable(text: $query, prompt: Text(app.locale.t("dir.searchPrompt")))
            .navigationTitle(app.locale.t("tab.directory"))
            .navigationDestination(for: APIUserSearchResult.self) { user in
                PersonView(user: user)
            }
            .navigationDestination(for: APIProfile.self) { profile in
                PersonView(user: APIUserSearchResult(userID: profile.userID, username: profile.username, avatarURL: nil))
            }
            .refreshable { await loadUsers() }
        }
        .task { await loadUsers() }
        .task(id: query) { await searchIfNeeded() }
    }

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var visibleRows: [String] {
        isSearching ? results.map(\.userID) : users.map(\.userID)
    }

    private func userRow(userID: String, username: String, avatarURL: String?, intro: String?) -> some View {
        HStack(spacing: 10) {
            SenderAvatar(userID: userID, name: username, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(username)
                if let intro, !intro.isEmpty {
                    Text(intro)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }

    private func loadUsers() async {
        if let list: [APIProfile] = try? await app.api.request("GET", "/api/users") {
            users = list
        }
    }

    private func searchIfNeeded() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            results = []
            return
        }
        try? await Task.sleep(for: .milliseconds(250))
        if Task.isCancelled { return }
        if let found: [APIUserSearchResult] = try? await app.api.request(
            "GET",
            "/api/users/search",
            query: [URLQueryItem(name: "query", value: trimmed)]
        ) {
            results = found
        }
    }
}
