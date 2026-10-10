import XCTest

@testable import Linkit

final class ModelDecodingTests: XCTestCase {
    func testDecodesMeWithProfile() throws {
        let json = """
        {"id":"user-1","root":true,"profile":{"user_id":"user-1","username":"alice","intro":"hi","lang":"zh-CN,en-US","theme":"dark","avatar_attachment_id":"att-1","updated_at":1710000000}}
        """
        let me = try JSONDecoder().decode(APIMe.self, from: Data(json.utf8))
        XCTAssertEqual(me.id, "user-1")
        XCTAssertTrue(me.root)
        XCTAssertEqual(me.profile?.username, "alice")
        XCTAssertEqual(me.profile?.theme, "dark")
        XCTAssertEqual(me.profile?.avatarAttachmentID, "att-1")
        XCTAssertEqual(me.profile?.lang, "zh-CN,en-US")
    }

    func testDecodesConfig() throws {
        let json = """
        {"setup_required":false,"auth_issuer":"https://auth.ntnl.io","public_origin":"https://linkit.ntnl.io"}
        """
        let config = try JSONDecoder().decode(APIConfig.self, from: Data(json.utf8))
        XCTAssertFalse(config.setupRequired)
        XCTAssertEqual(config.authIssuer, "https://auth.ntnl.io")
        XCTAssertEqual(config.publicOrigin, "https://linkit.ntnl.io")
    }

    func testDecodesConversationListWithNulls() throws {
        let json = """
        [{"id":"conv-1","kind":"direct","title":"","created_by":"user-1","created_at":1710000000,"counterpart_user_id":"user-2","counterpart_name":"bob","latest_body":"hey","latest_at":1710000100,"unread_count":2},{"id":"conv-2","kind":"group","title":"Team","created_by":"user-1","created_at":1710000001,"avatar_attachment_id":null,"counterpart_user_id":null,"counterpart_name":null,"counterpart_avatar_attachment_id":null,"latest_body":null,"latest_at":null,"unread_count":0}]
        """
        let list = try JSONDecoder().decode([APIConversation].self, from: Data(json.utf8))
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].counterpartName, "bob")
        XCTAssertEqual(list[0].unreadCount, 2)
        XCTAssertFalse(list[1].isGroup == false)
        XCTAssertTrue(list[1].isGroup)
        XCTAssertNil(list[1].latestBody)
    }

    func testDecodesConversationDetailWithMembers() throws {
        let json = """
        {"id":"conv-2","kind":"group","title":"Team","created_by":"user-1","created_at":1,"unread_count":0,"members":[{"user_id":"user-1","username":"alice","user_type":"human","role":"owner","has_profile":true},{"user_id":"bot-1","username":"helper","user_type":"bot","role":"member","has_profile":false}]}
        """
        let detail = try JSONDecoder().decode(APIConversationDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.conversation.title, "Team")
        XCTAssertEqual(detail.members.count, 2)
        XCTAssertEqual(detail.members[0].role, "owner")
        XCTAssertFalse(detail.members[1].hasProfile)
    }

    func testDecodesMessagePage() throws {
        let json = """
        {"messages":[{"id":"m1","conversation_id":"c1","sender_kind":"user","sender_id":"u1","sender_name":"alice","sender_deleted":false,"body":"hi <@u2>","urgent":true,"created_at":1710000000,"attachments":[{"id":"a1","file_name":"x.png","media_type":"image/png","byte_size":123,"created_at":1}],"mentions":[{"user_id":"u2","username":"bob"}],"cursor":"1710000000-1"}],"older_cursor":"1710000000-1"}
        """
        let page = try JSONDecoder().decode(APIMessagePage.self, from: Data(json.utf8))
        XCTAssertEqual(page.messages.count, 1)
        XCTAssertEqual(page.messages[0].attachments[0].fileName, "x.png")
        XCTAssertEqual(page.messages[0].mentions[0].username, "bob")
        XCTAssertTrue(page.messages[0].urgent)
        XCTAssertEqual(page.olderCursor, "1710000000-1")
        XCTAssertNil(page.newerCursor)
    }

    func testDecodesErrorEnvelope() throws {
        let json = """
        {"error":{"message":"title is required","code":400}}
        """
        let envelope = try JSONDecoder().decode(APIErrorEnvelope.self, from: Data(json.utf8))
        XCTAssertEqual(envelope.error.message, "title is required")
        XCTAssertEqual(envelope.error.code, 400)
    }

    func testDecodesSessionTokenResponse() throws {
        let json = """
        {"session_id":"s","access_token":"a","token_type":"Bearer","expires_in":900,"refresh_token":"r"}
        """
        let tokens = try JSONDecoder().decode(SessionTokenResponse.self, from: Data(json.utf8))
        XCTAssertEqual(tokens.expiresIn, 900)
        XCTAssertEqual(tokens.tokenType, "Bearer")
    }

    func testProfileUpdateAlwaysEncodesAvatarAsNull() throws {
        let update = APIProfileUpdate(username: "a", intro: "b", lang: nil, theme: nil, avatarAttachmentID: nil)
        let data = try JSONEncoder().encode(update)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(object.keys.contains("avatar_attachment_id"))
        XCTAssertTrue(object["avatar_attachment_id"] is NSNull)
        XCTAssertNil(object["lang"])
        XCTAssertNil(object["theme"])
    }

    func testProfileUpdateKeepsAvatarWhenProvided() throws {
        let update = APIProfileUpdate(username: "a", intro: "b", lang: "en-US", theme: "dark", avatarAttachmentID: "att-9")
        let data = try JSONEncoder().encode(update)
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["avatar_attachment_id"] as? String, "att-9")
        XCTAssertEqual(object["lang"] as? String, "en-US")
        XCTAssertEqual(object["theme"] as? String, "dark")
    }
}
