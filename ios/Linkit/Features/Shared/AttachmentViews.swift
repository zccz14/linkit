import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct AttachmentAvatar: View {
    let attachmentID: String
    var size: CGFloat = 40

    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let image = AttachmentLoader.shared.cachedImage(attachmentID: attachmentID, variant: .avatar) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Color.clear
            }
        }
        .frame(width: size, height: size)
        .background(.quaternary)
        .clipShape(Circle())
        .task(id: attachmentID) {
            _ = await AttachmentLoader.shared.loadImage(attachmentID: attachmentID, variant: .avatar, api: app.api)
        }
    }
}

struct AttachmentImageView: View {
    let attachmentID: String
    var maxWidth: CGFloat = 240
    var onTap: (() -> Void)?

    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let image = AttachmentLoader.shared.cachedImage(attachmentID: attachmentID, variant: .content) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: maxWidth)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .contentShape(Rectangle())
                    .onTapGesture { onTap?() }
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.quaternary)
                    .frame(width: maxWidth * 0.7, height: 140)
                    .overlay(ProgressView())
            }
        }
        .task(id: attachmentID) {
            _ = await AttachmentLoader.shared.loadImage(attachmentID: attachmentID, variant: .content, api: app.api)
        }
    }
}

struct FileAttachmentView: View {
    let attachment: APIAttachment

    @Environment(AppModel.self) private var app
    @State private var previewURL: URL?
    @State private var isDownloading = false

    var body: some View {
        Button {
            Task { await open() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "doc")
                VStack(alignment: .leading, spacing: 1) {
                    Text(attachment.fileName)
                        .font(.footnote)
                        .lineLimit(1)
                    Text(isDownloading ? app.locale.t("chat.downloading") : attachment.byteSizeText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
        .quickLookPreview($previewURL)
    }

    private func open() async {
        guard !isDownloading else { return }
        isDownloading = true
        defer { isDownloading = false }
        previewURL = try? await AttachmentLoader.shared.fileURL(attachment: attachment, api: app.api)
    }
}

struct ImagePreviewSheet: View {
    let attachment: APIAttachment

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let image = AttachmentLoader.shared.cachedImage(attachmentID: attachment.id, variant: .content) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(attachment.fileName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(app.locale.t("common.done")) { dismiss() }
                }
            }
            .task(id: attachment.id) {
                _ = await AttachmentLoader.shared.loadImage(attachmentID: attachment.id, variant: .content, api: app.api)
            }
        }
    }
}
