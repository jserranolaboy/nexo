/* Generated from reconstruction/src. Do not edit. */
"use strict";
(() => {
  // src/embedded/globals.js
  var Buffer = class _Buffer {
    constructor(bytes) {
      this.bytes = bytes;
    }
    static from(value, encoding = "utf8") {
      if (typeof value !== "string") throw new Error("buffer");
      if (encoding === "latin1" || encoding === "binary") {
        const bytes = new Uint8Array(value.length);
        for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 255;
        return new _Buffer(bytes);
      }
      return new _Buffer(encodeUtf8(value));
    }
    static concat(list) {
      const size = list.reduce((sum, item) => sum + item.bytes.length, 0);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const item of list) {
        bytes.set(item.bytes, offset);
        offset += item.bytes.length;
      }
      return new _Buffer(bytes);
    }
    static byteLength(value, encoding = "utf8") {
      return _Buffer.from(value, encoding).bytes.length;
    }
    get length() {
      return this.bytes.length;
    }
    subarray(start, end) {
      return new _Buffer(this.bytes.subarray(start, end));
    }
    equals(other) {
      if (!other || this.bytes.length !== other.bytes.length) return false;
      for (let index = 0; index < this.bytes.length; index += 1) {
        if (this.bytes[index] !== other.bytes[index]) return false;
      }
      return true;
    }
    toString(encoding = "utf8") {
      if (encoding === "latin1" || encoding === "binary") return latin1(this.bytes);
      return decodeUtf8(this.bytes);
    }
  };
  function structuredClone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  var process = {
    pid: 1,
    kill(pid) {
      if (pid === 1) return true;
      const error = new Error("ESRCH");
      error.code = "ESRCH";
      throw error;
    }
  };
  function latin1(bytes) {
    let text3 = "";
    const chunk = 32768;
    for (let index = 0; index < bytes.length; index += chunk) {
      text3 += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return text3;
  }
  function encodeUtf8(text3) {
    const bytes = [];
    for (const character of text3) {
      const code = character.codePointAt(0) ?? 0;
      if (code < 128) bytes.push(code);
      else if (code < 2048) bytes.push(192 | code >> 6, 128 | code & 63);
      else if (code < 65536) bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
      else bytes.push(240 | code >> 18, 128 | code >> 12 & 63, 128 | code >> 6 & 63, 128 | code & 63);
    }
    return Uint8Array.from(bytes);
  }
  function decodeUtf8(bytes) {
    let text3 = "";
    for (let index = 0; index < bytes.length; index += 1) {
      const first = bytes[index];
      if (first < 128) text3 += String.fromCharCode(first);
      else if ((first & 224) === 192) {
        const second = bytes[index += 1];
        text3 += String.fromCharCode((first & 31) << 6 | second & 63);
      } else if ((first & 240) === 224) {
        const second = bytes[index += 1];
        const third = bytes[index += 1];
        text3 += String.fromCharCode((first & 15) << 12 | (second & 63) << 6 | third & 63);
      } else {
        const second = bytes[index += 1];
        const third = bytes[index += 1];
        const fourth = bytes[index += 1];
        const code = (first & 7) << 18 | (second & 63) << 12 | (third & 63) << 6 | fourth & 63;
        text3 += String.fromCodePoint(code);
      }
    }
    return text3;
  }

  // src/embedded/fs.js
  function readFileSync(file, encoding) {
    const response = call("read", { path: file });
    const buffer = new Buffer(fromBase64(response.data));
    if (encoding === "utf8") return buffer.toString("utf8");
    return buffer;
  }
  function writeFileSync(file, data) {
    if (typeof file === "number") {
      const text3 = typeof data === "string" ? data : data.toString("utf8");
      call("writefd", { fd: file, data: text3 });
      return;
    }
    const bytes = typeof data === "string" ? Buffer.from(data).bytes : data.bytes;
    call("write", { path: file, data: toBase64(bytes) });
  }
  function existsSync(file) {
    const response = call("exists", { path: file });
    return response.data === true;
  }
  function mkdirSync(file) {
    call("mkdir", { path: file });
  }
  function renameSync(from, to) {
    call("rename", { from, to });
  }
  function unlinkSync(file) {
    call("unlink", { path: file });
  }
  function readdirSync(file) {
    return call("readdir", { path: file }).data;
  }
  function openSync(file) {
    return call("open", { path: file }).data;
  }
  function closeSync(fd) {
    call("close", { fd });
  }
  function call(op, payload) {
    if (typeof globalThis.nexoFs !== "function") throw new Error("missing-host");
    const response = JSON.parse(globalThis.nexoFs(op, JSON.stringify(payload)));
    if (!response.ok) {
      const error = new Error(response.code || "EIO");
      error.code = response.code || "EIO";
      throw error;
    }
    return response;
  }
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function toBase64(bytes) {
    let text3 = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index];
      const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
      const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
      const triple = first << 16 | second << 8 | third;
      text3 += alphabet[triple >> 18 & 63];
      text3 += alphabet[triple >> 12 & 63];
      text3 += index + 1 < bytes.length ? alphabet[triple >> 6 & 63] : "=";
      text3 += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
    }
    return text3;
  }
  function fromBase64(value) {
    const clean = (value || "").replace(/=+$/, "");
    const bytes = [];
    for (let index = 0; index < clean.length; index += 4) {
      const triple = alphabet.indexOf(clean[index]) << 18 | alphabet.indexOf(clean[index + 1] || "A") << 12 | alphabet.indexOf(clean[index + 2] || "A") << 6 | alphabet.indexOf(clean[index + 3] || "A");
      bytes.push(triple >> 16 & 255);
      if (index + 2 < clean.length) bytes.push(triple >> 8 & 255);
      if (index + 3 < clean.length) bytes.push(triple & 255);
    }
    return Uint8Array.from(bytes);
  }

  // src/embedded/path.js
  var sep = "/";
  function normalize(value) {
    const absolute = value.startsWith("/");
    const parts = [];
    for (const part of value.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    const body = parts.join("/");
    return absolute ? `/${body}` : body;
  }
  function join(...parts) {
    return normalize(parts.filter((part) => part != null && part !== "").join("/"));
  }
  function dirname(value) {
    const normalized = normalize(value);
    const index = normalized.lastIndexOf("/");
    if (index < 0) return ".";
    if (index === 0) return "/";
    return normalized.slice(0, index);
  }
  function basename(value) {
    const normalized = normalize(value);
    const index = normalized.lastIndexOf("/");
    return index < 0 ? normalized : normalized.slice(index + 1);
  }
  function resolve(value) {
    if (typeof value !== "string" || value.length === 0) return "/";
    return value.startsWith("/") ? normalize(value) : normalize(`/${value}`);
  }
  var path = { sep, join, dirname, basename, resolve };
  var path_default = path;

  // src/errors.ts
  var DomainError = class extends Error {
    code;
    constructor(code) {
      super(code);
      this.name = "DomainError";
      this.code = code;
    }
  };

  // src/time.ts
  var CANONICAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  function parseInstant(value) {
    if (!CANONICAL.test(value)) throw new DomainError("invalid-instant");
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
      throw new DomainError("invalid-instant");
    }
    return parsed;
  }
  function containsInstant(startsAt, endsAt, instant) {
    const start = parseInstant(startsAt);
    const end = parseInstant(endsAt);
    const point = parseInstant(instant);
    return start <= point && point < end;
  }
  function assertHalfOpen(startsAt, endsAt) {
    if (parseInstant(startsAt) >= parseInstant(endsAt)) throw new DomainError("invalid-period");
  }

  // src/attendance.ts
  var EMPTY = {
    present: 0,
    absent: 0,
    excused: 0,
    pending: 0,
    counted: 0,
    ratio: null
  };
  function attendanceRate(workspace, personId, periodId, componentId) {
    const period = periodId ? workspace.periods.find((item) => item.id === periodId) : void 0;
    if (periodId && !period) throw new DomainError("missing-period");
    const encounters = new Map(workspace.encounters.map((encounter) => [encounter.id, encounter]));
    const rate = { ...EMPTY };
    for (const row of workspace.attendance) {
      if (row.personId !== personId || row.voided) continue;
      const encounter = encounters.get(row.encounterId);
      if (!encounter || encounter.cancelled || !row.countsAttendance) continue;
      if (period && encounter.spaceId !== period.spaceId) continue;
      if (period && !containsInstant(period.startsAt, period.endsAt, row.eventInstant)) continue;
      if (componentId && row.componentId !== componentId) continue;
      rate[row.status] += 1;
    }
    rate.counted = rate.present + rate.absent;
    rate.ratio = rate.counted > 0 ? rate.present / rate.counted : null;
    return rate;
  }

  // src/embedded/crypto.js
  function randomUUID() {
    const bytes = new Uint8Array(16);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // src/ids.ts
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function newId() {
    return randomUUID();
  }
  function canonicalId(value) {
    const id = value.toLowerCase();
    if (!UUID.test(id)) throw new DomainError("invalid-id");
    return id;
  }

  // src/model.ts
  var SCHEMA = "nexo-reconstruction-v1";
  function emptyWorkspace() {
    return {
      schema: SCHEMA,
      schemaVersion: 1,
      revision: 0,
      spaces: [],
      periods: [],
      people: [],
      groups: [],
      memberships: [],
      components: [],
      encounters: [],
      attendance: [],
      volunteers: [],
      collaboration: []
    };
  }

  // src/volunteers.ts
  var OCCUPYING = /* @__PURE__ */ new Set(["selected", "completed"]);
  function occupiedSlots(workspace, encounterId) {
    return workspace.volunteers.filter(
      (entry) => entry.encounterId === encounterId && OCCUPYING.has(entry.status)
    ).length;
  }
  function suggestVolunteers(workspace, encounterId, periodId) {
    const encounter = workspace.encounters.find((item) => item.id === encounterId);
    const period = workspace.periods.find((item) => item.id === periodId);
    if (!encounter || !period) return [];
    if (encounter.spaceId !== period.spaceId || encounter.cancelled || encounter.volunteerCapacity == null || !containsInstant(period.startsAt, period.endsAt, encounter.startsAt)) {
      return [];
    }
    const people = new Map(workspace.people.map((person) => [person.id, person]));
    const encounters = new Map(workspace.encounters.map((item) => [item.id, item]));
    const prior = /* @__PURE__ */ new Map();
    for (const entry of workspace.volunteers) {
      if (entry.status !== "completed") continue;
      const previous = encounters.get(entry.encounterId);
      if (!previous || previous.id === encounter.id || previous.spaceId !== encounter.spaceId || previous.cancelled || parseInstant(previous.startsAt) >= parseInstant(encounter.startsAt) || !containsInstant(period.startsAt, period.endsAt, previous.startsAt)) {
        continue;
      }
      const sameScope = encounter.categoryId ? previous.categoryId === encounter.categoryId : previous.componentId === encounter.componentId;
      if (!sameScope) continue;
      const dates = prior.get(entry.personId) ?? [];
      dates.push(previous.startsAt);
      prior.set(entry.personId, dates);
    }
    const suggestions = [];
    for (const entry of workspace.volunteers) {
      if (entry.encounterId !== encounter.id || entry.status !== "interested") continue;
      const person = people.get(entry.personId);
      if (!person || person.spaceId !== encounter.spaceId || !person.active) continue;
      const dates = (prior.get(person.id) ?? []).slice().sort();
      suggestions.push({
        personId: person.id,
        completedInScope: dates.length,
        lastCompletedAt: dates.at(-1) ?? null,
        registeredAt: entry.registeredAt
      });
    }
    return suggestions.sort((left, right) => {
      if (left.completedInScope !== right.completedInScope) {
        return left.completedInScope - right.completedInScope;
      }
      const last = compareOptionalInstant(left.lastCompletedAt, right.lastCompletedAt);
      if (last !== 0) return last;
      const registered = parseInstant(left.registeredAt) - parseInstant(right.registeredAt);
      if (registered !== 0) return registered;
      return left.personId < right.personId ? -1 : left.personId > right.personId ? 1 : 0;
    });
  }
  function compareOptionalInstant(left, right) {
    if (left === right) return 0;
    if (left == null) return -1;
    if (right == null) return 1;
    return parseInstant(left) - parseInstant(right);
  }
  function assertCapacity(workspace) {
    for (const encounter of workspace.encounters) {
      if (encounter.volunteerCapacity == null) continue;
      if (!Number.isSafeInteger(encounter.volunteerCapacity) || encounter.volunteerCapacity < 1) {
        throw new DomainError("invalid-capacity");
      }
      if (occupiedSlots(workspace, encounter.id) > encounter.volunteerCapacity) {
        throw new DomainError("capacity-exceeded");
      }
    }
  }
  function selectVolunteer(workspace, encounterId, personId) {
    const encounter = workspace.encounters.find((item) => item.id === encounterId);
    if (!encounter || encounter.cancelled || encounter.volunteerCapacity == null) {
      throw new DomainError("volunteer-unavailable");
    }
    const entry = workspace.volunteers.find(
      (item) => item.encounterId === encounterId && item.personId === personId && item.status === "interested"
    );
    const person = workspace.people.find((item) => item.id === personId);
    if (!entry || !person || !person.active || person.spaceId !== encounter.spaceId) {
      throw new DomainError("invalid-transition");
    }
    if (occupiedSlots(workspace, encounterId) >= encounter.volunteerCapacity) {
      throw new DomainError("capacity-exceeded");
    }
    return { ...entry, status: "selected" };
  }

  // src/validate.ts
  function validate(workspace) {
    if (workspace.schema !== SCHEMA || workspace.schemaVersion !== 1) throw new DomainError("unsupported-schema");
    if (!Number.isSafeInteger(workspace.revision) || workspace.revision < 0) throw new DomainError("invalid-revision");
    unique(workspace.spaces.map((item) => item.id));
    unique(workspace.periods.map((item) => item.id));
    unique(workspace.people.map((item) => item.id));
    unique(workspace.groups.map((item) => item.id));
    unique(workspace.memberships.map((item) => item.id));
    unique(workspace.components.map((item) => item.id));
    unique(workspace.encounters.map((item) => item.id));
    unique(workspace.attendance.map((item) => item.id));
    unique(workspace.volunteers.map((item) => item.id));
    uniquePairs(workspace.attendance.map((item) => `${item.encounterId}:${item.personId}`), "duplicate-attendance");
    uniquePairs(workspace.volunteers.map((item) => `${item.encounterId}:${item.personId}`), "duplicate-volunteer");
    const spaces = new Set(workspace.spaces.map((item) => canonicalId(item.id)));
    for (const space of workspace.spaces) {
      canonicalId(space.id);
      if (!space.name.trim() || space.name.length > 200) throw new DomainError("invalid-name");
      if (!/^[A-Za-z0-9_+/-]{1,64}$/.test(space.timeZone)) throw new DomainError("invalid-timezone");
    }
    for (const period of workspace.periods) {
      canonicalId(period.id);
      if (!spaces.has(period.spaceId)) throw new DomainError("broken-relationship");
      if (!period.name.trim()) throw new DomainError("invalid-name");
      assertHalfOpen(period.startsAt, period.endsAt);
    }
    for (const person of workspace.people) {
      canonicalId(person.id);
      if (!spaces.has(person.spaceId) || !person.name.trim()) throw new DomainError("broken-relationship");
    }
    for (const group of workspace.groups) {
      canonicalId(group.id);
      if (!spaces.has(group.spaceId)) throw new DomainError("broken-relationship");
    }
    const groups = new Set(workspace.groups.map((item) => item.id));
    for (const membership of workspace.memberships) {
      canonicalId(membership.id);
      if (!groups.has(membership.groupId) || !workspace.people.some((person) => person.id === membership.personId)) {
        throw new DomainError("broken-relationship");
      }
      parseInstant(membership.startsAt);
      if (membership.endsAt != null) assertHalfOpen(membership.startsAt, membership.endsAt);
    }
    const components = new Set(workspace.components.map((item) => item.id));
    for (const component of workspace.components) {
      canonicalId(component.id);
      if (!spaces.has(component.spaceId)) throw new DomainError("broken-relationship");
    }
    for (const encounter of workspace.encounters) {
      canonicalId(encounter.id);
      parseInstant(encounter.startsAt);
      if (!spaces.has(encounter.spaceId) || !components.has(encounter.componentId) || !encounter.title.trim()) {
        throw new DomainError("broken-relationship");
      }
    }
    const encounters = new Map(workspace.encounters.map((item) => [item.id, item]));
    for (const row of workspace.attendance) {
      const encounter = encounters.get(row.encounterId);
      const person = workspace.people.find((item) => item.id === row.personId);
      if (!encounter || !person || person.spaceId !== encounter.spaceId) throw new DomainError("broken-relationship");
      parseInstant(row.eventInstant);
    }
    for (const entry of workspace.volunteers) {
      const encounter = encounters.get(entry.encounterId);
      const person = workspace.people.find((item) => item.id === entry.personId);
      if (!encounter || !person || encounter.volunteerCapacity == null) throw new DomainError("broken-relationship");
      parseInstant(entry.registeredAt);
    }
    for (const link of workspace.collaboration) {
      if (!spaces.has(canonicalId(link.spaceId))) throw new DomainError("broken-relationship");
      uniqueText(link.entries.map((entry) => entry.key));
      for (const entry of link.entries) unique(entry.versions.map((version) => version.id));
    }
    assertCapacity(workspace);
  }
  function unique(ids) {
    const canonical = ids.map((id) => canonicalId(id));
    if (new Set(canonical).size !== canonical.length) throw new DomainError("duplicate-identity");
  }
  function uniquePairs(pairs, code) {
    if (new Set(pairs).size !== pairs.length) throw new DomainError(code);
  }
  function uniqueText(values) {
    if (values.some((value) => value.trim() === "") || new Set(values).size !== values.length) {
      throw new DomainError("duplicate-identity");
    }
  }

  // src/commands.ts
  function systemClock() {
    return { now: () => (/* @__PURE__ */ new Date()).toISOString() };
  }
  function draft(workspace, mutate) {
    const next = structuredClone(workspace);
    mutate(next);
    validate(next);
    return next;
  }
  function createSpace(workspace, input) {
    return draft(workspace, (next) => {
      next.spaces.push({
        id: canonicalId(input.id ?? newId()),
        name: input.name.trim(),
        timeZone: input.timeZone
      });
    });
  }
  function addPeriod(workspace, input) {
    return draft(workspace, (next) => {
      next.periods.push({
        id: canonicalId(input.id ?? newId()),
        spaceId: canonicalId(input.spaceId),
        name: input.name.trim(),
        startsAt: input.startsAt,
        endsAt: input.endsAt
      });
    });
  }
  function addPerson(workspace, input) {
    return draft(workspace, (next) => {
      next.people.push({
        id: canonicalId(input.id ?? newId()),
        spaceId: canonicalId(input.spaceId),
        name: input.name.trim(),
        active: input.active ?? true
      });
    });
  }
  function addComponent(workspace, input) {
    return draft(workspace, (next) => {
      next.components.push({
        id: canonicalId(input.id ?? newId()),
        spaceId: canonicalId(input.spaceId),
        name: input.name.trim()
      });
    });
  }
  function createEncounter(workspace, input) {
    return draft(workspace, (next) => {
      const encounter = {
        id: canonicalId(input.id ?? newId()),
        spaceId: canonicalId(input.spaceId),
        title: input.title.trim(),
        startsAt: input.startsAt,
        componentId: canonicalId(input.componentId),
        categoryId: input.categoryId ? canonicalId(input.categoryId) : null,
        countsAttendance: input.countsAttendance ?? true,
        cancelled: input.cancelled ?? false,
        volunteerCapacity: input.volunteerCapacity ?? null
      };
      next.encounters.push(encounter);
      appendPendingRoster(next, encounter, input.personIds ?? []);
    });
  }
  function setAttendance(workspace, input) {
    return draft(workspace, (next) => {
      const row = next.attendance.find(
        (item) => item.encounterId === canonicalId(input.encounterId) && item.personId === canonicalId(input.personId) && !item.voided
      );
      if (!row) throw new DomainError("not-on-roster");
      row.status = input.status;
      if (input.note != null) row.note = input.note;
      row.recordedAt = input.recordedAt;
    });
  }
  function registerVolunteer(workspace, input) {
    return draft(workspace, (next) => {
      const encounter = next.encounters.find((item) => item.id === canonicalId(input.encounterId));
      const person = next.people.find((item) => item.id === canonicalId(input.personId));
      if (!encounter || encounter.cancelled || encounter.volunteerCapacity == null || !person || !person.active) {
        throw new DomainError("volunteer-unavailable");
      }
      next.volunteers.push({
        id: canonicalId(input.id ?? newId()),
        encounterId: encounter.id,
        personId: person.id,
        status: "interested",
        registeredAt: input.registeredAt
      });
    });
  }
  function chooseVolunteer(workspace, encounterId, personId) {
    return draft(workspace, (next) => {
      const chosen = selectVolunteer(next, canonicalId(encounterId), canonicalId(personId));
      const index = next.volunteers.findIndex((item) => item.id === chosen.id);
      next.volunteers[index] = chosen;
    });
  }
  function finishVolunteer(workspace, encounterId, personId, participated) {
    return draft(workspace, (next) => {
      const entry = next.volunteers.find(
        (item) => item.encounterId === canonicalId(encounterId) && item.personId === canonicalId(personId)
      );
      if (!entry || entry.status !== "selected") throw new DomainError("invalid-transition");
      entry.status = participated ? "completed" : "noShow";
    });
  }
  function declineVolunteer(workspace, encounterId, personId) {
    return draft(workspace, (next) => {
      const entry = next.volunteers.find(
        (item) => item.encounterId === canonicalId(encounterId) && item.personId === canonicalId(personId)
      );
      if (!entry || entry.status !== "interested" && entry.status !== "selected") {
        throw new DomainError("invalid-transition");
      }
      entry.status = "declined";
    });
  }
  function linkCollaboration(workspace, spaceId, pendingUploads = []) {
    return draft(workspace, (next) => {
      next.collaboration.push({
        spaceId: canonicalId(spaceId),
        paused: false,
        pendingUploads: [...pendingUploads],
        entries: []
      });
    });
  }
  function recordAlternative(workspace, input) {
    return draft(workspace, (next) => {
      const link = next.collaboration.find((item) => item.spaceId === canonicalId(input.spaceId));
      if (!link) throw new DomainError("missing-collaboration");
      const entry = link.entries.find((item) => item.key === input.key);
      if (entry) entry.versions.push({ ...input.version });
      else link.entries.push({ key: input.key, versions: [{ ...input.version }] });
    });
  }
  function chooseAlternative(workspace, input) {
    return draft(workspace, (next) => {
      const link = next.collaboration.find((item) => item.spaceId === canonicalId(input.spaceId));
      if (!link) throw new DomainError("missing-collaboration");
      const entry = link.entries.find((item) => item.key === input.key);
      const chosenId = canonicalId(input.versionId);
      const chosen = entry?.versions.find((version) => canonicalId(version.id) === chosenId);
      if (!entry || entry.versions.length < 2 || !chosen) throw new DomainError("missing-alternative");
      entry.versions = [{ id: chosenId, value: chosen.value }];
      if (link.paused) link.pendingUploads = link.pendingUploads.slice();
    });
  }
  function appendPendingRoster(workspace, encounter, personIds) {
    const seen = /* @__PURE__ */ new Set();
    for (const rawId of personIds) {
      const personId = canonicalId(rawId);
      if (seen.has(personId)) throw new DomainError("duplicate-attendance");
      seen.add(personId);
      const person = workspace.people.find((item) => item.id === personId && item.spaceId === encounter.spaceId && item.active);
      if (!person) throw new DomainError("invalid-member");
      const row = {
        id: newId(),
        encounterId: encounter.id,
        personId,
        status: "pending",
        voided: false,
        note: "",
        recordedAt: null,
        eventInstant: encounter.startsAt,
        componentId: encounter.componentId,
        categoryId: encounter.categoryId,
        countsAttendance: encounter.countsAttendance
      };
      parseInstant(row.eventInstant);
      workspace.attendance.push(row);
    }
  }

  // src/documents.ts
  function textLines(text3) {
    if (text3.length === 0) return [];
    return text3.split("\n");
  }
  function overflows(lines, width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return true;
    if (lines.length > height) return true;
    return lines.some((line) => line.length > width);
  }
  function mustString(value) {
    if (typeof value !== "string") throw new DomainError("invalid-draft");
    return value;
  }
  function copyDraft(draft3) {
    const title = mustString(draft3.title);
    const heading = mustString(draft3.heading);
    const footer = mustString(draft3.footer);
    const width = draft3.page?.width;
    const height = draft3.page?.height;
    if (typeof width !== "number" || typeof height !== "number") throw new DomainError("invalid-draft");
    if (!Array.isArray(draft3.rows) || !Array.isArray(draft3.blocks)) throw new DomainError("invalid-draft");
    const rows = draft3.rows.map((row) => ({
      id: mustString(row.id),
      label: mustString(row.label),
      note: mustString(row.note)
    }));
    const blocks = draft3.blocks.map((block) => ({ id: mustString(block.id), text: mustString(block.text) }));
    const ids = [...rows.map((row) => row.id), ...blocks.map((block) => block.id)];
    if (ids.some((id) => id.length === 0) || new Set(ids).size !== ids.length) throw new DomainError("invalid-draft");
    return { title, heading, footer, page: { width, height }, rows, blocks };
  }
  function rowText(row) {
    return `${row.label}
${row.note}`;
  }
  function objectOf(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("invalid-draft");
    return value;
  }
  function stringField(value) {
    if (typeof value !== "string") throw new DomainError("invalid-draft");
    return value;
  }
  function numberField(value) {
    if (typeof value !== "number") throw new DomainError("invalid-draft");
    return value;
  }
  function draftFromUnknown(value) {
    const record = objectOf(value);
    const page = objectOf(record.page);
    if (!Array.isArray(record.rows) || !Array.isArray(record.blocks)) throw new DomainError("invalid-draft");
    return copyDraft({
      title: stringField(record.title),
      heading: stringField(record.heading),
      footer: stringField(record.footer),
      page: { width: numberField(page.width), height: numberField(page.height) },
      rows: record.rows.map((item) => {
        const row = objectOf(item);
        return { id: stringField(row.id), label: stringField(row.label), note: stringField(row.note) };
      }),
      blocks: record.blocks.map((item) => {
        const block = objectOf(item);
        return { id: stringField(block.id), text: stringField(block.text) };
      })
    });
  }
  function layoutDocument(draft3) {
    const saved = copyDraft(draft3);
    const problems = [];
    const titleLines = textLines(saved.title);
    const headingLines = textLines(saved.heading);
    const footerLines = textLines(saved.footer);
    const chrome = [...titleLines, ...headingLines, ...footerLines];
    const page = saved.page;
    const reportChrome = (id, text3) => {
      problems.push({ id, text: text3, reason: "does-not-fit" });
    };
    const pageOpen = Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0;
    if (!pageOpen || chrome.length > page.height) {
      reportChrome("title", saved.title);
      reportChrome("heading", saved.heading);
      reportChrome("footer", saved.footer);
    } else {
      if (overflows(titleLines, page.width, page.height)) reportChrome("title", saved.title);
      if (overflows(headingLines, page.width, page.height)) reportChrome("heading", saved.heading);
      if (overflows(footerLines, page.width, page.height)) reportChrome("footer", saved.footer);
    }
    const capacity = pageOpen ? page.height - chrome.length : 0;
    const items = [];
    for (const row of saved.rows) {
      const lines2 = [row.label, ...textLines(row.note)];
      if (overflows(lines2, page.width, capacity)) problems.push({ id: row.id, text: rowText(row), reason: "does-not-fit" });
      else items.push({ lines: lines2, notes: [row.note] });
    }
    for (const block of saved.blocks) {
      const lines2 = textLines(block.text);
      if (overflows(lines2, page.width, capacity)) problems.push({ id: block.id, text: block.text, reason: "does-not-fit" });
      else if (lines2.length > 0) items.push({ lines: lines2, notes: [] });
    }
    if (problems.length > 0) return { fits: false, problems, draft: saved, document: null };
    const pages = [];
    let lines = [];
    let notes = [];
    const flush = () => {
      pages.push({
        number: pages.length + 1,
        title: saved.title,
        heading: saved.heading,
        footer: saved.footer,
        lines: [...lines],
        notes: [...notes]
      });
      lines = [];
      notes = [];
    };
    if (items.length === 0) {
      flush();
    } else {
      for (const item of items) {
        if (lines.length > 0 && lines.length + item.lines.length > capacity) flush();
        lines.push(...item.lines);
        notes.push(...item.notes);
      }
      flush();
    }
    return { fits: true, problems: [], draft: saved, document: { pages } };
  }

  // src/pdf.ts
  var FONT_SIZE = 12;
  var LEADING = 16;
  var MARGIN = 48;
  function renderDocumentPdf(document) {
    const problems = [];
    for (const page of document.pages) problems.push(...encodingProblems(page));
    if (problems.length > 0) return { problems };
    const bodies = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    ];
    const kids = [];
    for (const page of document.pages) {
      const drawn = drawnLines(page);
      const pageId = bodies.length + 1;
      const contentId = pageId + 1;
      const width = pageWidth(drawn);
      const height = pageHeight(drawn.length);
      bodies.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`
      );
      bodies.push(streamObject(contentStream(drawn, height)));
      kids.push(pageId);
    }
    bodies[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${document.pages.length} >>`;
    return { bytes: serialize(bodies) };
  }
  function encodingProblems(page) {
    const problems = [];
    const consider = (id, text3) => {
      if (!canEncode(text3)) problems.push({ id, text: text3, reason: "cannot-encode" });
    };
    consider(`title-${page.number}`, page.title);
    consider(`heading-${page.number}`, page.heading);
    consider(`footer-${page.number}`, page.footer);
    page.notes.forEach((note, index) => consider(`note-${page.number}-${index + 1}`, note));
    page.lines.forEach((line, index) => {
      const covered = page.notes.some((note) => note.split("\n").includes(line));
      if (!covered) consider(`line-${page.number}-${index + 1}`, line);
    });
    return problems;
  }
  function drawnLines(page) {
    return [...split(page.title), ...split(page.heading), ...page.lines, ...split(page.footer), `Pagina ${page.number}`];
  }
  function split(text3) {
    if (text3.length === 0) return [];
    return text3.split("\n");
  }
  function pageWidth(lines) {
    const longest = lines.reduce((max, line) => Math.max(max, line.length), 1);
    return MARGIN * 2 + longest * FONT_SIZE;
  }
  function pageHeight(lineCount) {
    return MARGIN * 2 + FONT_SIZE + Math.max(0, lineCount - 1) * LEADING;
  }
  function contentStream(lines, height) {
    const startY = height - MARGIN - FONT_SIZE;
    let stream = `BT
/F1 ${FONT_SIZE} Tf
${LEADING} TL
1 0 0 1 ${MARGIN} ${startY} Tm
`;
    lines.forEach((line, index) => {
      const literal = pdfLiteral(line);
      if (literal == null) throw new Error("cannot-encode");
      stream += `${literal} Tj
`;
      if (index !== lines.length - 1) stream += "T*\n";
    });
    stream += "ET\n";
    return stream;
  }
  function streamObject(stream) {
    return `<< /Length ${Buffer.byteLength(stream, "latin1")} >>
stream
${stream}endstream`;
  }
  function canEncode(text3) {
    return text3.split("\n").every((line) => pdfLiteral(line) != null);
  }
  function pdfLiteral(text3) {
    let out = "(";
    for (const character of text3) {
      const byte = winAnsiByte(character.codePointAt(0) ?? 0);
      if (byte == null) return null;
      if (byte === 40 || byte === 41 || byte === 92) out += `\\${String.fromCharCode(byte)}`;
      else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
      else out += String.fromCharCode(byte);
    }
    return `${out})`;
  }
  function winAnsiByte(code) {
    if (code >= 32 && code <= 126 || code >= 160 && code <= 255) return code;
    const extras = {
      8364: 128,
      8218: 130,
      402: 131,
      8222: 132,
      8230: 133,
      8224: 134,
      8225: 135,
      710: 136,
      8240: 137,
      352: 138,
      8249: 139,
      338: 140,
      381: 142,
      8216: 145,
      8217: 146,
      8220: 147,
      8221: 148,
      8226: 149,
      8211: 150,
      8212: 151,
      732: 152,
      8482: 153,
      353: 154,
      8250: 155,
      339: 156,
      382: 158,
      376: 159
    };
    return extras[code] ?? null;
  }
  function serialize(bodies) {
    const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1");
    const parts = [header];
    const offsets = [0];
    let cursor = header.length;
    bodies.forEach((body, index) => {
      const chunk = Buffer.from(`${index + 1} 0 obj
${body}
endobj
`, "latin1");
      offsets.push(cursor);
      parts.push(chunk);
      cursor += chunk.length;
    });
    let xref = `xref
0 ${bodies.length + 1}
`;
    xref += "0000000000 65535 f \n";
    for (let index = 1; index < offsets.length; index += 1) {
      xref += `${offsets[index].toString().padStart(10, "0")} 00000 n 
`;
    }
    const trailer = `trailer
<< /Size ${bodies.length + 1} /Root 1 0 R >>
startxref
${cursor}
%%EOF
`;
    parts.push(Buffer.from(xref + trailer, "latin1"));
    return Buffer.concat(parts);
  }

  // src/store.ts
  var ATTENDANCE = ["pending", "present", "absent", "excused"];
  var VOLUNTEER = ["interested", "selected", "declined", "completed", "noShow"];
  var FileWorkspaceStore = class {
    directory;
    constructor(directory) {
      this.directory = directory;
    }
    primaryPath() {
      return path_default.join(this.directory, "nexo-reconstruction-v1.json");
    }
    revisionCopies() {
      return path_default.join(this.directory, "revision-copies");
    }
    initialize(proposed) {
      return this.locked(() => {
        if (existsSync(this.primaryPath())) throw new DomainError("already-initialized");
        if (this.copyNames().length > 0) throw new DomainError("refuse-empty-replacement");
        if (proposed.revision !== 0) throw new DomainError("invalid-revision");
        validate(proposed);
        const bytes = encode(proposed);
        this.writePrimary(bytes);
        return parseWorkspace(bytes.toString("utf8"));
      });
    }
    load() {
      const raw = this.readPrimary();
      const workspace = parseWorkspace(raw.toString("utf8"));
      try {
        validate(workspace);
      } catch (error) {
        if (error instanceof DomainError && error.code === "unsupported-schema") throw error;
        throw new DomainError("corrupt-primary");
      }
      return workspace;
    }
    save(proposed, expectedRevision) {
      return this.locked(() => {
        const currentBytes = this.readPrimary();
        const current = this.load();
        if (current.revision !== expectedRevision) throw new DomainError("stale-revision");
        if (current.revision >= Number.MAX_SAFE_INTEGER) throw new DomainError("revision-exhausted");
        const next = { ...structuredClone(proposed), schema: SCHEMA, schemaVersion: 1, revision: current.revision + 1 };
        validate(next);
        const bytes = encode(next);
        validate(parseWorkspace(bytes.toString("utf8")));
        this.keepCopy(currentBytes, current.revision);
        this.keepCopy(bytes, next.revision);
        this.writePrimary(bytes);
        return parseWorkspace(bytes.toString("utf8"));
      });
    }
    restore(copyPath) {
      return this.locked(() => {
        const recovered = parseWorkspace(readFileSync(copyPath).toString("utf8"));
        validate(recovered);
        const primaryBytes = existsSync(this.primaryPath()) ? readFileSync(this.primaryPath()) : null;
        let primaryRevision = -1;
        if (primaryBytes) {
          try {
            primaryRevision = parseWorkspace(primaryBytes.toString("utf8")).revision;
          } catch {
            primaryRevision = -1;
          }
        }
        const highest = Math.max(recovered.revision, primaryRevision, this.highestCopyRevision());
        if (highest >= Number.MAX_SAFE_INTEGER) throw new DomainError("revision-exhausted");
        const next = structuredClone(recovered);
        next.revision = highest + 1;
        for (const link of next.collaboration) link.paused = true;
        validate(next);
        const bytes = encode(next);
        if (primaryBytes) {
          const quarantine = path_default.join(this.directory, "quarantine");
          mkdirSync(quarantine, { recursive: true });
          writeFileSync(path_default.join(quarantine, `pre-restore-${randomUUID()}.json`), primaryBytes);
        }
        this.keepCopy(bytes, next.revision);
        this.writePrimary(bytes);
        return parseWorkspace(bytes.toString("utf8"));
      });
    }
    readPrimary() {
      if (!existsSync(this.primaryPath())) throw new DomainError("missing-primary");
      return readFileSync(this.primaryPath());
    }
    writePrimary(bytes) {
      mkdirSync(this.directory, { recursive: true });
      const temporary = path_default.join(this.directory, `.primary-${randomUUID()}.tmp`);
      writeFileSync(temporary, bytes);
      renameSync(temporary, this.primaryPath());
    }
    keepCopy(bytes, revision) {
      mkdirSync(this.revisionCopies(), { recursive: true });
      writeFileSync(path_default.join(this.revisionCopies(), `revision-${revision}-${randomUUID()}.json`), bytes);
    }
    copyNames() {
      if (!existsSync(this.revisionCopies())) return [];
      return readdirSync(this.revisionCopies()).filter((name) => name.endsWith(".json"));
    }
    highestCopyRevision() {
      let highest = -1;
      for (const name of this.copyNames()) {
        const match = /^revision-(\d+)-/.exec(name);
        if (!match) continue;
        highest = Math.max(highest, Number(match[1]));
      }
      return highest;
    }
    locked(action) {
      mkdirSync(this.directory, { recursive: true });
      const lockPath = path_default.join(this.directory, ".write.lock");
      const descriptor = acquire(lockPath);
      try {
        return action();
      } finally {
        closeSync(descriptor);
        unlinkSync(lockPath);
      }
    }
  };
  function commit(store, proposed, expectedRevision, afterCommit) {
    const workspace = store.save(proposed, expectedRevision);
    if (!afterCommit) return { workspace, collaborationError: null };
    try {
      afterCommit();
      return { workspace, collaborationError: null };
    } catch (error) {
      return {
        workspace,
        collaborationError: error instanceof Error ? error.message : String(error)
      };
    }
  }
  var DocumentDraftStore = class {
    directory;
    constructor(directory) {
      this.directory = directory;
    }
    path() {
      return path_default.join(this.directory, "document-drafts", "draft.json");
    }
    save(text3) {
      if (this.path().includes(`${path_default.sep}revision-copies${path_default.sep}`)) {
        throw new DomainError("draft-in-backup");
      }
      mkdirSync(path_default.dirname(this.path()), { recursive: true });
      const temporary = `${this.path()}.${randomUUID()}.tmp`;
      writeFileSync(temporary, JSON.stringify({ text: text3 }));
      renameSync(temporary, this.path());
    }
    read() {
      if (!existsSync(this.path())) return null;
      const parsed = JSON.parse(readFileSync(this.path(), "utf8"));
      if (!parsed || typeof parsed !== "object" || !("text" in parsed) || typeof parsed.text !== "string") {
        throw new DomainError("invalid-draft");
      }
      return parsed.text;
    }
    documentPath() {
      return path_default.join(this.directory, "document-drafts", "document.json");
    }
    exportPath() {
      return path_default.join(this.directory, "document-drafts", "export.json");
    }
    pdfPath() {
      return path_default.join(this.directory, "document-drafts", "export.pdf");
    }
    saveDocument(draft3) {
      const saved = draftFromUnknown(draft3);
      this.writeAside(this.documentPath(), { kind: "nexo-reconstruction-document-draft", ...saved });
      return saved;
    }
    readDocument() {
      if (!existsSync(this.documentPath())) return null;
      const parsed = JSON.parse(readFileSync(this.documentPath(), "utf8"));
      if (!parsed || typeof parsed !== "object" || !("kind" in parsed) || parsed.kind !== "nexo-reconstruction-document-draft") {
        throw new DomainError("invalid-draft");
      }
      return draftFromUnknown(parsed);
    }
    /**
     * Writes the layout and its PDF only when every page fits and every character can be encoded.
     * A refusal leaves any previous PDF, layout file, and draft bytes in place.
     */
    exportDocument(draft3) {
      const result = layoutDocument(draft3);
      if (!result.fits || !result.document) return result;
      const rendered = renderDocumentPdf(result.document);
      if ("problems" in rendered) return { fits: false, problems: rendered.problems, draft: result.draft, document: null };
      const layout = `${JSON.stringify({ kind: "nexo-reconstruction-document-export", pages: result.document.pages }, null, 2)}
`;
      this.publish(this.pdfPath(), rendered.bytes);
      this.publish(this.exportPath(), Buffer.from(layout, "utf8"));
      return result;
    }
    writeAside(filePath, value) {
      this.publish(filePath, Buffer.from(`${JSON.stringify(value, null, 2)}
`, "utf8"));
    }
    publish(filePath, bytes) {
      if (filePath.includes(`${path_default.sep}revision-copies${path_default.sep}`)) throw new DomainError("draft-in-backup");
      mkdirSync(path_default.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${randomUUID()}.tmp`;
      writeFileSync(temporary, bytes);
      renameSync(temporary, filePath);
    }
  };
  function parseWorkspace(raw) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new DomainError("corrupt-primary");
    }
    const record = recordOf(value);
    if (record.schema !== SCHEMA || record.schemaVersion !== 1) throw new DomainError("unsupported-schema");
    return {
      schema: SCHEMA,
      schemaVersion: 1,
      revision: integer(record.revision),
      spaces: array(record.spaces).map(spaceOf),
      periods: array(record.periods).map(periodOf),
      people: array(record.people).map(personOf),
      groups: array(record.groups).map(groupOf),
      memberships: array(record.memberships).map(membershipOf),
      components: array(record.components).map(componentOf),
      encounters: array(record.encounters).map(encounterOf),
      attendance: array(record.attendance).map(attendanceOf),
      volunteers: array(record.volunteers).map(volunteerOf),
      collaboration: array(record.collaboration).map(linkOf)
    };
  }
  function encode(workspace) {
    return Buffer.from(`${JSON.stringify(sortKeys(workspace), null, 2)}
`, "utf8");
  }
  function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== "object") return value;
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  function acquire(lockPath) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const descriptor = openSync(lockPath, "wx");
        writeFileSync(descriptor, String(process.pid));
        return descriptor;
      } catch (error) {
        const code = error.code;
        if (code !== "EEXIST") throw error;
        const owner = Number(readFileSync(lockPath, "utf8"));
        if (Number.isInteger(owner) && owner > 0 && !processAlive(owner)) {
          unlinkSync(lockPath);
          continue;
        }
        const until = Date.now() + 20;
        while (Date.now() < until) {
        }
      }
    }
    throw new DomainError("write-lock-unavailable");
  }
  function processAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  function recordOf(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("corrupt-primary");
    return value;
  }
  function array(value) {
    if (!Array.isArray(value)) throw new DomainError("corrupt-primary");
    return value;
  }
  function text(value) {
    if (typeof value !== "string") throw new DomainError("corrupt-primary");
    return value;
  }
  function flag(value) {
    if (typeof value !== "boolean") throw new DomainError("corrupt-primary");
    return value;
  }
  function integer(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new DomainError("corrupt-primary");
    return value;
  }
  function nullableText(value) {
    if (value == null) return null;
    return text(value);
  }
  function spaceOf(value) {
    const record = recordOf(value);
    return { id: text(record.id), name: text(record.name), timeZone: text(record.timeZone) };
  }
  function periodOf(value) {
    const record = recordOf(value);
    return {
      id: text(record.id),
      spaceId: text(record.spaceId),
      name: text(record.name),
      startsAt: text(record.startsAt),
      endsAt: text(record.endsAt)
    };
  }
  function personOf(value) {
    const record = recordOf(value);
    return { id: text(record.id), spaceId: text(record.spaceId), name: text(record.name), active: flag(record.active) };
  }
  function groupOf(value) {
    const record = recordOf(value);
    return { id: text(record.id), spaceId: text(record.spaceId), name: text(record.name) };
  }
  function membershipOf(value) {
    const record = recordOf(value);
    return {
      id: text(record.id),
      personId: text(record.personId),
      groupId: text(record.groupId),
      startsAt: text(record.startsAt),
      endsAt: nullableText(record.endsAt)
    };
  }
  function componentOf(value) {
    const record = recordOf(value);
    return { id: text(record.id), spaceId: text(record.spaceId), name: text(record.name) };
  }
  function encounterOf(value) {
    const record = recordOf(value);
    const capacity = record.volunteerCapacity;
    if (capacity != null && (typeof capacity !== "number" || !Number.isSafeInteger(capacity))) {
      throw new DomainError("corrupt-primary");
    }
    return {
      id: text(record.id),
      spaceId: text(record.spaceId),
      title: text(record.title),
      startsAt: text(record.startsAt),
      componentId: text(record.componentId),
      categoryId: nullableText(record.categoryId),
      countsAttendance: flag(record.countsAttendance),
      cancelled: flag(record.cancelled),
      volunteerCapacity: capacity ?? null
    };
  }
  function attendanceOf(value) {
    const record = recordOf(value);
    const status = text(record.status);
    if (!ATTENDANCE.includes(status)) throw new DomainError("corrupt-primary");
    return {
      id: text(record.id),
      encounterId: text(record.encounterId),
      personId: text(record.personId),
      status,
      voided: flag(record.voided),
      note: text(record.note),
      recordedAt: nullableText(record.recordedAt),
      eventInstant: text(record.eventInstant),
      componentId: text(record.componentId),
      categoryId: nullableText(record.categoryId),
      countsAttendance: flag(record.countsAttendance)
    };
  }
  function volunteerOf(value) {
    const record = recordOf(value);
    const status = text(record.status);
    if (!VOLUNTEER.includes(status)) throw new DomainError("corrupt-primary");
    return {
      id: text(record.id),
      encounterId: text(record.encounterId),
      personId: text(record.personId),
      status,
      registeredAt: text(record.registeredAt)
    };
  }
  function linkOf(value) {
    const record = recordOf(value);
    return {
      spaceId: text(record.spaceId),
      paused: flag(record.paused),
      pendingUploads: array(record.pendingUploads).map(text),
      entries: array(record.entries).map((entry) => {
        const item = recordOf(entry);
        return {
          key: text(item.key),
          versions: array(item.versions).map((version) => {
            const alternative = recordOf(version);
            return { id: text(alternative.id), value: text(alternative.value) };
          })
        };
      })
    };
  }

  // src/journey.ts
  var SYNTHETIC = {
    spaceId: "11111111-1111-4111-8111-111111111111",
    periodId: "22222222-2222-4222-8222-222222222222",
    alfaId: "33333333-3333-4333-8333-333333333331",
    betaId: "33333333-3333-4333-8333-333333333332",
    gammaId: "33333333-3333-4333-8333-333333333333",
    componentId: "44444444-4444-4444-8444-444444444444",
    encounterId: "55555555-5555-4555-8555-555555555555",
    spaceName: "Espacio sint\xE9tico",
    periodName: "Per\xEDodo sint\xE9tico",
    alfaName: "Persona Alfa",
    betaName: "Persona Beta",
    gammaName: "Persona Gamma",
    encounterTitle: "Encuentro sint\xE9tico",
    timeZone: "Etc/UTC",
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2027-01-01T00:00:00.000Z",
    encounterAt: "2026-10-24T15:00:00.000Z",
    recordedAt: "2026-10-24T15:05:00.000Z"
  };
  function runFirstJourney(directory) {
    const store = new FileWorkspaceStore(directory);
    let workspace = store.initialize(emptyWorkspace());
    workspace = createSpace(workspace, {
      id: SYNTHETIC.spaceId,
      name: SYNTHETIC.spaceName,
      timeZone: SYNTHETIC.timeZone
    });
    workspace = addPeriod(workspace, {
      id: SYNTHETIC.periodId,
      spaceId: SYNTHETIC.spaceId,
      name: SYNTHETIC.periodName,
      startsAt: SYNTHETIC.periodStart,
      endsAt: SYNTHETIC.periodEnd
    });
    workspace = addPerson(workspace, { id: SYNTHETIC.alfaId, spaceId: SYNTHETIC.spaceId, name: SYNTHETIC.alfaName });
    workspace = addPerson(workspace, { id: SYNTHETIC.betaId, spaceId: SYNTHETIC.spaceId, name: SYNTHETIC.betaName });
    workspace = addPerson(workspace, { id: SYNTHETIC.gammaId, spaceId: SYNTHETIC.spaceId, name: SYNTHETIC.gammaName });
    workspace = addComponent(workspace, {
      id: SYNTHETIC.componentId,
      spaceId: SYNTHETIC.spaceId,
      name: "Componente sint\xE9tico"
    });
    workspace = createEncounter(workspace, {
      id: SYNTHETIC.encounterId,
      spaceId: SYNTHETIC.spaceId,
      title: SYNTHETIC.encounterTitle,
      startsAt: SYNTHETIC.encounterAt,
      componentId: SYNTHETIC.componentId,
      personIds: [SYNTHETIC.alfaId, SYNTHETIC.betaId]
    });
    workspace = setAttendance(workspace, {
      encounterId: SYNTHETIC.encounterId,
      personId: SYNTHETIC.alfaId,
      status: "present",
      recordedAt: SYNTHETIC.recordedAt
    });
    workspace = setAttendance(workspace, {
      encounterId: SYNTHETIC.encounterId,
      personId: SYNTHETIC.betaId,
      status: "absent",
      recordedAt: SYNTHETIC.recordedAt
    });
    store.save(workspace, 0);
  }
  function describeJourney(directory, lang) {
    const workspace = new FileWorkspaceStore(directory).load();
    const space = workspace.spaces[0];
    const labels = lang === "en" ? { present: "present", absent: "absent", excused: "excused", pending: "pending", none: "no record", empty: "no countable encounters" } : { present: "presente", absent: "ausente", excused: "excusada", pending: "por registrar", none: "sin registro", empty: "sin encuentros evaluables" };
    const lines = [`${space.name} [${space.timeZone}]`];
    for (const person of workspace.people) {
      const row = workspace.attendance.find((item) => item.personId === person.id);
      const rate = attendanceRate(workspace, person.id, workspace.periods[0]?.id);
      const mark = row ? labels[row.status] : labels.none;
      const score = rate.ratio == null ? labels.empty : `${rate.present}/${rate.counted}`;
      lines.push(`${person.name}: ${mark}; ${score}`);
    }
    return lines.join("\n");
  }

  // src/collaboration-journey.ts
  var COLLABORATION = {
    spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    spaceName: "Espacio sint\xE9tico",
    timeZone: "Etc/UTC",
    key: "encounter:1",
    localId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    remoteId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    localValue: "alternativa-local",
    remoteValue: "alternativa-remota",
    portError: "sync port unavailable"
  };
  function unavailableSyncPort() {
    return {
      publish() {
        throw new Error(COLLABORATION.portError);
      }
    };
  }
  function runCollaborationJourney(directory, port = unavailableSyncPort()) {
    const store = new FileWorkspaceStore(directory);
    let workspace = store.initialize(emptyWorkspace());
    workspace = createSpace(workspace, {
      id: COLLABORATION.spaceId,
      name: COLLABORATION.spaceName,
      timeZone: COLLABORATION.timeZone
    });
    workspace = linkCollaboration(workspace, COLLABORATION.spaceId);
    workspace = recordAlternative(workspace, {
      spaceId: COLLABORATION.spaceId,
      key: COLLABORATION.key,
      version: { id: COLLABORATION.localId, value: COLLABORATION.localValue }
    });
    const first = commit(store, workspace, 0, () => port.publish());
    if (first.collaborationError !== COLLABORATION.portError) throw new DomainError("sync-port-silent");
    if (!kept(store.load(), [COLLABORATION.localValue])) throw new DomainError("local-save-lost");
    workspace = recordAlternative(first.workspace, {
      spaceId: COLLABORATION.spaceId,
      key: COLLABORATION.key,
      version: { id: COLLABORATION.remoteId, value: COLLABORATION.remoteValue }
    });
    const conflict = commit(store, workspace, first.workspace.revision, () => port.publish());
    if (conflict.collaborationError !== COLLABORATION.portError) throw new DomainError("sync-port-silent");
    const both = [COLLABORATION.localValue, COLLABORATION.remoteValue];
    if (!kept(store.load(), both)) throw new DomainError("local-save-lost");
    try {
      store.save(first.workspace, first.workspace.revision);
      throw new DomainError("stale-write-applied");
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "stale-revision") throw error;
    }
    if (!kept(store.load(), both)) throw new DomainError("alternatives-overwritten");
    const pendingBefore = store.load().collaboration[0].pendingUploads.length;
    const copy2 = path_default.join(directory, "synthetic-copy.json");
    writeFileSync(copy2, readFileSync(store.primaryPath()));
    const restored = store.restore(copy2);
    const link = restored.collaboration[0];
    if (!link.paused || link.pendingUploads.length !== pendingBefore) throw new DomainError("upload-enqueued");
    if (!kept(restored, both)) throw new DomainError("alternatives-overwritten");
    return first.collaborationError;
  }
  function resolvePausedAlternative(directory, versionId) {
    const store = new FileWorkspaceStore(directory);
    const current = store.load();
    const chosenId = canonicalId(versionId);
    const link = current.collaboration.find(
      (item) => item.entries.some((entry2) => entry2.versions.some((version) => canonicalId(version.id) === chosenId))
    );
    if (!link) throw new DomainError("missing-alternative");
    if (!link.paused) throw new DomainError("sync-not-paused");
    const entry = link.entries.find((item) => item.versions.some((version) => canonicalId(version.id) === chosenId));
    if (!entry) throw new DomainError("missing-alternative");
    const next = chooseAlternative(current, { spaceId: link.spaceId, key: entry.key, versionId: chosenId });
    const drafted = next.collaboration.find((item) => item.spaceId === link.spaceId);
    const versions = drafted?.entries.find((item) => item.key === entry.key)?.versions ?? [];
    const chosen = versions[0];
    const sameQueue = drafted !== void 0 && drafted.pendingUploads.length === link.pendingUploads.length && drafted.pendingUploads.every((item, index) => item === link.pendingUploads[index]);
    if (!chosen || versions.length !== 1 || chosen.id !== chosenId || !sameQueue) throw new DomainError("upload-enqueued");
    const saved = store.save(next, current.revision);
    if (saved.revision !== current.revision + 1) throw new DomainError("revision-stalled");
    return chosen.value;
  }
  function describeCollaboration(directory, lang) {
    const workspace = new FileWorkspaceStore(directory).load();
    const space = workspace.spaces[0];
    const link = workspace.collaboration[0];
    const paused = link?.paused === true;
    const pending = link?.pendingUploads ?? [];
    const versions = link?.entries.flatMap((entry) => entry.versions.map((version) => `${entry.key}: ${version.value}`)) ?? [];
    if (lang === "en") {
      return [
        `${space.name} [${space.timeZone}]`,
        `Sync: ${paused ? "paused" : "active"}`,
        `Pending uploads: ${pending.length === 0 ? "none" : pending.join(", ")}`,
        `Alternatives: ${versions.join(" | ")}`
      ].join("\n");
    }
    return [
      `${space.name} [${space.timeZone}]`,
      `Sincronizaci\xF3n: ${paused ? "en pausa" : "activa"}`,
      `Subidas pendientes: ${pending.length === 0 ? "ninguna" : pending.join(", ")}`,
      `Alternativas: ${versions.join(" | ")}`
    ].join("\n");
  }
  function kept(workspace, values) {
    const found = workspace.collaboration[0]?.entries[0]?.versions.map((version) => version.value) ?? [];
    return values.every((value) => found.includes(value)) && workspace.spaces.length === 1;
  }

  // src/migrate.ts
  var ATTENDANCE2 = ["pending", "present", "absent", "excused"];
  var PREVIOUS_COPY = "nexo-reconstruction-previous.json";
  function migrateLegacyFile(directory, sourcePath, seal = () => void 0) {
    assertSourcePath(sourcePath);
    const original = readFileSync(sourcePath);
    const legacy = parseLegacy(original.toString("utf8"));
    const projected = projectLegacy(legacy);
    validate(projected);
    if (!migrationMatches(legacy, projected)) throw new DomainError("migration-rejected");
    const store = new FileWorkspaceStore(directory);
    const previous = existsSync(store.primaryPath()) ? readFileSync(store.primaryPath()) : null;
    try {
      if (previous) {
        const current = store.load();
        store.save({ ...projected, revision: current.revision }, current.revision);
      } else {
        store.initialize({ ...projected, revision: 0 });
      }
      const loaded = store.load();
      if (!migrationMatches(legacy, loaded)) throw new DomainError("migration-rejected");
      seal(loaded);
      if (!readFileSync(sourcePath).equals(original)) throw new DomainError("source-mutated");
      if (previous) writeFileSync(previousCopyPath(directory), previous);
      return loaded;
    } catch (error) {
      restorePrimary(directory, previous);
      throw error;
    }
  }
  function revertToPreviousCopy(directory) {
    const stored = previousCopyPath(directory);
    if (!existsSync(stored)) throw new DomainError("missing-previous");
    const bytes = readFileSync(stored);
    const workspace = parsePrevious(bytes);
    const store = new FileWorkspaceStore(directory);
    const temporary = path_default.join(directory, `.revert-${randomUUID()}.tmp`);
    writeFileSync(temporary, bytes);
    try {
      const checked = parsePrevious(readFileSync(temporary));
      if (!sameWork(workspace, checked)) throw new DomainError("migration-rejected");
      renameSync(temporary, store.primaryPath());
      return checked;
    } catch (error) {
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }
  function migrationMatches(legacy, workspace) {
    if (workspace.people.length !== legacy.members.length) return false;
    if (workspace.encounters.length !== legacy.events.length) return false;
    if (workspace.attendance.length !== legacy.attendance.length) return false;
    for (const member of legacy.members) {
      const person = workspace.people.find((item) => item.id === canonicalId(member.id));
      if (!person || person.name !== member.name || person.active !== member.isActive) return false;
      if (person.spaceId !== canonicalId(member.organizationID)) return false;
    }
    for (const event of legacy.events) {
      const encounter = workspace.encounters.find((item) => item.id === canonicalId(event.id));
      if (!encounter || encounter.title !== event.title || encounter.cancelled !== event.isCancelled) return false;
      if (encounter.startsAt !== canonicalizeInstant(event.startsAt)) return false;
      if (encounter.countsAttendance !== event.countsAttendance) return false;
    }
    for (const row of legacy.attendance) {
      const event = legacy.events.find((item) => canonicalId(item.id) === canonicalId(row.eventID));
      const attendance = workspace.attendance.find((item) => item.id === canonicalId(row.id));
      if (!event || !attendance) return false;
      if (attendance.personId !== canonicalId(row.memberID) || attendance.encounterId !== canonicalId(row.eventID)) {
        return false;
      }
      if (attendance.status !== row.status || attendance.voided !== row.isVoided || attendance.note !== row.note) return false;
      if (attendance.eventInstant !== canonicalizeInstant(row.eventDateSnapshot ?? event.startsAt)) return false;
      const recorded = row.recordedAt ? canonicalizeInstant(row.recordedAt) : null;
      if (attendance.recordedAt !== recorded) return false;
    }
    return true;
  }
  function previousCopyPath(directory) {
    return path_default.join(directory, PREVIOUS_COPY);
  }
  function assertSourcePath(sourcePath) {
    const resolved = path_default.resolve(sourcePath);
    const parts = resolved.split(path_default.sep).map((part) => part.toLowerCase());
    if (parts.includes("application support")) throw new DomainError("refused-location");
    if (path_default.basename(resolved) === "vrr-data.json") throw new DomainError("unsupported-schema");
    if (path_default.basename(resolved) !== "workspace-v1.json") throw new DomainError("unsupported-schema");
  }
  function parseLegacy(raw) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new DomainError("corrupt-primary");
    }
    const record = recordOf2(value);
    if (record.kind === "vrr-data") throw new DomainError("unsupported-schema");
    if (record.schemaVersion !== 1) throw new DomainError("unsupported-schema");
    return {
      organizations: array2(record.organizations).map(organizationOf),
      components: array2(record.components).map(componentOf2),
      members: array2(record.members).map(memberOf),
      events: array2(record.events).map(eventOf),
      attendance: array2(record.attendance).map(attendanceOf2)
    };
  }
  function projectLegacy(legacy) {
    const events = new Map(legacy.events.map((event) => [canonicalId(event.id), event]));
    return {
      schema: SCHEMA,
      schemaVersion: 1,
      revision: 0,
      spaces: legacy.organizations.map((organization) => ({
        id: canonicalId(organization.id),
        name: organization.name,
        timeZone: organization.timeZoneIdentifier
      })),
      periods: [],
      people: legacy.members.map((member) => ({
        id: canonicalId(member.id),
        spaceId: canonicalId(member.organizationID),
        name: member.name,
        active: member.isActive
      })),
      groups: [],
      memberships: [],
      components: legacy.components.map((component) => ({
        id: canonicalId(component.id),
        spaceId: canonicalId(component.organizationID),
        name: component.name
      })),
      encounters: legacy.events.map((event) => ({
        id: canonicalId(event.id),
        spaceId: canonicalId(event.organizationID),
        title: event.title,
        startsAt: canonicalizeInstant(event.startsAt),
        componentId: canonicalId(event.componentID),
        categoryId: event.categoryID ? canonicalId(event.categoryID) : null,
        countsAttendance: event.countsAttendance,
        cancelled: event.isCancelled,
        volunteerCapacity: event.volunteerCapacity
      })),
      attendance: legacy.attendance.map((row) => {
        const event = events.get(canonicalId(row.eventID));
        if (!event) throw new DomainError("broken-relationship");
        const category = row.categoryIDSnapshot ?? event.categoryID;
        return {
          id: canonicalId(row.id),
          encounterId: canonicalId(row.eventID),
          personId: canonicalId(row.memberID),
          status: row.status,
          voided: row.isVoided,
          note: row.note,
          recordedAt: row.recordedAt ? canonicalizeInstant(row.recordedAt) : null,
          eventInstant: canonicalizeInstant(row.eventDateSnapshot ?? event.startsAt),
          componentId: canonicalId(row.componentIDSnapshot ?? event.componentID),
          categoryId: category ? canonicalId(category) : null,
          countsAttendance: row.countsAttendanceSnapshot ?? event.countsAttendance
        };
      }),
      volunteers: [],
      collaboration: []
    };
  }
  function parsePrevious(bytes) {
    const workspace = parseWorkspace(bytes.toString("utf8"));
    validate(workspace);
    return workspace;
  }
  function sameWork(left, right) {
    return left.people.length === right.people.length && left.encounters.length === right.encounters.length && left.attendance.length === right.attendance.length && left.people.every((person, index) => person.id === right.people[index]?.id && person.name === right.people[index]?.name) && left.attendance.every((row, index) => row.id === right.attendance[index]?.id && row.status === right.attendance[index]?.status);
  }
  function restorePrimary(directory, previous) {
    const primary = new FileWorkspaceStore(directory).primaryPath();
    if (!previous) {
      if (existsSync(primary)) unlinkSync(primary);
      return;
    }
    const temporary = path_default.join(directory, `.migration-rollback-${randomUUID()}.tmp`);
    writeFileSync(temporary, previous);
    renameSync(temporary, primary);
  }
  function canonicalizeInstant(value) {
    const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
    if (!match) throw new DomainError("invalid-instant");
    const canonical = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
    parseInstant(canonical);
    return canonical;
  }
  function organizationOf(value) {
    const record = recordOf2(value);
    return { id: text2(record.id), name: text2(record.name), timeZoneIdentifier: text2(record.timeZoneIdentifier) };
  }
  function componentOf2(value) {
    const record = recordOf2(value);
    return { id: text2(record.id), organizationID: text2(record.organizationID), name: text2(record.name) };
  }
  function memberOf(value) {
    const record = recordOf2(value);
    return {
      id: text2(record.id),
      organizationID: text2(record.organizationID),
      name: text2(record.name),
      isActive: flag2(record.isActive)
    };
  }
  function eventOf(value) {
    const record = recordOf2(value);
    const capacity = record.volunteerCapacity;
    if (capacity != null && (typeof capacity !== "number" || !Number.isSafeInteger(capacity))) {
      throw new DomainError("corrupt-primary");
    }
    return {
      id: text2(record.id),
      organizationID: text2(record.organizationID),
      title: text2(record.title),
      startsAt: text2(record.startsAt),
      componentID: text2(record.componentID),
      categoryID: optionalText(record.categoryID),
      countsAttendance: flag2(record.countsAttendance),
      isCancelled: flag2(record.isCancelled),
      volunteerCapacity: capacity ?? null
    };
  }
  function attendanceOf2(value) {
    const record = recordOf2(value);
    const status = text2(record.status);
    if (!ATTENDANCE2.includes(status)) throw new DomainError("corrupt-primary");
    return {
      id: text2(record.id),
      eventID: text2(record.eventID),
      memberID: text2(record.memberID),
      status,
      isVoided: flag2(record.isVoided),
      note: text2(record.note),
      recordedAt: optionalText(record.recordedAt),
      eventDateSnapshot: optionalText(record.eventDateSnapshot),
      componentIDSnapshot: optionalText(record.componentIDSnapshot),
      categoryIDSnapshot: optionalText(record.categoryIDSnapshot),
      countsAttendanceSnapshot: optionalFlag(record.countsAttendanceSnapshot)
    };
  }
  function recordOf2(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("corrupt-primary");
    return value;
  }
  function array2(value) {
    if (!Array.isArray(value)) throw new DomainError("corrupt-primary");
    return value;
  }
  function text2(value) {
    if (typeof value !== "string") throw new DomainError("corrupt-primary");
    return value;
  }
  function optionalText(value) {
    if (value == null) return null;
    return text2(value);
  }
  function flag2(value) {
    if (typeof value !== "boolean") throw new DomainError("corrupt-primary");
    return value;
  }
  function optionalFlag(value) {
    if (value == null) return null;
    return flag2(value);
  }

  // src/volunteer-journey.ts
  var VOLUNTEERS = {
    spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    periodId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    componentId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    earlierEncounterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    laterEncounterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
    currentEncounterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3",
    ceroId: "10000000-0000-4000-8000-000000000001",
    tardiaId: "20000000-0000-4000-8000-000000000002",
    nulaId: "30000000-0000-4000-8000-000000000003",
    extraId: "40000000-0000-4000-8000-000000000004",
    tempranaId: "50000000-0000-4000-8000-000000000005",
    recienteId: "60000000-0000-4000-8000-000000000006",
    dobleId: "70000000-0000-4000-8000-000000000007",
    fueraId: "80000000-0000-4000-8000-000000000008",
    categoryComponentId: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
    categoryAId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    categoryBId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    categoryPriorAId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
    categoryPriorBId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5",
    categoryEncounterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6",
    cancelledEncounterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7",
    openEncounterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee8",
    outsideEncounterId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9",
    alfaCategoryId: "90000000-0000-4000-8000-000000000001",
    betaCategoryId: "90000000-0000-4000-8000-000000000002",
    inactiveId: "90000000-0000-4000-8000-000000000003",
    otherSpaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    otherPersonId: "90000000-0000-4000-8000-000000000004",
    spaceName: "Espacio sint\xE9tico",
    periodName: "Per\xEDodo sint\xE9tico",
    timeZone: "Etc/UTC",
    periodStart: "2026-01-01T00:00:00.000Z",
    periodEnd: "2027-01-01T00:00:00.000Z",
    earlierAt: "2026-02-01T00:00:00.000Z",
    laterAt: "2026-03-01T00:00:00.000Z",
    currentAt: "2026-04-01T00:00:00.000Z",
    earlierTitle: "Primera participaci\xF3n",
    laterTitle: "Segunda participaci\xF3n",
    currentTitle: "Encuentro actual"
  };
  var PEOPLE = [
    [VOLUNTEERS.ceroId, "Persona Cero"],
    [VOLUNTEERS.tardiaId, "Persona Tard\xEDa"],
    [VOLUNTEERS.nulaId, "Persona Nula"],
    [VOLUNTEERS.extraId, "Persona Extra"],
    [VOLUNTEERS.tempranaId, "Persona Temprana"],
    [VOLUNTEERS.recienteId, "Persona Reciente"],
    [VOLUNTEERS.dobleId, "Persona Doble"],
    [VOLUNTEERS.fueraId, "Persona Fuera"]
  ];
  function participate(workspace, encounterId, personId, registeredAt, participated) {
    let next = registerVolunteer(workspace, { encounterId, personId, registeredAt });
    next = chooseVolunteer(next, encounterId, personId);
    return finishVolunteer(next, encounterId, personId, participated);
  }
  function runVolunteerJourney(directory) {
    const store = new FileWorkspaceStore(directory);
    let workspace = store.initialize(emptyWorkspace());
    workspace = createSpace(workspace, { id: VOLUNTEERS.spaceId, name: VOLUNTEERS.spaceName, timeZone: VOLUNTEERS.timeZone });
    workspace = addPeriod(workspace, {
      id: VOLUNTEERS.periodId,
      spaceId: VOLUNTEERS.spaceId,
      name: VOLUNTEERS.periodName,
      startsAt: VOLUNTEERS.periodStart,
      endsAt: VOLUNTEERS.periodEnd
    });
    workspace = addComponent(workspace, { id: VOLUNTEERS.componentId, spaceId: VOLUNTEERS.spaceId, name: "Componente sint\xE9tico" });
    for (const [id, name] of PEOPLE) workspace = addPerson(workspace, { id, spaceId: VOLUNTEERS.spaceId, name });
    workspace = createEncounter(workspace, {
      id: VOLUNTEERS.earlierEncounterId,
      spaceId: VOLUNTEERS.spaceId,
      title: VOLUNTEERS.earlierTitle,
      startsAt: VOLUNTEERS.earlierAt,
      componentId: VOLUNTEERS.componentId,
      volunteerCapacity: 4
    });
    workspace = createEncounter(workspace, {
      id: VOLUNTEERS.laterEncounterId,
      spaceId: VOLUNTEERS.spaceId,
      title: VOLUNTEERS.laterTitle,
      startsAt: VOLUNTEERS.laterAt,
      componentId: VOLUNTEERS.componentId,
      volunteerCapacity: 4
    });
    workspace = createEncounter(workspace, {
      id: VOLUNTEERS.currentEncounterId,
      spaceId: VOLUNTEERS.spaceId,
      title: VOLUNTEERS.currentTitle,
      startsAt: VOLUNTEERS.currentAt,
      componentId: VOLUNTEERS.componentId,
      volunteerCapacity: 1
    });
    workspace = participate(workspace, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.tempranaId, "2026-01-02T00:00:00.000Z", true);
    workspace = participate(workspace, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.dobleId, "2026-01-02T00:00:00.000Z", true);
    workspace = participate(workspace, VOLUNTEERS.earlierEncounterId, VOLUNTEERS.tardiaId, "2026-01-02T00:00:00.000Z", false);
    workspace = participate(workspace, VOLUNTEERS.laterEncounterId, VOLUNTEERS.dobleId, "2026-01-03T00:00:00.000Z", true);
    workspace = participate(workspace, VOLUNTEERS.laterEncounterId, VOLUNTEERS.recienteId, "2026-01-03T00:00:00.000Z", true);
    const interested = [
      [VOLUNTEERS.ceroId, "2026-01-09T00:00:00.000Z"],
      [VOLUNTEERS.tardiaId, "2026-01-10T00:00:00.000Z"],
      [VOLUNTEERS.nulaId, "2026-01-11T00:00:00.000Z"],
      [VOLUNTEERS.extraId, "2026-01-11T00:00:00.000Z"],
      [VOLUNTEERS.tempranaId, "2026-01-12T00:00:00.000Z"],
      [VOLUNTEERS.recienteId, "2026-01-13T00:00:00.000Z"],
      [VOLUNTEERS.dobleId, "2026-01-14T00:00:00.000Z"]
    ];
    for (const [personId, registeredAt] of interested) {
      workspace = registerVolunteer(workspace, { encounterId: VOLUNTEERS.currentEncounterId, personId, registeredAt });
    }
    const ranked = suggestVolunteers(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.periodId);
    const manual = ranked[0];
    if (manual?.personId !== VOLUNTEERS.ceroId) throw new DomainError("invalid-transition");
    workspace = chooseVolunteer(workspace, VOLUNTEERS.currentEncounterId, manual.personId);
    workspace = declineVolunteer(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.dobleId);
    workspace = addCategoryJourney(workspace);
    store.save(workspace, 0);
    rejectedVolunteerCommands(store.load());
  }
  function addCategoryJourney(workspace) {
    let next = addComponent(workspace, {
      id: VOLUNTEERS.categoryComponentId,
      spaceId: VOLUNTEERS.spaceId,
      name: "Componente de categor\xEDa"
    });
    next = addPerson(next, { id: VOLUNTEERS.alfaCategoryId, spaceId: VOLUNTEERS.spaceId, name: "Persona Alfa Categor\xEDa" });
    next = addPerson(next, { id: VOLUNTEERS.betaCategoryId, spaceId: VOLUNTEERS.spaceId, name: "Persona Beta Categor\xEDa" });
    next = addPerson(next, { id: VOLUNTEERS.inactiveId, spaceId: VOLUNTEERS.spaceId, name: "Persona Inactiva", active: false });
    next = createSpace(next, { id: VOLUNTEERS.otherSpaceId, name: "Otro espacio", timeZone: VOLUNTEERS.timeZone });
    next = addPerson(next, { id: VOLUNTEERS.otherPersonId, spaceId: VOLUNTEERS.otherSpaceId, name: "Persona Ajena" });
    next = createEncounter(next, {
      id: VOLUNTEERS.categoryPriorAId,
      spaceId: VOLUNTEERS.spaceId,
      title: "Participaci\xF3n en la categor\xEDa",
      startsAt: "2026-06-01T00:00:00.000Z",
      componentId: VOLUNTEERS.categoryComponentId,
      categoryId: VOLUNTEERS.categoryAId,
      volunteerCapacity: 1
    });
    next = createEncounter(next, {
      id: VOLUNTEERS.categoryPriorBId,
      spaceId: VOLUNTEERS.spaceId,
      title: "Participaci\xF3n en otra categor\xEDa",
      startsAt: "2026-07-01T00:00:00.000Z",
      componentId: VOLUNTEERS.categoryComponentId,
      categoryId: VOLUNTEERS.categoryBId,
      volunteerCapacity: 1
    });
    next = createEncounter(next, {
      id: VOLUNTEERS.categoryEncounterId,
      spaceId: VOLUNTEERS.spaceId,
      title: "Encuentro de la categor\xEDa",
      startsAt: "2026-08-01T00:00:00.000Z",
      componentId: VOLUNTEERS.categoryComponentId,
      categoryId: VOLUNTEERS.categoryAId,
      volunteerCapacity: 2
    });
    next = createEncounter(next, {
      id: VOLUNTEERS.cancelledEncounterId,
      spaceId: VOLUNTEERS.spaceId,
      title: "Encuentro cancelado",
      startsAt: "2026-09-01T00:00:00.000Z",
      componentId: VOLUNTEERS.componentId,
      volunteerCapacity: 1,
      cancelled: true
    });
    next = createEncounter(next, {
      id: VOLUNTEERS.openEncounterId,
      spaceId: VOLUNTEERS.spaceId,
      title: "Encuentro sin cupo",
      startsAt: "2026-09-02T00:00:00.000Z",
      componentId: VOLUNTEERS.componentId,
      volunteerCapacity: null
    });
    next = createEncounter(next, {
      id: VOLUNTEERS.outsideEncounterId,
      spaceId: VOLUNTEERS.spaceId,
      title: "Encuentro fuera del per\xEDodo",
      startsAt: VOLUNTEERS.periodEnd,
      componentId: VOLUNTEERS.componentId,
      volunteerCapacity: 1
    });
    next = participate(next, VOLUNTEERS.categoryPriorAId, VOLUNTEERS.alfaCategoryId, "2026-06-02T00:00:00.000Z", true);
    next = participate(next, VOLUNTEERS.categoryPriorBId, VOLUNTEERS.betaCategoryId, "2026-07-02T00:00:00.000Z", true);
    next = registerVolunteer(next, {
      encounterId: VOLUNTEERS.categoryEncounterId,
      personId: VOLUNTEERS.alfaCategoryId,
      registeredAt: "2026-01-20T00:00:00.000Z"
    });
    next = registerVolunteer(next, {
      encounterId: VOLUNTEERS.categoryEncounterId,
      personId: VOLUNTEERS.betaCategoryId,
      registeredAt: "2026-01-21T00:00:00.000Z"
    });
    const ranked = suggestVolunteers(next, VOLUNTEERS.categoryEncounterId, VOLUNTEERS.periodId).map((item) => item.personId);
    if (ranked[0] !== VOLUNTEERS.betaCategoryId || ranked[1] !== VOLUNTEERS.alfaCategoryId) {
      throw new DomainError("invalid-transition");
    }
    return next;
  }
  function rejectedVolunteerCommands(workspace) {
    const registeredAt = "2026-01-15T00:00:00.000Z";
    refuses(
      () => registerVolunteer(workspace, { encounterId: VOLUNTEERS.cancelledEncounterId, personId: VOLUNTEERS.ceroId, registeredAt }),
      "volunteer-unavailable"
    );
    refuses(
      () => registerVolunteer(workspace, { encounterId: VOLUNTEERS.openEncounterId, personId: VOLUNTEERS.ceroId, registeredAt }),
      "volunteer-unavailable"
    );
    refuses(
      () => registerVolunteer(workspace, { encounterId: VOLUNTEERS.currentEncounterId, personId: VOLUNTEERS.inactiveId, registeredAt }),
      "volunteer-unavailable"
    );
    refuses(
      () => chooseVolunteer(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.otherPersonId),
      "invalid-transition"
    );
    if (suggestVolunteers(workspace, VOLUNTEERS.outsideEncounterId, VOLUNTEERS.periodId).length !== 0) {
      throw new DomainError("volunteer-unavailable");
    }
    const drafted = registerVolunteer(workspace, {
      encounterId: VOLUNTEERS.currentEncounterId,
      personId: VOLUNTEERS.otherPersonId,
      registeredAt
    });
    const suggested = suggestVolunteers(drafted, VOLUNTEERS.currentEncounterId, VOLUNTEERS.periodId);
    if (suggested.some((item) => item.personId === VOLUNTEERS.otherPersonId)) throw new DomainError("invalid-transition");
  }
  function refuses(command, code) {
    try {
      command();
    } catch (error) {
      if (error instanceof DomainError && error.code === code) return;
      throw error;
    }
    throw new DomainError(code);
  }
  function describeVolunteers(directory, lang) {
    const workspace = new FileWorkspaceStore(directory).load();
    const space = workspace.spaces[0];
    const labels = lang === "en" ? { interested: "interested", selected: "selected", declined: "declined", completed: "completed", noShow: "no-show" } : { interested: "interesado", selected: "seleccionado", declined: "declinado", completed: "completado", noShow: "no presentado" };
    const none = lang === "en" ? "not interested" : "sin inter\xE9s";
    const ranked = suggestVolunteers(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.periodId);
    const names = new Map(workspace.people.map((person) => [person.id, person.name]));
    const suggestion = ranked.map((item) => names.get(item.personId) ?? item.personId).join(", ");
    const categoryRanked = suggestVolunteers(workspace, VOLUNTEERS.categoryEncounterId, VOLUNTEERS.periodId);
    const categorySuggestion = categoryRanked.map((item) => names.get(item.personId) ?? item.personId).join(", ");
    const heading = lang === "en" ? "Suggestion" : "Sugerencia";
    const categoryHeading = lang === "en" ? "Category suggestion" : "Sugerencia por categor\xEDa";
    const noneSuggestion = lang === "en" ? "none" : "ninguna";
    const lines = [
      `${space.name} [${space.timeZone}]`,
      `${heading}: ${suggestion.length === 0 ? noneSuggestion : suggestion}`,
      `${categoryHeading}: ${categorySuggestion.length === 0 ? noneSuggestion : categorySuggestion}`
    ];
    for (const [personId, name] of PEOPLE) {
      const rows = workspace.volunteers.filter((entry) => entry.personId === personId);
      if (rows.length === 0) {
        lines.push(`${name}: ${none}`);
        continue;
      }
      const text3 = rows.map((entry) => {
        const title = workspace.encounters.find((encounter) => encounter.id === entry.encounterId)?.title ?? entry.encounterId;
        return lang === "en" ? `${labels[entry.status]} in ${title}` : `${labels[entry.status]} en ${title}`;
      }).join("; ");
      lines.push(`${name}: ${text3}`);
    }
    return lines.join("\n");
  }

  // src/interface.ts
  var INTERFACE_AREAS = {
    attendance: "asistencia",
    documents: "documentos",
    volunteers: "voluntariado",
    collaboration: "colaboracion",
    migration: "migracion"
  };
  var FITTING_NOTE = "Nota breve";
  var OVERFLOW_NOTE = "Linea uno\nLinea dos\nLinea tres\nLinea cuatro";
  var LEGACY = {
    space: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    alfa: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    gamma: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    beta: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
    component: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    encounter: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
    attendance: "ffffffff-ffff-4fff-8fff-fffffffffff1"
  };
  var copy = {
    es: {
      attendance: "Asistencia",
      document: "Documento",
      draft: "Borrador",
      pdf: "PDF",
      overflow: "No cabe",
      volunteers: "Voluntariado",
      quota: "Rechazo de cupo",
      collaboration: "Colaboraci\xF3n",
      chosen: "Alternativa elegida",
      migration: "Migraci\xF3n",
      reverted: "Copia nueva anterior restaurada."
    },
    en: {
      attendance: "Attendance",
      document: "Document",
      draft: "Draft",
      pdf: "PDF",
      overflow: "Does not fit",
      volunteers: "Volunteering",
      quota: "Quota refusal",
      collaboration: "Collaboration",
      chosen: "Alternative chosen",
      migration: "Migration",
      reverted: "Previous new copy restored."
    }
  };
  function pressInterface(directory, action, lang) {
    const text3 = copy[lang];
    if (action === "attendance") {
      const attendance = area(directory, INTERFACE_AREAS.attendance);
      runFirstJourney(attendance);
      return section(text3.attendance, describeJourney(attendance, lang));
    }
    if (action === "attendance-read") {
      return section(text3.attendance, describeJourney(area(directory, INTERFACE_AREAS.attendance), lang));
    }
    if (action === "document") {
      const documents = area(directory, INTERFACE_AREAS.documents);
      const drafts = new DocumentDraftStore(documents);
      const fitting = draft2(FITTING_NOTE);
      drafts.saveDocument(fitting);
      if (!drafts.exportDocument(fitting).fits) throw new DomainError("document-missing");
      return section(text3.document, documentLines(documents, lang));
    }
    if (action === "volunteers") {
      const volunteers = area(directory, INTERFACE_AREAS.volunteers);
      runVolunteerJourney(volunteers);
      return section(text3.volunteers, `${describeVolunteers(volunteers, lang)}
${text3.quota}: ${quotaRefusal(volunteers)}`);
    }
    if (action === "collaboration") {
      const collaboration = area(directory, INTERFACE_AREAS.collaboration);
      const portError = runCollaborationJourney(collaboration);
      if (portError.length === 0) throw new DomainError("sync-port-silent");
      return section(text3.collaboration, describeCollaboration(collaboration, lang));
    }
    if (action === "collaboration-choose") {
      const collaboration = area(directory, INTERFACE_AREAS.collaboration);
      const chosen = resolvePausedAlternative(collaboration, COLLABORATION.localId);
      return section(text3.collaboration, `${text3.chosen}: ${chosen}
${describeCollaboration(collaboration, lang)}`);
    }
    if (action === "migration") {
      const migration = area(directory, INTERFACE_AREAS.migration);
      const first = writeLegacy(migration, "origen", LEGACY.alfa, "Persona Alfa", true);
      const second = writeLegacy(migration, "otro", LEGACY.beta, "Persona Beta", false);
      migrateLegacyFile(migration, first);
      migrateLegacyFile(migration, second);
      return section(text3.migration, describeJourney(migration, lang));
    }
    if (action === "migration-revert") {
      const migration = area(directory, INTERFACE_AREAS.migration);
      revertToPreviousCopy(migration);
      return section(text3.migration, `${text3.reverted}
${describeJourney(migration, lang)}`);
    }
    throw new DomainError("unknown-action");
  }
  function documentLines(directory, lang) {
    const text3 = copy[lang];
    const drafts = new DocumentDraftStore(directory);
    const saved = drafts.readDocument();
    if (saved?.rows[0]?.note !== FITTING_NOTE) throw new DomainError("document-missing");
    const pdf = readFileSync(drafts.pdfPath());
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new DomainError("document-missing");
    const refused = drafts.exportDocument(draft2(OVERFLOW_NOTE));
    const warning = refused.problems.map((problem) => problem.text).join("\n");
    if (refused.fits || !warning.includes(OVERFLOW_NOTE) || !readFileSync(drafts.pdfPath()).equals(pdf)) {
      throw new DomainError("text-trimmed");
    }
    if (drafts.readDocument()?.rows[0]?.note !== FITTING_NOTE) throw new DomainError("document-replaced");
    return `${text3.draft}: ${saved.rows[0].note}
${text3.pdf}: export.pdf
${text3.overflow}: ${warning}`;
  }
  function quotaRefusal(directory) {
    const store = new FileWorkspaceStore(directory);
    const before = readFileSync(store.primaryPath());
    const workspace = store.load();
    try {
      chooseVolunteer(workspace, VOLUNTEERS.currentEncounterId, VOLUNTEERS.tardiaId);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "capacity-exceeded") throw error;
      if (!readFileSync(store.primaryPath()).equals(before)) throw new DomainError("rejected-command-saved");
      return error.code;
    }
    throw new DomainError("capacity-exceeded");
  }
  function draft2(note) {
    return {
      title: "Acta sintetica",
      heading: "Asistencia",
      footer: "Cierre",
      page: { width: 40, height: 6 },
      rows: [{ id: "fila", label: "Persona Alfa", note }],
      blocks: []
    };
  }
  function area(directory, name) {
    const next = path_default.join(directory, name);
    mkdirSync(next, { recursive: true });
    return next;
  }
  function section(title, body) {
    return `${title}
${body}`;
  }
  function syntheticLegacySource(directory) {
    return writeLegacy(directory, "origen", LEGACY.alfa, "Persona Alfa", true);
  }
  function writeLegacy(directory, folder, personId, personName, includeGamma) {
    const members = [
      { id: personId, organizationID: LEGACY.space, name: personName, isActive: true },
      ...includeGamma ? [{ id: LEGACY.gamma, organizationID: LEGACY.space, name: "Persona Gamma", isActive: true }] : []
    ];
    const body = {
      schemaVersion: 1,
      revision: 3,
      organizations: [{ id: LEGACY.space, name: "Espacio sint\xE9tico", accentHex: "#315EAD", timeZoneIdentifier: "Etc/UTC", deletedAt: null }],
      periods: [],
      members,
      groups: [],
      memberships: [],
      components: [{ id: LEGACY.component, organizationID: LEGACY.space, name: "Componente" }],
      categories: [],
      events: [{
        id: LEGACY.encounter,
        organizationID: LEGACY.space,
        title: "Encuentro sint\xE9tico",
        startsAt: "2026-03-01T00:00:00Z",
        componentID: LEGACY.component,
        categoryID: null,
        countsAttendance: true,
        isCancelled: false,
        volunteerCapacity: null
      }],
      attendance: [{
        id: LEGACY.attendance,
        eventID: LEGACY.encounter,
        memberID: personId,
        status: "present",
        isVoided: false,
        note: "nota sint\xE9tica",
        recordedAt: "2026-03-01T00:05:00Z",
        eventDateSnapshot: "2026-03-01T00:00:00Z",
        componentIDSnapshot: LEGACY.component,
        categoryIDSnapshot: null,
        countsAttendanceSnapshot: true
      }],
      volunteers: [],
      collaborators: [],
      templates: [],
      syncStates: [],
      driveReplicas: [],
      resolvedSyncConflicts: []
    };
    const target = path_default.join(directory, folder);
    mkdirSync(target, { recursive: true });
    const file = path_default.join(target, "workspace-v1.json");
    writeFileSync(file, JSON.stringify(body));
    return file;
  }

  // src/form.ts
  var FORM_CAPACITY = 1;
  var CYCLE = ["pending", "present", "absent", "excused"];
  var words = {
    es: {
      pending: "por registrar",
      present: "presente",
      absent: "ausente",
      excused: "excusada",
      off: "fuera de la lista",
      empty: "sin encuentros evaluables",
      suggestion: "Sugerencia",
      none: "ninguna",
      overflow: "No cabe",
      quota: "Rechazo de cupo",
      interested: "interesado",
      selected: "seleccionado",
      declined: "declinado",
      completed: "completado",
      noShow: "no presentado"
    },
    en: {
      pending: "pending",
      present: "present",
      absent: "absent",
      excused: "excused",
      off: "off the list",
      empty: "no countable encounters",
      suggestion: "Suggestion",
      none: "none",
      overflow: "Does not fit",
      quota: "Quota refusal",
      interested: "interested",
      selected: "selected",
      declined: "declined",
      completed: "completed",
      noShow: "no-show"
    }
  };
  function applyForm(directory, payload) {
    let request;
    try {
      request = JSON.parse(payload);
    } catch {
      return JSON.stringify(emptyScreen("invalid-form"));
    }
    const lang = request.lang === "en" ? "en" : "es";
    try {
      change(directory, request);
      const warning = request.op === "draft" ? draftWarning(directory, request.text ?? "", lang) : "";
      const screen = describeForm(directory, lang);
      screen.warning = warning;
      return JSON.stringify(screen);
    } catch (error) {
      const screen = safeDescribe(directory, lang);
      if (error instanceof DomainError && error.code === "capacity-exceeded") {
        screen.refusal = `${words[lang].quota}: ${error.code}`;
      } else {
        screen.error = error instanceof DomainError ? error.code : error instanceof Error ? error.message : String(error);
      }
      return JSON.stringify(screen);
    }
  }
  function change(directory, request) {
    const store = new FileWorkspaceStore(directory);
    const workspace = ensure(store);
    if (request.op === "open" || request.op == null) return;
    if (request.op === "add-person") {
      store.save(addPerson(workspace, { spaceId: workspace.spaces[0].id, name: request.name ?? "" }), workspace.revision);
      return;
    }
    if (request.op === "create-encounter") {
      if (workspace.encounters.length > 0) throw new DomainError("encounter-exists");
      const roster = Array.isArray(request.roster) ? request.roster.filter((id) => typeof id === "string") : [];
      store.save(
        createEncounter(workspace, {
          spaceId: workspace.spaces[0].id,
          title: request.title ?? "",
          startsAt: SYNTHETIC.encounterAt,
          componentId: workspace.components[0].id,
          personIds: roster,
          volunteerCapacity: FORM_CAPACITY
        }),
        workspace.revision
      );
      return;
    }
    if (request.op === "collaborate" || request.op === "choose-alternative" || request.op === "restore") {
      collaborate(directory, request);
      return;
    }
    if (request.op === "migrate") {
      migrateLegacyFile(directory, syntheticLegacySource(directory));
      return;
    }
    if (request.op === "revert") {
      revertToPreviousCopy(directory);
      return;
    }
    const encounter = workspace.encounters[0];
    if (!encounter) throw new DomainError("missing-encounter");
    if (request.op === "cycle") {
      const row = workspace.attendance.find((item) => item.encounterId === encounter.id && item.personId === request.personId && !item.voided);
      if (!row) throw new DomainError("not-on-roster");
      const next = CYCLE[(CYCLE.indexOf(row.status) + 1) % CYCLE.length];
      store.save(
        setAttendance(workspace, {
          encounterId: encounter.id,
          personId: row.personId,
          status: next,
          recordedAt: systemClock().now()
        }),
        workspace.revision
      );
      return;
    }
    if (request.op === "interest") {
      if (workspace.volunteers.some((item) => item.encounterId === encounter.id && item.personId === request.personId)) return;
      store.save(
        registerVolunteer(workspace, {
          encounterId: encounter.id,
          personId: request.personId ?? "",
          registeredAt: systemClock().now()
        }),
        workspace.revision
      );
      return;
    }
    if (request.op === "choose") {
      store.save(chooseVolunteer(workspace, encounter.id, request.personId ?? ""), workspace.revision);
      return;
    }
    if (request.op === "draft") return;
    throw new DomainError("unknown-form");
  }
  function collaborationDir(directory) {
    return path_default.join(directory, "colaboracion");
  }
  function collaborate(directory, request) {
    const folder = collaborationDir(directory);
    const store = new FileWorkspaceStore(folder);
    if (request.op === "collaborate") {
      if (!existsSync(store.primaryPath())) runCollaborationJourney(folder);
      return;
    }
    if (request.op === "choose-alternative") {
      resolvePausedAlternative(folder, request.versionId ?? "");
      return;
    }
    const before = store.load().collaboration[0]?.pendingUploads.length ?? 0;
    const restored = store.restore(path_default.join(folder, "synthetic-copy.json"));
    const link = restored.collaboration[0];
    if (!link?.paused || link.pendingUploads.length !== before) throw new DomainError("upload-enqueued");
  }
  function ensure(store) {
    if (existsSync(store.primaryPath())) return store.load();
    let workspace = createSpace(store.initialize(emptyWorkspace()), {
      name: SYNTHETIC.spaceName,
      timeZone: SYNTHETIC.timeZone
    });
    const spaceId = workspace.spaces[0].id;
    workspace = addPeriod(workspace, {
      spaceId,
      name: SYNTHETIC.periodName,
      startsAt: SYNTHETIC.periodStart,
      endsAt: SYNTHETIC.periodEnd
    });
    workspace = addComponent(workspace, { spaceId, name: "Componente sint\xE9tico" });
    return store.save(workspace, 0);
  }
  function describeForm(directory, lang) {
    const workspace = new FileWorkspaceStore(directory).load();
    const text3 = words[lang];
    const encounter = workspace.encounters[0];
    const listed = new Set(
      encounter ? workspace.attendance.filter((row) => row.encounterId === encounter.id && !row.voided).map((row) => row.personId) : []
    );
    const periodId = workspace.periods[0]?.id;
    const suggestions = encounter && periodId ? suggestVolunteers(workspace, encounter.id, periodId) : [];
    const names = new Map(workspace.people.map((person) => [person.id, person.name]));
    const people = workspace.people.map((person) => {
      const row = encounter ? workspace.attendance.find((item) => item.encounterId === encounter.id && item.personId === person.id && !item.voided) : void 0;
      const rate = attendanceRate(workspace, person.id, workspace.periods[0]?.id);
      const score = rate.ratio == null ? text3.empty : `${rate.present}/${rate.counted}`;
      const mark = row ? text3[row.status] : text3.off;
      const entry = workspace.volunteers.find((item) => item.personId === person.id && item.encounterId === encounter?.id);
      return {
        id: person.id,
        name: person.name,
        listed: listed.has(person.id),
        line: `${person.name}: ${mark}; ${score}`,
        volunteer: entry ? text3[entry.status] : ""
      };
    });
    const suggestionNames = suggestions.map((item) => names.get(item.personId) ?? item.personId);
    const saved = new DocumentDraftStore(directory).readDocument();
    const collaboration = collaborationView(directory, lang);
    const space = workspace.spaces[0];
    const component = workspace.components.find((item) => item.id === encounter?.componentId) ?? workspace.components[0];
    return {
      people,
      encounterTitle: encounter?.title ?? "",
      suggestion: `${text3.suggestion}: ${suggestionNames.length > 0 ? suggestionNames.join(", ") : text3.none}`,
      draft: saved?.rows[0]?.note ?? "",
      warning: "",
      error: "",
      refusal: quotaLine(workspace, lang),
      collaboration: collaboration.text,
      alternatives: collaboration.alternatives,
      spaceName: space?.name ?? "",
      periodName: workspace.periods[0]?.name ?? "",
      timeZone: space?.timeZone ?? "Etc/UTC",
      startsAt: encounter?.startsAt ?? "",
      componentName: component?.name ?? "",
      registered: listed.size
    };
  }
  function quotaLine(workspace, lang) {
    const encounter = workspace.encounters[0];
    const interested = workspace.volunteers.find((item) => item.encounterId === encounter?.id && item.status === "interested");
    if (!encounter || !interested) return "";
    try {
      chooseVolunteer(workspace, encounter.id, interested.personId);
    } catch (error) {
      if (error instanceof DomainError && error.code === "capacity-exceeded") return `${words[lang].quota}: ${error.code}`;
    }
    return "";
  }
  function collaborationView(directory, lang) {
    const folder = collaborationDir(directory);
    const store = new FileWorkspaceStore(folder);
    if (!existsSync(store.primaryPath())) return { text: "", alternatives: [] };
    const alternatives = store.load().collaboration.flatMap(
      (link) => link.entries.flatMap((entry) => entry.versions.map((version) => ({ id: version.id, value: version.value })))
    );
    return { text: describeCollaboration(folder, lang), alternatives };
  }
  function draftWarning(directory, note, lang) {
    const drafts = new DocumentDraftStore(directory);
    const draft3 = {
      title: "Acta sintetica",
      heading: "Asistencia",
      footer: "Cierre",
      page: { width: 40, height: 6 },
      rows: [{ id: "fila", label: "Nota", note }],
      blocks: []
    };
    const result = drafts.exportDocument(draft3);
    if (result.fits && result.draft) {
      drafts.saveDocument(result.draft);
      return "";
    }
    const full = result.problems.map((problem) => problem.text).join("\n");
    return `${words[lang].overflow}: ${full}`;
  }
  function safeDescribe(directory, lang) {
    try {
      if (!existsSync(new FileWorkspaceStore(directory).primaryPath())) return emptyScreen("");
      return describeForm(directory, lang);
    } catch {
      return emptyScreen("");
    }
  }
  function emptyScreen(error) {
    return {
      people: [],
      encounterTitle: "",
      suggestion: "",
      draft: "",
      warning: "",
      error,
      refusal: "",
      collaboration: "",
      alternatives: [],
      spaceName: "",
      periodName: "",
      timeZone: "Etc/UTC",
      startsAt: "",
      componentName: "",
      registered: 0
    };
  }

  // src/embedded-entry.ts
  var host = globalThis;
  host.nexoPress = (action, lang) => {
    try {
      const directory = host.NEXO_DIRECTORY;
      if (!directory) return "Error: missing-directory";
      return pressInterface(directory, action, lang === "en" ? "en" : "es");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  };
  host.nexoForm = (payload) => {
    try {
      const directory = host.NEXO_DIRECTORY;
      if (!directory) return "Error: missing-directory";
      return applyForm(directory, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  };
})();
