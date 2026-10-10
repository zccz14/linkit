import SwiftUI

/// A searchable user picker over `/api/users/search` used by groups and mentions flows.
struct UserSearchSheet: View {
    var excluding: Set<String> = []
    var onPick: @MainActor (APIUserSearchResult) async -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var results: [APIUserSearchResult] = []
    @State private var isSearching = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            List(filtered) { user in
                Button {
                    Task {
                        await onPick(user)
                        dismiss()
                    }
                } label: {
                    HStack(spacing: 10) {
                        RemoteAvatar(url: user.avatarURL.flatMap(URL.init(string:)), name: user.username, size: 32)
                        Text(user.username)
                    }
                }
                .buttonStyle(.plain)
            }
            .overlay {
                if let errorText {
                    Text(errorText)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding()
                } else if filtered.isEmpty {
                    Text(isSearching ? app.locale.t("common.loading") : app.locale.t("dir.searchPrompt"))
                        .foregroundStyle(.secondary)
                }
            }
            .searchable(text: $query)
            .navigationTitle(app.locale.t("dir.searchPrompt"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(app.locale.t("common.cancel")) { dismiss() }
                }
            }
            .task(id: query) {
                let trimmed = query.trimmingCharacters(in: .whitespaces)
                guard !trimmed.isEmpty else {
                    results = []
                    return
                }
                try? await Task.sleep(for: .milliseconds(250))
                if Task.isCancelled { return }
                await search(trimmed)
            }
        }
    }

    private var filtered: [APIUserSearchResult] {
        results.filter { !excluding.contains($0.userID) }
    }

    private func search(_ query: String) async {
        isSearching = true
        defer { isSearching = false }
        do {
            let found: [APIUserSearchResult] = try await app.api.request(
                "GET",
                "/api/users/search",
                query: [URLQueryItem(name: "query", value: query)]
            )
            results = found
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }
}
