import XCTest

@testable import Linkit

final class LoginCallbackTests: XCTestCase {
    func testParsesHashRouterCallback() throws {
        let url = URL(
            string: "https://linkit.ntnl.io/#/auth/callback?access_token=jwt-1&token_type=Bearer&session_id=session-1&refresh_token=refresh-1&expires_in=900&expires_at=2026-06-30T00%3A15%3A00.000Z&state=state-1"
        )!
        let tokens = try LoginCallback.parse(callbackURL: url, expectedState: "state-1")
        XCTAssertEqual(tokens.accessToken, "jwt-1")
        XCTAssertEqual(tokens.tokenType, "Bearer")
        XCTAssertEqual(tokens.sessionID, "session-1")
        XCTAssertEqual(tokens.refreshToken, "refresh-1")
        XCTAssertEqual(tokens.expiresIn, 900)
        XCTAssertNotNil(tokens.expiresAt)
        XCTAssertEqual(tokens.state, "state-1")
    }

    func testParsesPlainFragmentCallback() throws {
        let url = URL(
            string: "https://linkit.ntnl.io/auth/callback#access_token=jwt-2&token_type=Bearer&session_id=s&refresh_token=r&expires_in=900&state=xyz"
        )!
        let tokens = try LoginCallback.parse(callbackURL: url, expectedState: "xyz")
        XCTAssertEqual(tokens.accessToken, "jwt-2")
        XCTAssertEqual(tokens.tokenType, "Bearer")
    }

    func testRejectsStateMismatch() {
        let url = URL(string: "https://linkit.ntnl.io/#/auth/callback?access_token=a&session_id=s&refresh_token=r&state=evil")!
        XCTAssertThrowsError(try LoginCallback.parse(callbackURL: url, expectedState: "good")) { error in
            XCTAssertEqual(error as? LoginCallbackError, .stateMismatch)
        }
    }

    func testRejectsIncompleteCallback() {
        let url = URL(string: "https://linkit.ntnl.io/#/auth/callback?access_token=a&state=x")!
        XCTAssertThrowsError(try LoginCallback.parse(callbackURL: url, expectedState: "x")) { error in
            XCTAssertEqual(error as? LoginCallbackError, .missingTokens)
        }
    }

    func testHostMatchingIsCaseInsensitive() {
        let url = URL(string: "https://Linkit.ntnl.io/#/auth/callback")!
        XCTAssertTrue(LoginCallback.isCallbackURL(url, instanceHost: "linkit.ntnl.io"))
        XCTAssertFalse(LoginCallback.isCallbackURL(url, instanceHost: "evil.example.com"))
    }
}
