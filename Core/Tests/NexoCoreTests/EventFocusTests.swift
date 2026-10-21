import Foundation
import XCTest
@testable import NexoCore

final class EventFocusTests: XCTestCase {
    func testCalendarPrefersUpcomingWorkButKeepsExplicitSelection() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let organizationID = UUID()
        let componentID = UUID()
        func event(_ title: String, days: Double, cancelled: Bool = false) -> ActivityEvent {
            ActivityEvent(organizationID: organizationID, title: title,
                          startsAt: now.addingTimeInterval(days * 86_400),
                          componentID: componentID, isCancelled: cancelled)
        }
        let oldest = event("Antiguo", days: -10)
        let recent = event("Reciente", days: -1)
        let cancelled = event("Cancelado", days: 0.25, cancelled: true)
        let next = event("Próximo", days: 1)
        let later = event("Posterior", days: 3)
        let all = [later, oldest, cancelled, next, recent]

        XCTAssertEqual(EventFocus.preferredID(in: all, keeping: nil, now: now), next.id)
        XCTAssertEqual(EventFocus.preferredID(in: all, keeping: oldest.id, now: now), oldest.id)
        XCTAssertEqual(EventFocus.preferredID(in: all, keeping: UUID(), now: now), next.id)
        XCTAssertEqual(EventFocus.preferredID(in: [oldest, recent], keeping: nil, now: now), recent.id)
        XCTAssertEqual(EventFocus.preferredID(in: [cancelled], keeping: nil, now: now), cancelled.id)
        XCTAssertNil(EventFocus.preferredID(in: [], keeping: nil, now: now))
    }
}
