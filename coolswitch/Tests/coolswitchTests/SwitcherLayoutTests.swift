import XCTest
@testable import coolswitch

final class SwitcherLayoutTests: XCTestCase {
    func testFitsDifferentDisplaysAndKeepsSelectionValid() {
        for screen in [CGSize(width: 320, height: 240), CGSize(width: 900, height: 1400), CGSize(width: 3440, height: 1440)] {
            for count in [0, 1, 12, 90, 500] {
                let layout = SwitcherLayout(count: count, screenSize: screen)
                XCTAssertLessThanOrEqual(layout.panelSize.width, screen.width - 40)
                XCTAssertLessThanOrEqual(layout.panelSize.height, screen.height - 40)
                for index in 0..<count {
                    XCTAssertLessThanOrEqual(layout.frame(at: index).maxX, layout.documentSize.width + 0.001)
                    XCTAssertLessThanOrEqual(layout.frame(at: index).maxY, layout.documentSize.height + 0.001)
                    for direction in [GridDirection.up, .down, .left, .right] {
                        XCTAssertTrue((0..<count).contains(layout.moving(index, direction)))
                    }
                }
            }
        }
    }
}
