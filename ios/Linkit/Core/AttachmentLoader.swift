import Foundation
import Observation
import UIKit

/// Downloads and caches authenticated attachments (message content and avatar derivatives).
@MainActor
@Observable
final class AttachmentLoader {
    static let shared = AttachmentLoader()

    enum Variant: String {
        case content
        case avatar
    }

    private var images: [String: UIImage] = [:]
    private var inFlight: Set<String> = []

    private init() {}

    func cachedImage(attachmentID: String, variant: Variant) -> UIImage? {
        images[key(attachmentID, variant)]
    }

    @discardableResult
    func loadImage(attachmentID: String, variant: Variant, api: APIClient) async -> UIImage? {
        let cacheKey = key(attachmentID, variant)
        if let image = images[cacheKey] { return image }
        if inFlight.contains(cacheKey) { return nil }
        inFlight.insert(cacheKey)
        defer { inFlight.remove(cacheKey) }
        do {
            let data: Data
            switch variant {
            case .content:
                data = try await api.downloadAttachmentContent(id: attachmentID)
            case .avatar:
                data = try await api.downloadAttachmentAvatar(id: attachmentID)
            }
            guard let image = UIImage(data: data) else { return nil }
            images[cacheKey] = image
            return image
        } catch {
            return nil
        }
    }

    /// Downloads a non-image attachment to a temporary file for previewing and sharing.
    func fileURL(attachment: APIAttachment, api: APIClient) async throws -> URL {
        let fileManager = FileManager.default
        let directory = fileManager.temporaryDirectory.appendingPathComponent("linkit-attachments", isDirectory: true)
        if !fileManager.fileExists(atPath: directory.path) {
            try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        let target = directory.appendingPathComponent("\(attachment.id)-\(attachment.fileName)")
        if fileManager.fileExists(atPath: target.path) { return target }
        let data = try await api.downloadAttachmentContent(id: attachment.id)
        try data.write(to: target)
        return target
    }

    private func key(_ id: String, _ variant: Variant) -> String {
        "\(variant.rawValue):\(id)"
    }
}

extension APIAttachment {
    var byteSizeText: String {
        ByteCountFormatter.string(fromByteCount: byteSize, countStyle: .file)
    }
}
