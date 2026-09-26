import XCTest
import Darwin
@testable import coolswitch

final class OnboardingTests: XCTestCase {
    @MainActor
    func testOpeningSettingsDoesNotCompletePermissionSetup() {
        let model = SettingsModel()
        model.permissionChanged(trusted: false)
        model.beginPermissionRequest()
        model.settingsOpened(failed: false)
        XCTAssertFalse(model.openingSettings)
        XCTAssertTrue(model.waitingForPermission)
        model.permissionChanged(trusted: false)
        XCTAssertTrue(model.waitingForPermission)
        model.permissionChanged(trusted: true)
        XCTAssertFalse(model.waitingForPermission)
        // A late open completion must not restart the waiting state.
        model.settingsOpened(failed: false)
        XCTAssertFalse(model.waitingForPermission)
    }

    @MainActor
    func testFailedSettingsHandoffAllowsRetry() {
        let model = SettingsModel()
        model.beginPermissionRequest()
        model.settingsOpened(failed: true)
        XCTAssertFalse(model.waitingForPermission)
        XCTAssertFalse(model.openingSettings)
        XCTAssertNotNil(model.settingsError)
        model.beginPermissionRequest()
        XCTAssertTrue(model.waitingForPermission)
        XCTAssertNil(model.settingsError)
    }

    func testInstallClearsOnlyCopiedQuarantineAndNeverOverwritesExistingApp() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? files.removeItem(at: root) }
        let source = root.appendingPathComponent("Download.app")
        let destination = root.appendingPathComponent("Installed.app")
        try files.createDirectory(at: source, withIntermediateDirectories: true)
        let payload = Data("test fixture, not an executable".utf8)
        let binary = source.appendingPathComponent("payload")
        try payload.write(to: binary)
        for path in [source.path, binary.path] {
            let value = Array("0083;00000000;test;".utf8)
            let result = value.withUnsafeBytes {
                setxattr(path, "com.apple.quarantine", $0.baseAddress, $0.count, 0, XATTR_NOFOLLOW)
            }
            XCTAssertEqual(result, 0)
        }
        try ApplicationInstall.copyForInstallation(from: source, to: destination)
        XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("payload")), payload)
        for path in [destination.path, destination.appendingPathComponent("payload").path] {
            XCTAssertEqual(getxattr(path, "com.apple.quarantine", nil, 0, 0, XATTR_NOFOLLOW), -1)
            XCTAssertEqual(errno, ENOATTR)
        }
        XCTAssertGreaterThan(getxattr(source.path, "com.apple.quarantine", nil, 0, 0, XATTR_NOFOLLOW), 0)
        XCTAssertThrowsError(try ApplicationInstall.copyForInstallation(from: source, to: destination))
        XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("payload")), payload)
    }
}
