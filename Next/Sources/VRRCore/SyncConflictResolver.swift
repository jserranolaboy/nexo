import Foundation

public enum SyncResolutionError: Error, Equatable, Sendable {
    case conflictNotFound
    case serverValueUnavailable
    case staleServerValue
    case unsupportedLocalVersion
}

/// Resolves a saved conflict without touching the network. The caller must
/// persist the complete snapshot atomically before uploading again.
@MainActor
public enum SyncConflictResolver {
    public static func resolve(
        _ snapshot: inout WorkspaceSnapshot, organizationID: UUID,
        conflictID: UUID, choice: SyncResolutionChoice
    ) throws {
        var proposed = snapshot
        try resolveInPlace(&proposed, organizationID: organizationID,
                           conflictID: conflictID, choice: choice)
        snapshot = proposed
    }

    private static func resolveInPlace(
        _ snapshot: inout WorkspaceSnapshot, organizationID: UUID,
        conflictID: UUID, choice: SyncResolutionChoice
    ) throws {
        guard let index = snapshot.syncStates.firstIndex(where: { $0.organizationID == organizationID }),
              let conflict = snapshot.syncStates[index].conflicts.first(where: { $0.id == conflictID })
        else { throw SyncResolutionError.conflictNotFound }
        guard let serverRevision = conflict.serverRevision, serverRevision >= 1,
              let serverPayload = conflict.serverPayload
        else { throw SyncResolutionError.serverValueUnavailable }
        let key = OrganizationSyncState.key(conflict.kind, conflict.entityID)
        guard snapshot.syncStates[index].revisions[key] ?? 0 <= serverRevision
        else { throw SyncResolutionError.staleServerValue }

        let affected = snapshot.syncStates[index].pending.filter {
            $0.kind == conflict.kind && $0.entityID == conflict.entityID
        }
        guard let first = affected.first, let last = affected.last,
              affected.contains(where: { $0.id == conflict.mutationID })
        else { throw SyncResolutionError.conflictNotFound }
        if choice == .keepLocal && conflict.kind == .volunteer {
            // Volunteer status changes have a required server-side sequence.
            throw SyncResolutionError.unsupportedLocalVersion
        }

        if choice == .useServer {
            try applyServerValue(kind: conflict.kind, id: conflict.entityID,
                                 payload: serverPayload, organizationID: organizationID,
                                 to: &snapshot)
        }
        let insertionIndex = snapshot.syncStates[index].pending.firstIndex(where: { $0.id == first.id })!
        snapshot.syncStates[index].pending.removeAll {
            $0.kind == conflict.kind && $0.entityID == conflict.entityID
        }
        if choice == .keepLocal {
            snapshot.syncStates[index].pending.insert(PendingSyncMutation(
                id: UUID(), organizationID: organizationID, kind: conflict.kind,
                entityID: conflict.entityID, expectedRevision: serverRevision,
                payload: last.payload, queuedAt: .now
            ), at: insertionIndex)
        }
        snapshot.syncStates[index].conflicts.removeAll {
            $0.kind == conflict.kind && $0.entityID == conflict.entityID
        }
        snapshot.syncStates[index].revisions[key] = serverRevision
        snapshot.resolvedSyncConflicts.append(ResolvedSyncConflict(
            id: UUID(), organizationID: organizationID, kind: conflict.kind,
            entityID: conflict.entityID, discardedMutationIDs: affected.map(\.id),
            localPayload: last.payload, serverPayload: serverPayload,
            serverRevision: serverRevision, choice: choice, resolvedAt: .now
        ))
        try WorkspaceRules.validate(snapshot)
    }

    private static func applyServerValue(
        kind: SyncEntityKind, id: UUID, payload: [String: JSONValue],
        organizationID: UUID, to snapshot: inout WorkspaceSnapshot
    ) throws {
        let change = RemoteChange(cursor: 0, kind: kind.rawValue, id: id,
                                  revision: 1, payload: payload, before: nil,
                                  mutationID: nil, changedAt: nil, actor: "")
        switch kind {
        case .period:
            SyncCoordinator.upsert(try SyncCoordinator.decode(WorkPeriod.self, change, organizationID), in: &snapshot.periods)
        case .member:
            SyncCoordinator.upsert(try SyncCoordinator.decode(Member.self, change, organizationID), in: &snapshot.members)
        case .group:
            SyncCoordinator.upsert(try SyncCoordinator.decode(MemberGroup.self, change, organizationID), in: &snapshot.groups)
        case .membership:
            SyncCoordinator.upsert(try SyncCoordinator.decode(GroupMembership.self, change, organizationID), in: &snapshot.memberships)
        case .component:
            SyncCoordinator.upsert(try SyncCoordinator.decode(ActivityComponent.self, change, organizationID), in: &snapshot.components)
        case .category:
            SyncCoordinator.upsert(try SyncCoordinator.decode(ActivityCategory.self, change, organizationID), in: &snapshot.categories)
        case .event:
            SyncCoordinator.upsert(try SyncCoordinator.decode(ActivityEvent.self, change, organizationID), in: &snapshot.events)
        case .attendance:
            SyncCoordinator.upsert(try SyncCoordinator.decode(AttendanceEntry.self, change, organizationID), in: &snapshot.attendance)
        case .volunteer:
            SyncCoordinator.upsert(try SyncCoordinator.decode(VolunteerEntry.self, change, organizationID), in: &snapshot.volunteers)
        case .template:
            SyncCoordinator.upsert(try SyncCoordinator.decode(DocumentTemplate.self, change, organizationID), in: &snapshot.templates)
        }
    }
}
