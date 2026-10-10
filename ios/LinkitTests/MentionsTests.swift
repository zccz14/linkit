import XCTest

@testable import Linkit

final class MentionsTests: XCTestCase {
    private let alice = MentionCandidate(
        userID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        username: "alice",
        userType: "human",
        hasProfile: true
    )
    private let alicebot = MentionCandidate(
        userID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        username: "alicebot",
        userType: "bot",
        hasProfile: true
    )

    func testTokenizesTypedUsernamesIntoIDs() {
        let result = Mentions.tokenize("hello @alice and @alicebot!", members: [alice, alicebot])
        XCTAssertEqual(
            result,
            "hello <@aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa> and <@bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb>!"
        )
    }

    func testLongestUsernameWins() {
        XCTAssertEqual(Mentions.tokenize("@alicebot", members: [alice, alicebot]), "<@bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb>")
    }

    func testPrecededByHandleCharacterNeverTokenizes() {
        XCTAssertEqual(Mentions.tokenize("mail me at alex@alice.com", members: [alice]), "mail me at alex@alice.com")
    }

    func testTrailingContinuationPreventsMatch() {
        XCTAssertEqual(Mentions.tokenize("@alice_2", members: [alice]), "@alice_2")
        XCTAssertEqual(Mentions.tokenize("@alice2", members: [alice]), "@alice2")
    }

    func testCaseInsensitiveUsernames() {
        XCTAssertEqual(Mentions.tokenize("@Alice", members: [alice]), "<@aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa>")
    }

    func testSplitReplacesKnownMentionTokens() {
        let mentions = [APIMessageMention(userID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", username: "alice")]
        let body = "hi <@aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa>!"
        XCTAssertEqual(
            Mentions.split(body, mentions: mentions),
            [
                MentionSegment(text: "hi ", username: nil),
                MentionSegment(text: "@alice", username: "alice"),
                MentionSegment(text: "!", username: nil),
            ]
        )
    }

    func testSplitLeavesUnknownTokensAlone() {
        let body = "hi <@eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee>"
        XCTAssertEqual(Mentions.displayText(body, mentions: []), body)
    }

    func testDisplayTextJoinsSegments() {
        let mentions = [APIMessageMention(userID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", username: "alice")]
        let body = "<@aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa> ping"
        XCTAssertEqual(Mentions.displayText(body, mentions: mentions), "@alice ping")
    }
}
