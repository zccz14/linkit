import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ComposerView: View {
    let model: ConversationModel
    let members: [APIConversationMember]

    @Environment(AppModel.self) private var app

    @State private var text = ""
    @State private var attachments: [APIAttachment] = []
    @State private var urgent = false
    @State private var isUploading = false
    @State private var isSending = false
    @State private var showMentionPicker = false
    @State private var showPhotoPicker = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showFileImporter = false
    @State private var errorText: String?

    var body: some View {
        VStack(spacing: 8) {
            if !attachments.isEmpty {
                attachmentChips
            }
            if let errorText {
                Text(errorText)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button { showPhotoPicker = true } label: {
                        Label(app.locale.t("chat.attachPhoto"), systemImage: "photo")
                    }
                    Button { showFileImporter = true } label: {
                        Label(app.locale.t("chat.attachFile"), systemImage: "doc")
                    }
                } label: {
                    Image(systemName: "paperclip").font(.title3)
                }
                Button { showMentionPicker = true } label: {
                    Image(systemName: "at").font(.title3)
                }
                .disabled(mentionableMembers.isEmpty)
                Button { urgent.toggle() } label: {
                    Image(systemName: urgent ? "bell.fill" : "bell")
                        .font(.title3)
                        .foregroundStyle(urgent ? Color.red : Color.secondary)
                }
                TextField(app.locale.t("chat.placeholder"), text: $text, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.quaternary, in: RoundedRectangle(cornerRadius: 18))
                Button {
                    Task { await send() }
                } label: {
                    if isSending || isUploading {
                        ProgressView()
                    } else {
                        Image(systemName: "paperplane.fill").font(.title3)
                    }
                }
                .disabled(!canSend)
            }
            if urgent {
                Text(app.locale.t("chat.urgentNotice"))
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 4)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.bar)
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItems, maxSelectionCount: nil, matching: .images, photoLibrary: .shared())
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task {
                await uploadPhotoItems(items)
                photoItems = []
            }
        }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item]) { result in
            switch result {
            case .success(let url):
                Task { await uploadFile(at: url) }
            case .failure(let error):
                errorText = error.localizedDescription
            }
        }
        .sheet(isPresented: $showMentionPicker) {
            MentionPickerSheet(members: mentionableMembers) { member in
                insertMention(member)
            }
        }
    }

    private var canSend: Bool {
        let hasText = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return (hasText || !attachments.isEmpty) && !isSending && !isUploading
    }

    private var mentionableMembers: [APIConversationMember] {
        members.filter { $0.userID != app.store.myUserID && ($0.hasProfile || $0.userType == "bot") }
    }

    private var attachmentChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    HStack(spacing: 6) {
                        Image(systemName: attachment.isImage ? "photo" : "doc")
                        Text(attachment.fileName)
                            .font(.caption)
                            .lineLimit(1)
                        Button {
                            attachments.removeAll { $0.id == attachment.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.quaternary, in: Capsule())
                }
            }
        }
    }

    private func insertMention(_ member: APIConversationMember) {
        if !text.isEmpty, !text.hasSuffix(" ") { text += " " }
        text += "@\(member.username) "
        showMentionPicker = false
    }

    private func send() async {
        guard canSend else { return }
        isSending = true
        defer { isSending = false }
        let candidates = mentionableMembers.map {
            MentionCandidate(userID: $0.userID, username: $0.username, userType: $0.userType, hasProfile: $0.hasProfile)
        }
        let body = Mentions.tokenize(text, members: candidates)
        do {
            try await model.send(body: body, attachmentIDs: attachments.map(\.id), urgent: urgent)
            text = ""
            attachments = []
            urgent = false
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func uploadPhotoItems(_ items: [PhotosPickerItem]) async {
        for item in items {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                let type = item.supportedContentTypes.first
                let mediaType = type?.preferredMIMEType ?? "image/jpeg"
                let ext = type?.preferredFilenameExtension ?? "jpg"
                let name = "photo-\(Int(Date().timeIntervalSince1970)).\(ext)"
                try await upload(data: data, fileName: name, mediaType: mediaType)
            } catch {
                errorText = error.localizedDescription
            }
        }
    }

    private func uploadFile(at url: URL) async {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            try await upload(data: data, fileName: url.lastPathComponent, mediaType: Self.mimeType(for: url))
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func upload(data: Data, fileName: String, mediaType: String) async throws {
        isUploading = true
        defer { isUploading = false }
        let uploaded = try await app.api.uploadAttachment(fileName: fileName, mediaType: mediaType, data: data)
        attachments.append(uploaded)
    }

    private static func mimeType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }
}

struct MentionPickerSheet: View {
    let members: [APIConversationMember]
    var onPick: (APIConversationMember) -> Void

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List(filtered) { member in
                Button {
                    onPick(member)
                    dismiss()
                } label: {
                    HStack(spacing: 10) {
                        SenderAvatar(userID: member.userID, name: member.username, size: 32)
                        Text(member.username)
                        if member.userType == "bot" {
                            TagBadge(text: app.locale.t("chat.bot"))
                        }
                    }
                }
                .buttonStyle(.plain)
            }
            .searchable(text: $query)
            .navigationTitle(app.locale.t("chat.mention"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(app.locale.t("common.cancel")) { dismiss() }
                }
            }
        }
    }

    private var filtered: [APIConversationMember] {
        let needle = Mentions.asciiLowercased(query.trimmingCharacters(in: .whitespaces))
        guard !needle.isEmpty else { return members }
        return members.filter { Mentions.asciiLowercased($0.username).contains(needle) }
    }
}
