import SwiftUI

struct MessageListView: View {
    let model: ConversationModel

    @Environment(AppModel.self) private var app
    @State private var previewedImage: PreviewedImage?

    private struct PreviewedImage: Identifiable {
        let attachment: APIAttachment
        var id: String { attachment.id }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if model.olderCursor != nil {
                        Button {
                            Task { await model.loadOlder() }
                        } label: {
                            Text(model.isLoadingOlder ? app.locale.t("chat.loadingOlder") : app.locale.t("chat.loadOlder"))
                                .font(.footnote)
                        }
                        .frame(maxWidth: .infinity)
                        .disabled(model.isLoadingOlder)
                    }
                    ForEach(model.messages) { message in
                        MessageRowView(
                            message: message,
                            mine: message.senderKind == "user" && message.senderID == app.store.myUserID
                        ) { attachment in
                            previewedImage = PreviewedImage(attachment: attachment)
                        }
                        .id(message.id)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: model.messages.last?.id) { _, lastID in
                guard let lastID else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(lastID, anchor: .bottom)
                }
            }
            .overlay {
                if model.isLoading && model.messages.isEmpty {
                    ProgressView()
                } else if model.messages.isEmpty, let error = model.errorMessage {
                    ContentUnavailableView(app.locale.t("common.error"), systemImage: "exclamationmark.triangle", description: Text(error))
                }
            }
            .task(id: model.messages.count) {
                let senderIDs = Set(model.messages.map(\.senderID)).sorted()
                await app.store.ensureProfiles(senderIDs)
            }
        }
        .sheet(item: $previewedImage) { item in
            ImagePreviewSheet(attachment: item.attachment)
        }
    }
}

struct MessageRowView: View {
    let message: APIMessage
    let mine: Bool
    var onImageTap: @MainActor (APIAttachment) -> Void

    @Environment(AppModel.self) private var app

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if mine { Spacer(minLength: 36) }
            if !mine {
                SenderAvatar(userID: message.senderID, name: displayName, size: 30)
            }
            VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                header
                bubble
            }
            if mine {
                SenderAvatar(userID: message.senderID, name: displayName, size: 30)
            }
            if !mine { Spacer(minLength: 36) }
        }
    }

    private var displayName: String {
        if message.senderDeleted { return app.locale.t("chat.deletedBot") }
        if let profile = app.store.profile(message.senderID) { return profile.username }
        return message.senderName
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text(displayName)
                .font(.caption.weight(.medium))
            Text(Self.timeText(message.createdAt))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !message.body.isEmpty {
                Text(Mentions.attributedBody(message.body, mentions: message.mentions))
                    .font(.body)
                    .textSelection(.enabled)
            }
            if message.isBot || message.urgent {
                HStack(spacing: 6) {
                    if message.isBot {
                        TagBadge(text: app.locale.t("chat.bot"))
                    }
                    if message.urgent {
                        TagBadge(text: app.locale.t("chat.urgent"), tint: .red)
                    }
                }
            }
            ForEach(message.attachments) { attachment in
                if attachment.isImage {
                    AttachmentImageView(attachmentID: attachment.id) {
                        onImageTap(attachment)
                    }
                } else {
                    FileAttachmentView(attachment: attachment)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(mine ? AnyShapeStyle(.tint.opacity(0.14)) : AnyShapeStyle(.quaternary), in: RoundedRectangle(cornerRadius: 16))
        .frame(maxWidth: 560, alignment: mine ? .trailing : .leading)
    }

    private static func timeText(_ seconds: Int64) -> String {
        Date(timeIntervalSince1970: TimeInterval(seconds))
            .formatted(date: .abbreviated, time: .shortened)
    }
}

extension Mentions {
    /// Renders stored body text with mention tokens replaced by `@username` segments.
    static func attributedBody(_ body: String, mentions: [APIMessageMention]) -> AttributedString {
        var result = AttributedString()
        for segment in split(body, mentions: mentions) {
            var piece = AttributedString(segment.text)
            if segment.username != nil {
                piece.foregroundColor = .accentColor
                piece.font = .body.weight(.semibold)
            }
            result.append(piece)
        }
        return result
    }
}
