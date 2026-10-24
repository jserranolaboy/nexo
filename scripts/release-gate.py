"""Reviewed upload-only gate; embed verbatim in the workflow, never load from an artifact."""
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess

REPOSITORY = "jserranolaboy/nexo"
BRANCH = "refactor/nexo-identity-and-reliability"
TAG = re.compile(r"v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))-preview\.([1-9][0-9]*)\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"[0-9a-f]{64}\Z")
FIELDS = {"schemaVersion", "sourceCommit", "version", "build", "bundleIdentifier", "minimumSystemVersion", "architectures", "signing", "notarized", "dmg", "dmgSHA256", "dmgSize"}
CHECKS = {
    "web-ci.yml": {"Web tests and build"},
    "native-ci.yml": {"macOS package tests and universal build", "Disposable iOS simulator tests"},
    "macos-package.yml": {"Build and verify Mac disk image"},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def context(env, event):
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY, "Wrong repository")
    require(env.get("GITHUB_EVENT_NAME") == "create" and event.get("ref_type") == "tag", "Only tag creation may publish")
    tag = event.get("ref", "")
    match = TAG.fullmatch(tag)
    require(match is not None and env.get("GITHUB_REF") == f"refs/tags/{tag}", "Not an exact preview tag")
    sha = env.get("GITHUB_SHA", "")
    require(SHA.fullmatch(sha) is not None, "Invalid source commit")
    return tag, sha, match[1]


def artifact(directory, sha, version):
    require(not directory.is_symlink() and directory.is_dir(), "Artifact directory is not a real directory")
    info_path = directory / "build-info.json"
    require(info_path.is_file() and not info_path.is_symlink() and info_path.stat().st_size <= 16384, "Missing or oversized build information")
    info = json.loads(info_path.read_text())
    require(isinstance(info, dict) and set(info) == FIELDS, "Unexpected build information fields")
    require(type(info["schemaVersion"]) is int and info["schemaVersion"] == 1, "Unsupported manifest schema")
    require(info["sourceCommit"] == sha and info["version"] == version, "Artifact source or version differs")
    require(isinstance(info["build"], str) and re.fullmatch(r"[1-9][0-9]*", info["build"]), "Invalid build number")
    require(info["bundleIdentifier"] == "org.vrr.valentina.experience" and info["minimumSystemVersion"] == "15.0", "Unexpected application identity or minimum OS")
    require(info["architectures"] == ["arm64", "x86_64"] and info["signing"] == "ad-hoc" and info["notarized"] is False, "Unexpected architecture/signing declaration")
    filename = f"Nexo-{version}-{info['build']}-universal.dmg"
    require(info["dmg"] == filename and isinstance(info["dmgSHA256"], str) and DIGEST.fullmatch(info["dmgSHA256"]), "Invalid disk-image identity")
    require(type(info["dmgSize"]) is int and 0 < info["dmgSize"] < 2_000_000_000, "Invalid disk-image size")
    names = {filename, "build-info.json", "SHA256SUMS"}
    require(set(os.listdir(directory)) == names, "Unexpected or missing release files")
    for name in names:
        require(stat.S_ISREG((directory / name).lstat().st_mode), "Release files must be regular, non-symlink files")
    dmg = directory / filename
    require(dmg.stat().st_size == info["dmgSize"] and digest(dmg) == info["dmgSHA256"], "Disk-image checksum/size mismatch")
    checksums = directory / "SHA256SUMS"
    require(checksums.stat().st_size <= 1024, "Oversized checksum manifest")
    parsed = {}
    for line in checksums.read_text().splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9._-]+)", line)
        require(match is not None and match[2] not in parsed, "Malformed or duplicate checksum record")
        parsed[match[2]] = match[1]
    require(set(parsed) == {filename, "build-info.json"}, "Checksum manifest has unexpected files")
    for name, expected in parsed.items():
        require(digest(directory / name) == expected, "Checksum manifest does not match its file")
    return info, [directory / name for name in [filename, "build-info.json", "SHA256SUMS"]]


def pages(api, path, key):
    result = []
    for page in range(1, 11):
        separator = "&" if "?" in path else "?"
        rows = api(f"{path}{separator}per_page=100&page={page}")[key]
        require(isinstance(rows, list), "Malformed paginated response")
        result.extend(rows)
        if len(rows) < 100:
            return result
    raise ValueError("Pagination limit exceeded; refusing an incomplete release gate")


def tag_source(api, tag, sha):
    prefix = f"repos/{REPOSITORY}"
    obj = api(f"{prefix}/git/ref/tags/{tag}")["object"]
    seen = set()
    for _ in range(5):
        require(obj.get("sha") not in seen, "Cyclic tag reference")
        seen.add(obj.get("sha"))
        if obj.get("type") == "commit":
            break
        require(obj.get("type") == "tag" and SHA.fullmatch(obj.get("sha", "")), "Invalid tag object")
        obj = api(f"{prefix}/git/tags/{obj['sha']}")["object"]
    require(obj.get("type") == "commit" and obj.get("sha") == sha, "Tag does not resolve to the expected source")


def release_fields(release, tag, sha, release_id=None):
    require(type(release.get("id")) is int and release["id"] > 0, "Malformed release identity")
    require(release_id is None or release["id"] == release_id, "Release identity changed")
    require(release.get("tag_name") == tag and release.get("target_commitish") == sha, "Release target differs")
    require(release.get("prerelease") is True and release.get("draft") is False, "Only an already-published prerelease may receive assets")
    expected = f"https://uploads.github.com/repos/{REPOSITORY}/releases/{release['id']}/assets{{?name,label}}"
    require(release.get("upload_url") == expected, "Unexpected release upload endpoint")


def release_identity(api, tag, sha, release_id):
    tag_source(api, tag, sha)
    prefix = f"repos/{REPOSITORY}/releases"
    actual = api(f"{prefix}/{release_id}")
    release_fields(actual, tag, sha, release_id)
    # Detect deletion/recreation or reassignment of the tag's release, even if
    # the original numeric ID remains readable. These reads are not atomic.
    release_fields(api(f"{prefix}/tags/{tag}"), tag, sha, release_id)
    return actual


def preflight(api, tag, sha, info):
    prefix = f"repos/{REPOSITORY}"
    tag_source(api, tag, sha)
    comparison = api(f"{prefix}/compare/{sha}...{BRANCH}")
    require(comparison.get("status") in {"identical", "ahead"} and comparison.get("merge_base_commit", {}).get("sha") == sha, "Source is not a published development ancestor")
    release = api(f"{prefix}/releases/tags/{tag}")  # Missing release is an error, never auto-created.
    release_fields(release, tag, sha)
    require(release.get("assets") == [], "Release already has assets")
    # GitHub excludes prereleases from its 'latest' stable release; no mutation of release metadata occurs here.
    for workflow, expected_jobs in CHECKS.items():
        runs = pages(api, f"{prefix}/actions/workflows/{workflow}/runs?event=push&head_sha={sha}", "workflow_runs")
        candidates = [run for run in runs if run.get("event") == "push" and run.get("head_sha") == sha and run.get("head_branch") == BRANCH and run.get("path") == f".github/workflows/{workflow}"]
        require(candidates, f"No matching push checks for {workflow}")
        latest = max(candidates, key=lambda run: run["id"])
        require(latest.get("status") == "completed" and latest.get("conclusion") == "success", f"Latest {workflow} run is not successful")
        attempt = latest.get("run_attempt")
        require(type(attempt) is int and attempt > 0, "Unknown workflow attempt")
        jobs = pages(api, f"{prefix}/actions/runs/{latest['id']}/attempts/{attempt}/jobs", "jobs")
        for name in expected_jobs:
            matches = [job for job in jobs if job.get("name") == name]
            require(len(matches) == 1 and matches[0].get("status") == "completed" and matches[0].get("conclusion") == "success", f"Required job is not successful: {name}")
    def source(path):
        response = api(f"{prefix}/contents/{path}?ref={sha}")
        require(response.get("encoding") == "base64", "Unexpected source encoding")
        return base64.b64decode(response["content"], validate=False)
    native = plistlib.loads(source("Native/Info.plist"))
    web = json.loads(source("Web/package.json"))
    require(native.get("CFBundleShortVersionString") == web.get("version") == info["version"], "Source version differs from artifact")
    require(native.get("CFBundleVersion") == info["build"] and native.get("CFBundleIdentifier") == info["bundleIdentifier"] and native.get("LSMinimumSystemVersion") == info["minimumSystemVersion"], "Source bundle metadata differs from artifact")
    return release["id"]


def api(path):
    result = subprocess.run(["gh", "api", "--hostname", "github.com", "--method", "GET", path], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def upload_asset(release_id, path):
    require(type(release_id) is int and release_id > 0, "Invalid immutable release ID")
    require(re.fullmatch(r"[A-Za-z0-9._-]+", path.name) is not None, "Unsafe asset filename")
    # Use the verified numeric release ID, never resolve a mutable tag again.
    endpoint = f"https://uploads.github.com/repos/{REPOSITORY}/releases/{release_id}/assets?name={path.name}"
    content_type = "application/x-apple-diskimage" if path.suffix == ".dmg" else "application/json" if path.name == "build-info.json" else "text/plain"
    result = subprocess.run([
        "gh", "api", "--hostname", "github.com", "--method", "POST", endpoint,
        "--header", "Accept: application/vnd.github+json",
        "--header", f"Content-Type: {content_type}",
        "--header", f"Content-Length: {path.stat().st_size}",
        "--input", str(path),
    ], check=True, capture_output=True, text=True)
    asset = json.loads(result.stdout)
    require(asset.get("name") == path.name and asset.get("state") == "uploaded" and asset.get("size") == path.stat().st_size and asset.get("digest") == "sha256:" + digest(path), "Upload response does not match its file")


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    tag, sha, version = context(os.environ, event)
    root = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    directory = root / "nexo-release-artifact"
    info, files = artifact(directory, sha, version)
    release_id = preflight(api, tag, sha, info)
    # Repeat the mutable tag/release/CI gate immediately before the first write.
    require(preflight(api, tag, sha, info) == release_id, "Release identity changed")
    for path in files:
        release_identity(api, tag, sha, release_id)
        upload_asset(release_id, path)
    actual = release_identity(api, tag, sha, release_id)
    assets = actual.get("assets", [])
    require(len(assets) == len(files) and {asset.get("name") for asset in assets} == {path.name for path in files}, "Uploaded asset set differs")
    for path in files:
        asset = next(item for item in assets if item["name"] == path.name)
        require(asset.get("state") == "uploaded" and asset.get("size") == path.stat().st_size and asset.get("digest") == "sha256:" + digest(path), "Uploaded asset verification failed")
    print(f"Verified three release assets and observed source identity for {tag} at {sha}.")


if __name__ == "__main__":
    main()
