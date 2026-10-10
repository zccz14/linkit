import PhotosUI
import SwiftUI

struct ProfileEditorView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    @State private var username = ""
    @State private var intro = ""
    @State private var avatarAttachment: APIAttachment?
    @State private var removeAvatar = false
    @State private var showPhotoPicker = false
    @State private var photoItem: PhotosPickerItem?
    @State private var isSaving = false
    @State private var isUploading = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section(app.locale.t("edit.avatar")) {
                    HStack(spacing: 16) {
                        avatarPreview
                        Button(app.locale.t("edit.chooseAvatar")) {
                            showPhotoPicker = true
                        }
                        .disabled(isUploading)
                        if hasAvatar {
                            Button(role: .destructive) {
                                removeAvatar = true
                                avatarAttachment = nil
                            } label: {
                                Text(app.locale.t("edit.removeAvatar"))
                            }
                        }
                    }
                }
                Section(app.locale.t("edit.username")) {
                    TextField(app.locale.t("edit.username"), text: $username)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }
                Section(app.locale.t("edit.intro")) {
                    TextField(app.locale.t("edit.intro"), text: $intro, axis: .vertical)
                        .lineLimit(3...6)
                    Text("\(intro.count)/280")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let errorText {
                    Section {
                        Text(errorText).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(app.locale.t("edit.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(app.locale.t("common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(app.locale.t("common.save")) {
                        Task { await save() }
                    }
                    .disabled(!canSave)
                }
            }
            .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images, photoLibrary: .shared())
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    await upload(item)
                    photoItem = nil
                }
            }
            .task { loadCurrent() }
        }
    }

    private var canSave: Bool {
        !isSaving && !isUploading && !username.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var hasAvatar: Bool {
        if avatarAttachment != nil { return true }
        if removeAvatar { return false }
        return app.store.me?.profile?.avatarAttachmentID != nil
    }

    @ViewBuilder
    private var avatarPreview: some View {
        if let avatarAttachment {
            AttachmentAvatar(attachmentID: avatarAttachment.id, size: 56)
        } else if hasAvatar, let profile = app.store.me?.profile {
            SenderAvatar(userID: profile.userID, name: profile.username, size: 56)
        } else {
            Circle()
                .fill(.quaternary)
                .frame(width: 56, height: 56)
        }
    }

    private func loadCurrent() {
        guard username.isEmpty, let profile = app.store.me?.profile else { return }
        username = profile.username
        intro = profile.intro
    }

    private func upload(_ item: PhotosPickerItem) async {
        isUploading = true
        defer { isUploading = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            let type = item.supportedContentTypes.first
            let mediaType = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? "jpg"
            let attachment = try await app.api.uploadAttachment(fileName: "avatar.\(ext)", mediaType: mediaType, data: data)
            avatarAttachment = attachment
            removeAvatar = false
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let current = app.store.me?.profile
        let avatarID: String? = removeAvatar ? nil : (avatarAttachment?.id ?? current?.avatarAttachmentID)
        do {
            try await app.saveProfile(
                username: username.trimmingCharacters(in: .whitespaces),
                intro: intro,
                language: nil,
                theme: nil,
                avatarAttachmentID: avatarID
            )
            dismiss()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
