import Foundation

/// Picks a useful calendar event without overriding an intentional selection.
public enum EventFocus {
    public static func preferredID(
        in events: [ActivityEvent], keeping selectedID: UUID?, now: Date
    ) -> UUID? {
        if let selectedID, events.contains(where: { $0.id == selectedID }) {
            return selectedID
        }
        let active = events.filter { !$0.isCancelled }
        let ordered = (active.isEmpty ? events : active).sorted {
            if $0.startsAt == $1.startsAt {
                return $0.id.uuidString < $1.id.uuidString
            }
            return $0.startsAt < $1.startsAt
        }
        return (ordered.first { $0.startsAt >= now } ?? ordered.last)?.id
    }
}
