import Foundation
import XCTest
@testable import VRRCore

final class LegacyImporterTests: XCTestCase {
    private func fixture(orphaned: Bool) throws -> [String: Any] {
        let component = UUID().uuidString, member = UUID().uuidString, event = UUID().uuidString
        return [
            "groups": [],
            "members": [["id": member, "name": "Synthetic person", "groupIDs": [], "isActive": true, "createdAt": 0]],
            "components": [["id": component, "name": "Service"]],
            "subcategories": [],
            "events": [["id": event, "title": "Synthetic event", "startsAt": 0, "componentID": component,
                        "countsTowardAttendance": true, "isCancelled": false]],
            "attendanceLists": [["eventID": orphaned ? UUID().uuidString : event,
                                 "eventDateSnapshot": 0, "componentIDSnapshot": component,
                                 "records": [["id": UUID().uuidString, "memberID": member,
                                              "memberNameSnapshot": "Synthetic person", "groupIDsSnapshot": [],
                                              "isPresent": true, "note": "Synthetic note"]]]]
        ]
    }

    func testOrphanedAttendanceIsRejectedInsteadOfSilentlyDiscarded() throws {
        let snapshot = try fixture(orphaned: true)
        for object in [snapshot, ["snapshot": snapshot]] {
            let data = try JSONSerialization.data(withJSONObject: object)
            XCTAssertThrowsError(try LegacyImporter.importData(data, organizationName: "Synthetic team")) {
                XCTAssertEqual($0 as? WorkspaceValidationError, .brokenRelationship)
            }
        }
    }

    func testDirectAndEnvelopeImportsPreserveAttendance() throws {
        let snapshot = try fixture(orphaned: false)
        for object in [snapshot, ["snapshot": snapshot]] {
            let result = try LegacyImporter.importData(JSONSerialization.data(withJSONObject: object),
                                                       organizationName: "Synthetic team")
            XCTAssertEqual(result.importedAttendanceLists, 1)
            XCTAssertEqual(result.snapshot.attendance.count, 1)
            XCTAssertEqual(result.snapshot.attendance.first?.status, .present)
            XCTAssertEqual(result.snapshot.attendance.first?.note, "Synthetic note")
            try WorkspaceRules.validate(result.snapshot)
        }
    }
}
