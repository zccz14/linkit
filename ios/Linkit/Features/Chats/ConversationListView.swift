import SwiftUI

struct ConversationListView: View {
    @Environment(AppModel.self) private var app
    @State private var path = NavigationPath()
    @State private var showNewGroup = false

    var body: some View {
        NavigationStack(path: $path) {
            List(app.store.conversations) { conversation in
                NavigationLink(value: conversation) {
                    ConversationRow(conversation: conversation)
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
            }
            .listStyle(.plain)
            .overlay {
                if app.store.conversations.isEmpty {
                    ContentUnavailableView(
                        app.locale.t("chat.emptyTitle"),
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text(app.locale.t("chat.emptyDescription"))
                    )
                }
            }
            .navigationTitle(app.locale.t("tab.chats"))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showNewGroup = true } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .navigationDestination(for: APIConversation.self) { conversation in
                ConversationView(conversation: conversation)
            }
            .refreshable { await app.store.loadConversations() }
        }
        .task { await app.store.loadConversations() }
        .sheet(isPresented: $showNewGroup) {
            NewGroupView { conversation in
                showNewGroup = false
                path.append(conversation)
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: APIConversation

    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(spacing: 12) {
            ConversationAvatarView(conversation: conversation)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                if let latest = conversation.latestBody, !latest.isEmpty {
                    Text(latest)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 5) {
                if let latestAt = conversation.latestAt {
                    Text(Self.timeText(latestAt))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if conversation.unreadCount > 0 {
                    Text("\(conversation.unreadCount)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(.tint, in: Capsule())
                }
            }
        }
    }

    private var title: String {
        if conversation.isGroup {
            return conversation.title.isEmpty ? app.locale.t("chat.untitledGroup") : conversation.title
        }
        return conversation.counterpartName ?? app.locale.t("chat.direct")
    }

    private static func timeText(_ seconds: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(seconds))
        if Calendar.current.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

struct ConversationAvatarView: View {
    let conversation: APIConversation
    var size: CGFloat = 44

    var body: some View {
        Group {
            if conversation.isGroup {
                if let attachmentID = conversation.avatarAttachmentID {
                    AttachmentAvatar(attachmentID: attachmentID, size: size)
                } else {
                    groupFallback
                }
            } else if let userID = conversation.counterpartUserID {
                SenderAvatar(userID: userID, name: conversation.counterpartName ?? "", size: size)
            } else {
                groupFallback
            }
        }
    }

    private var groupFallback: some View {
        ZStack {
            Circle().fill(.quaternary)
            LinkitMarkView()
                .frame(width: size * 0.48, height: size * 0.48)
                .foregroundStyle(.secondary)
        }
        .frame(width: size, height: size)
    }
}
