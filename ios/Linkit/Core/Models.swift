import Foundation

// MARK: - Public instance configuration

struct APIConfig: Codable, Sendable {
    var setupRequired: Bool
    var authIssuer: String?
    var publicOrigin: String?

    enum CodingKeys: String, CodingKey {
        case setupRequired = "setup_required"
        case authIssuer = "auth_issuer"
        case publicOrigin = "public_origin"
    }
}

// MARK: - Profiles

struct APIProfile: Codable, Hashable, Sendable, Identifiable {
    var userID: String
    var username: String
    var intro: String
    var lang: String
    var theme: String
    var avatarAttachmentID: String?
    var updatedAt: Int64

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case intro
        case lang
        case theme
        case avatarAttachmentID = "avatar_attachment_id"
        case updatedAt = "updated_at"
    }
}

/// `avatar_attachment_id` is always encoded: `nil` clears the avatar on the server.
struct APIProfileUpdate: Encodable, Sendable {
    var username: String
    var intro: String
    var lang: String?
    var theme: String?
    var avatarAttachmentID: String?

    enum CodingKeys: String, CodingKey {
        case username
        case intro
        case lang
        case theme
        case avatarAttachmentID = "avatar_attachment_id"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(username, forKey: .username)
        try container.encode(intro, forKey: .intro)
        try container.encodeIfPresent(lang, forKey: .lang)
        try container.encodeIfPresent(theme, forKey: .theme)
        try container.encode(avatarAttachmentID, forKey: .avatarAttachmentID)
    }
}

struct APIMe: Codable, Sendable {
    var id: String
    var root: Bool
    var profile: APIProfile?
}

struct APIPublicProfile: Codable, Hashable, Sendable, Identifiable {
    var userID: String
    var username: String
    var intro: String
    var avatarURL: String?

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case intro
        case avatarURL = "avatar_url"
    }
}

struct APIUserSearchResult: Codable, Hashable, Sendable, Identifiable {
    var userID: String
    var username: String
    var avatarURL: String?

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case avatarURL = "avatar_url"
    }
}

// MARK: - Conversations

struct APIConversation: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var kind: String
    var title: String
    var createdBy: String
    var createdAt: Int64
    var avatarAttachmentID: String?
    var counterpartUserID: String?
    var counterpartName: String?
    var counterpartAvatarAttachmentID: String?
    var latestBody: String?
    var latestAt: Int64?
    var unreadCount: Int

    var isGroup: Bool { kind == "group" }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case title
        case createdBy = "created_by"
        case createdAt = "created_at"
        case avatarAttachmentID = "avatar_attachment_id"
        case counterpartUserID = "counterpart_user_id"
        case counterpartName = "counterpart_name"
        case counterpartAvatarAttachmentID = "counterpart_avatar_attachment_id"
        case latestBody = "latest_body"
        case latestAt = "latest_at"
        case unreadCount = "unread_count"
    }
}

struct APIConversationMember: Codable, Hashable, Sendable, Identifiable {
    var userID: String
    var username: String
    var userType: String
    var role: String
    var hasProfile: Bool

    var id: String { userID }

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
        case userType = "user_type"
        case role
        case hasProfile = "has_profile"
    }
}

/// The server flattens the conversation fields and appends `members`.
struct APIConversationDetail: Decodable, Sendable {
    var conversation: APIConversation
    var members: [APIConversationMember]

    init(conversation: APIConversation, members: [APIConversationMember]) {
        self.conversation = conversation
        self.members = members
    }

    private struct MembersBox: Decodable {
        var members: [APIConversationMember]
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        conversation = try container.decode(APIConversation.self)
        members = try container.decode(MembersBox.self).members
    }
}

// MARK: - Messages

struct APIAttachment: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var fileName: String
    var mediaType: String
    var byteSize: Int64
    var createdAt: Int64

    var isImage: Bool { mediaType.hasPrefix("image/") }

    enum CodingKeys: String, CodingKey {
        case id
        case fileName = "file_name"
        case mediaType = "media_type"
        case byteSize = "byte_size"
        case createdAt = "created_at"
    }
}

struct APIMessageMention: Codable, Hashable, Sendable {
    var userID: String
    var username: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case username
    }
}

struct APIMessage: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var conversationID: String
    var senderKind: String
    var senderID: String
    var senderName: String
    var senderDeleted: Bool
    var body: String
    var urgent: Bool
    var createdAt: Int64
    var attachments: [APIAttachment]
    var mentions: [APIMessageMention]
    var cursor: String

    var isBot: Bool { senderKind == "bot" }

    enum CodingKeys: String, CodingKey {
        case id
        case conversationID = "conversation_id"
        case senderKind = "sender_kind"
        case senderID = "sender_id"
        case senderName = "sender_name"
        case senderDeleted = "sender_deleted"
        case body
        case urgent
        case createdAt = "created_at"
        case attachments
        case mentions
        case cursor
    }
}

struct APIMessagePage: Codable, Sendable {
    var messages: [APIMessage]
    var olderCursor: String?
    var newerCursor: String?

    enum CodingKeys: String, CodingKey {
        case messages
        case olderCursor = "older_cursor"
        case newerCursor = "newer_cursor"
    }
}

struct APIUnreadCount: Codable, Sendable {
    var total: Int
}

// MARK: - Request bodies

struct SendMessageBody: Encodable, Sendable {
    var body: String
    var attachmentIDs: [String]
    var urgent: Bool

    enum CodingKeys: String, CodingKey {
        case body
        case attachmentIDs = "attachment_ids"
        case urgent
    }
}

struct CreateGroupBody: Encodable, Sendable {
    var title: String
    var userIDs: [String]

    enum CodingKeys: String, CodingKey {
        case title
        case userIDs = "user_ids"
    }
}

struct MemberBody: Encodable, Sendable {
    var userID: String

    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
    }
}

// MARK: - Auth Mini session tokens

struct SessionTokenResponse: Codable, Sendable {
    var sessionID: String
    var accessToken: String
    var tokenType: String
    var expiresIn: Int
    var refreshToken: String

    enum CodingKeys: String, CodingKey {
        case sessionID = "session_id"
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
    }
}

// MARK: - Errors

struct APIErrorEnvelope: Codable, Sendable {
    struct Body: Codable, Sendable {
        var message: String
        var code: Int?
    }

    var error: Body
}

struct APIHTTPError: LocalizedError, Equatable {
    var status: Int
    var message: String

    var errorDescription: String? { message }
}
