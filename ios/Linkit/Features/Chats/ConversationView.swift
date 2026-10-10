import SwiftUI

struct ConversationView: View {
    let conversation: APIConversation

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var model: ConversationModel?
    @State private var showManage = false

    var body: some View {
        VStack(spacing: 0) {
            if let model {
                MessageListView(model: model)
                Divider()
                ComposerView(model: model, members: model.detail?.members ?? [])
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model?.detail?.conversation.isGroup == true {
                ToolbarItem(placement: .primaryAction) {
                    Button { showManage = true } label: {
                        Image(systemName: "person.2")
                    }
                }
            }
        }
        .sheet(isPresented: $showManage) {
            if let model {
                NavigationStack {
                    GroupManageView(model: model, onDeleted: {
                        showManage = false
                        dismiss()
                    })
                }
            }
        }
        .task {
            guard model == nil else { return }
            let created = ConversationModel(conversationID: conversation.id, api: app.api, store: app.store)
            model = created
            app.activeConversation = created
            await created.load()
            await created.markRead()
        }
        .onDisappear {
            if let model, app.activeConversation === model {
                app.activeConversation = nil
            }
            Task { await app.store.loadConversations() }
        }
    }

    private var title: String {
        if let modelTitle = model?.detail?.conversation {
            return Self.title(for: modelTitle, locale: app.locale)
        }
        return Self.title(for: conversation, locale: app.locale)
    }

    private static func title(for conversation: APIConversation, locale: LocaleController) -> String {
        if !conversation.title.isEmpty { return conversation.title }
        if let counterpart = conversation.counterpartName { return counterpart }
        return locale.t("chat.direct")
    }
}
