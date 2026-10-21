import Foundation

public enum SyncUploadResult: Equatable, Sendable {
    case synchronized
    case needsAttention
}

public enum SyncProcessingError: Error, Equatable, Sendable {
    case associationNotActivated
    case invalidRemoteIdentity
    case invalidChangePage
    case invalidRemoteDate
}

public struct SyncDownloadResult: Equatable, Sendable {
    public let received: Int
    public let conflicts: Int
}

/// A service acknowledgement is persisted before the next queued operation.
/// If the process exits between service commit and local save, the same UUID
/// is replayed and the service returns the original acknowledgement.
@MainActor
public final class SyncCoordinator {
    private let store: SnapshotStore
    private let remote: any SyncTransport

    public init(store: SnapshotStore, remote: any SyncTransport) {
        self.store = store
        self.remote = remote
    }

    public func upload(organizationID: UUID) async throws -> SyncUploadResult {
        while true {
            let snapshot = try store.load()
            guard let organization = snapshot.organizations.first(where: { $0.id == organizationID }),
                  let state = snapshot.syncStates.first(where: { $0.organizationID == organizationID })
            else { throw SyncProcessingError.associationNotActivated }

            if !state.remoteCreated {
                let created = try await remote.createOrganization(
                    id: organizationID, mutationID: state.creationMutationID,
                    name: organization.name, timeZone: organization.timeZoneIdentifier
                )
                guard created.id == organizationID else { throw SyncProcessingError.invalidRemoteIdentity }
                try update(organizationID: organizationID) { state in
                    guard state.creationMutationID == snapshot.syncStates.first(where: {
                        $0.organizationID == organizationID
                    })?.creationMutationID else { throw SyncProcessingError.invalidRemoteIdentity }
                    state.remoteCreated = true
                }
                continue
            }

            guard let pending = state.pending.first else { return .synchronized }
            if state.conflicts.contains(where: { $0.mutationID == pending.id }) {
                return .needsAttention
            }
            do {
                let ack = try await remote.put(
                    organizationID: organizationID, kind: pending.kind.rawValue,
                    entityID: pending.entityID, payload: pending.payload,
                    expectedRevision: pending.expectedRevision, mutationID: pending.id
                )
                guard ack.id == pending.entityID && ack.kind == pending.kind.rawValue
                else { throw SyncProcessingError.invalidRemoteIdentity }
                try update(organizationID: organizationID) { state in
                    try state.acknowledge(pending.id, revision: ack.revision)
                }
            } catch RemoteWorkspaceError.revisionConflict(let revision, let payload) {
                try update(organizationID: organizationID) { state in
                    try state.recordConflict(for: pending.id, revision: revision, payload: payload)
                }
                return .needsAttention
            } catch RemoteWorkspaceError.server(409) {
                try update(organizationID: organizationID) { state in
                    try state.recordConflict(for: pending.id, revision: nil, payload: nil)
                }
                return .needsAttention
            }
        }
    }

    /// Applies a page only after every record on it has been decoded and the
    /// resulting workspace has passed validation. The cursor is saved with it.
    public func download(organizationID: UUID) async throws -> SyncDownloadResult {
        var received = 0
        var conflicts = 0
        while true {
            let current = try store.load()
            guard let state = current.syncStates.first(where: { $0.organizationID == organizationID }),
                  state.remoteCreated else { throw SyncProcessingError.associationNotActivated }
            let page = try await remote.changes(organizationID: organizationID, after: state.cursor)
            guard page.cursor >= state.cursor,
                  page.changes.allSatisfy({ $0.cursor > state.cursor && $0.cursor <= page.cursor }),
                  zip(page.changes, page.changes.dropFirst()).allSatisfy({ $0.cursor < $1.cursor })
            else { throw SyncProcessingError.invalidChangePage }
            guard !page.changes.isEmpty else { return SyncDownloadResult(received: received, conflicts: conflicts) }

            var pageConflicts = 0
            try updateSnapshot { snapshot in
                guard let index = snapshot.syncStates.firstIndex(where: { $0.organizationID == organizationID }),
                      snapshot.syncStates[index].cursor == state.cursor
                else { throw SyncProcessingError.invalidChangePage }
                var currentAttemptConflicts = 0
                for change in page.changes {
                    if try Self.apply(change, organizationID: organizationID,
                                      to: &snapshot, stateIndex: index) {
                        currentAttemptConflicts += 1
                    }
                }
                snapshot.syncStates[index].cursor = page.cursor
                pageConflicts = currentAttemptConflicts
            }
            received += page.changes.count
            conflicts += pageConflicts
        }
    }

    private static func apply(
        _ change: RemoteChange, organizationID: UUID,
        to snapshot: inout WorkspaceSnapshot, stateIndex: Int
    ) throws -> Bool {
        guard let kind = SyncEntityKind(rawValue: change.kind), change.revision >= 1
        else { throw SyncProcessingError.invalidChangePage }
        let key = OrganizationSyncState.key(kind, change.id)
        let knownRevision = snapshot.syncStates[stateIndex].revisions[key] ?? 0
        let pending = snapshot.syncStates[stateIndex].pending.first {
            $0.kind == kind && $0.entityID == change.id
        }

        if let pending, change.mutationID == pending.id {
            guard change.revision == (pending.expectedRevision ?? 0) + 1
            else { throw SyncProcessingError.invalidChangePage }
            try snapshot.syncStates[stateIndex].acknowledge(pending.id, revision: change.revision)
        } else if let pending, change.revision > knownRevision {
            try snapshot.syncStates[stateIndex].recordConflict(
                for: pending.id, revision: change.revision, payload: change.payload
            )
            snapshot.syncStates[stateIndex].revisions[key] = change.revision
            return true
        }

        if change.revision > knownRevision {
            snapshot.syncStates[stateIndex].revisions[key] = change.revision
        }
        guard !snapshot.syncStates[stateIndex].pending.contains(where: {
            $0.kind == kind && $0.entityID == change.id
        }) else { return false }
        guard change.revision >= knownRevision else { return false }

        switch kind {
        case .period:
            upsert(try decode(WorkPeriod.self, change, organizationID), in: &snapshot.periods)
        case .member:
            upsert(try decode(Member.self, change, organizationID), in: &snapshot.members)
        case .group:
            upsert(try decode(MemberGroup.self, change, organizationID), in: &snapshot.groups)
        case .membership:
            upsert(try decode(GroupMembership.self, change, organizationID), in: &snapshot.memberships)
        case .component:
            upsert(try decode(ActivityComponent.self, change, organizationID), in: &snapshot.components)
        case .category:
            upsert(try decode(ActivityCategory.self, change, organizationID), in: &snapshot.categories)
        case .event:
            upsert(try decode(ActivityEvent.self, change, organizationID), in: &snapshot.events)
        case .attendance:
            upsert(try decode(AttendanceEntry.self, change, organizationID), in: &snapshot.attendance)
        case .volunteer:
            upsert(try decode(VolunteerEntry.self, change, organizationID), in: &snapshot.volunteers)
        case .template:
            upsert(try decode(DocumentTemplate.self, change, organizationID), in: &snapshot.templates)
        }
        return false
    }

    static func upsert<T: Identifiable>(_ entity: T, in values: inout [T]) where T.ID == UUID {
        if let index = values.firstIndex(where: { $0.id == entity.id }) {
            values[index] = entity
        } else {
            values.append(entity)
        }
    }

    static func decode<T: Decodable>(
        _ type: T.Type, _ change: RemoteChange, _ organizationID: UUID
    ) throws -> T {
        var payload = change.payload
        payload["id"] = .string(change.id.uuidString)
        payload["organizationID"] = .string(organizationID.uuidString)
        let data = try JSONEncoder().encode(payload)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { source in
            let value = try source.singleValueContainer()
            if let seconds = try? value.decode(Double.self) { return Date(timeIntervalSince1970: seconds) }
            let string = try value.decode(String.self)
            let withFraction = ISO8601DateFormatter()
            withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = withFraction.date(from: string) { return date }
            let basic = ISO8601DateFormatter()
            basic.formatOptions = [.withInternetDateTime]
            guard let date = basic.date(from: string) else { throw SyncProcessingError.invalidRemoteDate }
            return date
        }
        return try decoder.decode(T.self, from: data)
    }

    private func update(
        organizationID: UUID, edit: (inout OrganizationSyncState) throws -> Void
    ) throws {
        try updateSnapshot { snapshot in
            guard let index = snapshot.syncStates.firstIndex(where: { $0.organizationID == organizationID })
            else { throw SyncProcessingError.associationNotActivated }
            try edit(&snapshot.syncStates[index])
        }
    }

    private func updateSnapshot(_ edit: (inout WorkspaceSnapshot) throws -> Void) throws {
        for _ in 0..<3 {
            let current = try store.load()
            var next = current
            try edit(&next)
            do {
                _ = try store.save(next, expectedRevision: current.revision)
                return
            } catch SnapshotStoreError.staleRevision {
                continue
            }
        }
        throw SnapshotStoreError.staleRevision
    }
}
