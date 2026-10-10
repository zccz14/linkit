import SwiftUI

struct NewGroupView: View {
    var onCreated: @MainActor (APIConversation) -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var selected: [APIUserSearchResult] = []
    @State private var showPicker = false
    @State private var isCreating = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(app.locale.t("group.name")) {
                    TextField(app.locale.t("group.name"), text: $title)
                }
                Section(app.locale.t("group.members")) {
                    ForEach(selected) { user in
                        HStack {
                            Text(user.username)
                            Spacer()
                            Button(role: .destructive) {
                                selected.removeAll { $0.userID == user.userID }
                            } label: {
                                Image(systemName: "minus.circle")
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    Button {
                        showPicker = true
                    } label: {
                        Label(app.locale.t("group.addMember"), systemImage: "plus")
                    }
                }
                if let errorText {
                    Section {
                        Text(errorText).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(app.locale.t("group.create"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(app.locale.t("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(app.locale.t("group.create")) {
                        Task { await create() }
                    }
                    .disabled(!canCreate || isCreating)
                }
            }
            .sheet(isPresented: $showPicker) {
                UserSearchSheet(excluding: Set(selected.map(\.userID))) { user in
                    if !selected.contains(where: { $0.userID == user.userID }) {
                        selected.append(user)
                    }
                }
            }
        }
    }

    private var canCreate: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func create() async {
        isCreating = true
        defer { isCreating = false }
        do {
            let body = CreateGroupBody(
                title: title.trimmingCharacters(in: .whitespaces),
                userIDs: selected.map(\.userID)
            )
            let conversation: APIConversation = try await app.api.request("POST", "/api/conversations", jsonBody: body)
            await app.store.loadConversations()
            onCreated(conversation)
        } catch {
            errorText = error.localizedDescription
        }
    }
}
