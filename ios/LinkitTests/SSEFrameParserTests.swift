import XCTest

@testable import Linkit

final class SSEFrameParserTests: XCTestCase {
    func testParsesEventAndData() {
        var parser = SSEFrameParser()
        XCTAssertNil(parser.consume(line: "event: unread"))
        XCTAssertNil(parser.consume(line: "data: {\"total\":3}"))
        XCTAssertEqual(parser.consume(line: ""), SSEFrame(event: "unread", data: "{\"total\":3}"))
    }

    func testIgnoresCommentsAndBareBlanks() {
        var parser = SSEFrameParser()
        XCTAssertNil(parser.consume(line: ": keep-alive"))
        XCTAssertNil(parser.consume(line: ""))
    }

    func testJoinsMultipleDataLines() {
        var parser = SSEFrameParser()
        XCTAssertNil(parser.consume(line: "data: a"))
        XCTAssertNil(parser.consume(line: "data: b"))
        XCTAssertEqual(parser.consume(line: ""), SSEFrame(event: nil, data: "a\nb"))
    }

    func testFrameWithoutEventName() {
        var parser = SSEFrameParser()
        XCTAssertNil(parser.consume(line: "data: payload"))
        let frame = parser.consume(line: "")
        XCTAssertEqual(frame?.event, nil)
        XCTAssertEqual(frame?.data, "payload")
    }
}
