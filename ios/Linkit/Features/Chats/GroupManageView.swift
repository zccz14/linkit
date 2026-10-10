import SwiftUI

struct GroupManageView: View {
    let model: ConversationModel
    var onDeleted: @MainActor () -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var showAddMember = false
    @State private var showDeleteConfirm = false
    @State private var errorText: String?
    @State private var isBusy = false

    var body: some View {
        List {
            if let detail = model.detail {
                titleSection(detail)
                membersSection(detail)
                if isOwner {
                    Section {
                        Button(role: .destructive) {
                            showDeleteConfirm = true
                        } label: {
                            Label(app.locale.t("group.delete"), systemImage: "trash")
                        }
                    }
                }
            } else {
                Section {
                    ProgressView()
                }
            }
            if let errorText {
                Section {
                    Text(errorText).foregroundStyle(.red).font(.footnote)
                }
            }
        }
        .navigationTitle(app.locale.t("group.manage"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(app.locale.t("common.done")) { dismiss() }
            }
        }
        .task {
            if model.detail == nil {
                await model.refreshDetail()
            }
            title = model.detail?.conversation.title ?? ""
        }
        .sheet(isPresented: $showAddMember) {
            UserSearchSheet(excluding: Set(model.detail?.members.map(\.userID) ?? [])) { user in
                await addMember(user)
            }
        }
        .confirmationDialog(app.locale.t("group.deleteConfirm"), isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button(app.locale.t("group.delete"), role: .destructive) {
                Task { await deleteGroup() }
            }
            Button(app.locale.t("common.cancel"), role: .cancel) {}
        }
    }

    private var isOwner: Bool {
        model.detail?.conversation.createdBy == app.store.myUserID
    }

    private func titleSection(_ detail: APIConversationDetail) -> some View {
        Section(app.locale.t("group.titleSection")) {
            TextField(app.locale.t("group.name"), text: $title)
            if isOwner && title != detail.conversation.title && !title.trimmingCharacters(in: .whitespaces).isEmpty {
                Button(app.locale.t("group.saveTitle")) {
                    Task { await saveTitle() }
                }
                .disabled(isBusy)
            }
        }
    }

    private func membersSection(_ detail: APIConversationDetail) -> some View {
        Section(app.locale.t("group.members")) {
            ForEach(detail.members) { member in
                HStack(spacing: 10) {
                    SenderAvatar(userID: member.userID, name: member.username, size: 32)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(member.username)
                        Text(member.role == "owner" ? app.locale.t("group.owner") : app.locale.t("group.member"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if isOwner && member.userID != app.store.myUserID {
                        Button(role: .destructive) {
                            Task { await remove(member) }
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.borderless)
                        .disabled(isBusy)
                    }
                }
            }
            Button {
                showAddMember = true
            } label: {
                Label(app.locale.t("group.addMember"), systemImage: "plus")
            }
        }
    }

    private func saveTitle() async {
        isBusy = true
        defer { isBusy = false }
        do {
            let trimmed = title.trimmingCharacters(in: .whitespaces)
            let updated: APIConversation = try await app.api.request(
                "PATCH",
                "/api/conversations/\(model.conversationID)",
                jsonBody: ["title": trimmed]
            )
            model.apply(conversation: updated)
            await app.store.loadConversations()
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func addMember(_ user: APIUserSearchResult) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await app.api.requestVoid(
                "POST",
                "/api/conversations/\(model.conversationID)/members",
                jsonBody: MemberBody(userID: user.userID)
            )
            await model.refreshDetail()
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func remove(_ member: APIConversationMember) async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await app.api.requestVoid(
                "DELETE",
                "/api/conversations/\(model.conversationID)/members",
                jsonBody: MemberBody(userID: member.userID)
            )
            await model.refreshDetail()
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func deleteGroup() async {
        isBusy = true
        defer { isBusy = false }
        do {
            try await app.api.requestVoid("DELETE", "/api/conversations/\(model.conversationID)")
            await app.store.loadConversations()
            onDeleted()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
