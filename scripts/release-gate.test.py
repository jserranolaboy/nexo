import base64
import copy
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('gate', ROOT / 'scripts/release-gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = 'a' * 40
TAG = 'v0.4.1-preview.2'
ENV = {'GITHUB_REPOSITORY': gate.REPOSITORY, 'GITHUB_EVENT_NAME': 'create', 'GITHUB_REF': 'refs/tags/' + TAG, 'GITHUB_SHA': SHA}
EVENT = {'ref_type': 'tag', 'ref': TAG}


def fixture(root):
    root.mkdir()
    name = 'Nexo-0.4.1-12-universal.dmg'
    (root / name).write_bytes(b'synthetic DMG bytes, not a valid disk image')
    info = dict(schemaVersion=1, sourceCommit=SHA, version='0.4.1', build='12', bundleIdentifier='org.vrr.valentina.experience', minimumSystemVersion='15.0', architectures=['arm64', 'x86_64'], signing='ad-hoc', notarized=False, dmg=name, dmgSHA256=gate.digest(root / name), dmgSize=(root / name).stat().st_size)
    write_info(root, info)
    return info


def write_info(root, info):
    (root / 'build-info.json').write_text(json.dumps(info))
    (root / 'SHA256SUMS').write_text(''.join(gate.digest(root / name) + '  ' + name + '\n' for name in [info['dmg'], 'build-info.json']))


class FakeAPI:
    def __init__(self, info):
        self.calls = []
        self.ref = {'object': {'type': 'commit', 'sha': SHA}}
        self.comparison = {'status': 'identical', 'merge_base_commit': {'sha': SHA}}
        self.release = dict(id=42, tag_name=TAG, target_commitish=SHA, prerelease=True, draft=False, assets=[], upload_url='https://uploads.github.com/repos/jserranolaboy/nexo/releases/42/assets{?name,label}')
        self.native = dict(CFBundleShortVersionString=info['version'], CFBundleVersion=info['build'], CFBundleIdentifier=info['bundleIdentifier'], LSMinimumSystemVersion=info['minimumSystemVersion'])
        self.web = {'version': info['version']}
        self.runs = {}
        self.jobs = {}
        for index, (workflow, names) in enumerate(gate.CHECKS.items(), 1):
            self.runs[workflow] = [dict(id=index, event='push', head_sha=SHA, head_branch=gate.BRANCH, path='.github/workflows/' + workflow, status='completed', conclusion='success', run_attempt=2)]
            self.jobs[index] = [dict(name=name, status='completed', conclusion='success') for name in names]
        self.annotated = {}

    def __call__(self, path):
        self.calls.append(path)
        suffix = path.removeprefix('repos/' + gate.REPOSITORY + '/')
        if suffix.startswith('git/ref/tags/'):
            return copy.deepcopy(self.ref)
        if suffix.startswith('git/tags/'):
            return copy.deepcopy(self.annotated[suffix.rsplit('/', 1)[1]])
        if suffix.startswith('compare/'):
            return copy.deepcopy(self.comparison)
        if suffix.startswith('releases/'):
            return copy.deepcopy(self.release)
        if suffix.startswith('actions/workflows/'):
            workflow = suffix.split('/')[2]
            return {'workflow_runs': copy.deepcopy(self.runs[workflow])}
        if suffix.startswith('actions/runs/'):
            run_id = int(suffix.split('/')[2])
            assert '/attempts/2/jobs?' in suffix, suffix
            return {'jobs': copy.deepcopy(self.jobs[run_id])}
        if suffix.startswith('contents/'):
            data = plistlib.dumps(self.native) if 'Info.plist' in suffix else json.dumps(self.web).encode()
            return {'encoding': 'base64', 'content': base64.b64encode(data).decode()}
        raise AssertionError(path)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.directory = self.root / 'nexo-release-artifact'
        self.info = fixture(self.directory)
        self.api = FakeAPI(self.info)

    def tearDown(self):
        self.temp.cleanup()

    def test_current_valid_context(self):
        self.assertEqual(gate.context(ENV, EVENT), (TAG, SHA, '0.4.1'))

    def test_context_rejects_nonrelease_events_and_wrong_repo(self):
        for key, value in [('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_EVENT_NAME', 'push'), ('GITHUB_REPOSITORY', 'fork/nexo'), ('GITHUB_SHA', 'main'), ('GITHUB_REF', 'refs/heads/main')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                gate.context({**ENV, key: value}, EVENT)
        with self.assertRaises(ValueError):
            gate.context(ENV, {**EVENT, 'ref_type': 'branch'})

    def test_context_rejects_stable_and_unsafe_tags(self):
        for tag in ['v0.4.1', 'v0.4.1-preview.0', 'v00.4.1-preview.2', 'v0.4.1-preview.2/other', 'v0.4.1-preview.2\n', 'v0.4.1-preview.2;echo nope']:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                gate.context({**ENV, 'GITHUB_REF': 'refs/tags/' + tag}, {**EVENT, 'ref': tag})

    def test_product_manifest_and_files_match(self):
        info, files = gate.artifact(self.directory, SHA, '0.4.1')
        self.assertEqual(info, self.info)
        self.assertEqual(len(files), 3)

    def test_product_manifest_rejects_other_commit_version_and_private_fields(self):
        for changes in [{'sourceCommit': 'b' * 40}, {'version': '0.4.2'}, {'build': '../12'}, {'privatePath': '/home/synthetic'}, {'schemaVersion': True}, {'notarized': True}, {'architectures': ['arm64']}, {'minimumSystemVersion': '14.0'}, {'dmgSize': True}]:
            with self.subTest(changes=changes):
                write_info(self.directory, {**self.info, **changes})
                with self.assertRaises(ValueError):
                    gate.artifact(self.directory, SHA, '0.4.1')

    def test_rejects_extra_missing_or_symlink_payload(self):
        extra = self.directory / 'private.log'
        extra.write_text('synthetic only')
        with self.assertRaises(ValueError):
            gate.artifact(self.directory, SHA, '0.4.1')
        extra.unlink()
        target = self.directory / self.info['dmg']
        bytes_ = target.read_bytes()
        target.unlink()
        with self.assertRaises(ValueError):
            gate.artifact(self.directory, SHA, '0.4.1')
        source = self.root / 'outside.dmg'
        source.write_bytes(bytes_)
        target.symlink_to(source)
        with self.assertRaises(ValueError):
            gate.artifact(self.directory, SHA, '0.4.1')

    def test_rejects_digest_and_size_mismatch(self):
        for changes in [{'dmgSHA256': 'f' * 64}, {'dmgSize': self.info['dmgSize'] + 1}]:
            write_info(self.directory, {**self.info, **changes})
            with self.assertRaises(ValueError):
                gate.artifact(self.directory, SHA, '0.4.1')

    def test_checksum_manifest_rejects_paths_duplicates_missing_and_tampering(self):
        sums = self.directory / 'SHA256SUMS'
        good = sums.read_text()
        for value in [good + good, good.replace('build-info.json', '../build-info.json'), good.splitlines()[0], good.replace(gate.digest(self.directory / 'build-info.json'), 'f' * 64)]:
            sums.write_text(value)
            with self.assertRaises(ValueError):
                gate.artifact(self.directory, SHA, '0.4.1')

    def test_successful_preflight_uses_latest_attempt(self):
        self.assertEqual(gate.preflight(self.api, TAG, SHA, self.info), 42)
        self.assertEqual(sum('/attempts/2/jobs?' in path for path in self.api.calls), 3)

    def test_annotated_tag_dereferences_exact_commit(self):
        self.api.ref['object'] = {'type': 'tag', 'sha': 'b' * 40}
        self.api.annotated['b' * 40] = {'object': {'type': 'commit', 'sha': SHA}}
        self.assertEqual(gate.preflight(self.api, TAG, SHA, self.info), 42)

    def test_tag_mismatch_cycle_and_nonancestor_refuse(self):
        self.api.ref['object']['sha'] = 'b' * 40
        with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)
        self.api.ref['object'] = {'type': 'tag', 'sha': 'b' * 40}
        self.api.annotated['b' * 40] = self.api.ref
        with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)
        self.api.ref['object'] = {'type': 'commit', 'sha': SHA}
        self.api.comparison['status'] = 'diverged'
        with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)

    def test_draft_stable_target_and_any_existing_asset_refuse(self):
        for changes in [{'draft': True}, {'prerelease': False}, {'target_commitish': gate.BRANCH}, {'tag_name': 'v0.4.0-preview.1'}, {'assets': [{'name': 'unrelated.txt'}]}]:
            old = self.api.release.copy()
            self.api.release.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                gate.preflight(self.api, TAG, SHA, self.info)
            self.api.release = old

    def test_old_success_cannot_mask_latest_failed_or_running_run(self):
        for status, conclusion in [('completed', 'failure'), ('in_progress', None)]:
            self.api.runs['web-ci.yml'].append({**self.api.runs['web-ci.yml'][0], 'id': 900, 'status': status, 'conclusion': conclusion})
            with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)
            self.api.runs['web-ci.yml'].pop()

    def test_wrong_event_branch_sha_and_skipped_job_refuse(self):
        for changes in [{'event': 'pull_request'}, {'head_branch': 'validation/other'}, {'head_sha': 'b' * 40}]:
            old = self.api.runs['web-ci.yml'][0].copy()
            self.api.runs['web-ci.yml'][0].update(changes)
            with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)
            self.api.runs['web-ci.yml'][0] = old
        self.api.jobs[2][0]['conclusion'] = 'skipped'
        with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)

    def test_source_version_or_bundle_metadata_mismatch_refuse(self):
        for key, value in [('CFBundleVersion', '13'), ('CFBundleIdentifier', 'org.other'), ('LSMinimumSystemVersion', '14.0')]:
            old = self.api.native[key]
            self.api.native[key] = value
            with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)
            self.api.native[key] = old
        self.api.web['version'] = '0.4.2'
        with self.assertRaises(ValueError): gate.preflight(self.api, TAG, SHA, self.info)

    def test_pagination_collects_all_pages_and_refuses_unbounded(self):
        first = list(range(100))
        def paged(path): return {'rows': first if path.endswith('&page=1') else [100]}
        self.assertEqual(len(gate.pages(paged, 'test', 'rows')), 101)
        with self.assertRaises(ValueError): gate.pages(lambda _: {'rows': first}, 'test', 'rows')

    def run_main(self, api=None, upload=None):
        event_file = self.root / 'event.json'
        event_file.write_text(json.dumps(EVENT))
        env = {**ENV, 'GITHUB_EVENT_PATH': str(event_file), 'RUNNER_TEMP': str(self.root)}
        with patch.dict(os.environ, env, clear=True), patch.object(gate, 'api', api or self.api), patch.object(gate.subprocess, 'run', side_effect=upload) as run:
            gate.main()
            return run

    def record_upload(self, args):
        self.assertEqual(args[:6], ['gh', 'api', '--hostname', 'github.com', '--method', 'POST'])
        path = Path(args[args.index('--input') + 1])
        self.assertEqual(args[6], 'https://uploads.github.com/repos/jserranolaboy/nexo/releases/42/assets?name=' + path.name)
        self.assertIn('Content-Length: ' + str(path.stat().st_size), args)
        self.assertNotIn('--clobber', args)
        self.assertEqual(sum('/contents/Native/Info.plist?' in call for call in self.api.calls), 2)
        result = dict(name=path.name, size=path.stat().st_size, digest='sha256:' + gate.digest(path), state='uploaded')
        self.api.release['assets'].append(result)
        return result

    def test_main_uploads_only_after_gates_no_clobber_and_checks_returned_digests(self):
        def upload(args, **kwargs):
            result = self.record_upload(args)
            self.assertTrue(kwargs['capture_output'])
            self.assertTrue(kwargs['check'])
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(result))
        self.assertEqual(self.run_main(upload=upload).call_count, 3)

    def test_missing_release_is_not_created_or_uploaded(self):
        def missing(path):
            if '/releases/tags/' in path: raise RuntimeError('synthetic404')
            return self.api(path)
        with patch.object(gate.subprocess, 'run') as run:
            with self.assertRaises(RuntimeError): self.run_main(api=missing)
            run.assert_not_called()

    def test_changed_release_between_preflights_stops_upload(self):
        reads = 0
        def changing(path):
            nonlocal reads
            if '/releases/tags/' in path:
                reads += 1
                if reads == 2: self.api.release['assets'] = [{'name': 'partial.dmg'}]
            return self.api(path)
        with self.assertRaises(ValueError): self.run_main(api=changing)

    def test_partial_upload_does_not_retry_or_overwrite(self):
        calls = []
        def partial(args, **kwargs):
            calls.append(args)
            self.api.release['assets'] = [{'name': self.info['dmg']}]
            raise subprocess.CalledProcessError(1, args)
        with self.assertRaises(subprocess.CalledProcessError): self.run_main(upload=partial)
        self.assertEqual(len(calls), 1)
        with self.assertRaises(ValueError): self.run_main(upload=partial)
        self.assertEqual(len(calls), 1)

    def test_postupload_wrong_checksum_fails(self):
        def upload(args, **kwargs):
            result = self.record_upload(args)
            response = result.copy()
            if len(self.api.release['assets']) == 3:
                self.api.release['assets'][0]['digest'] = 'sha256:' + 'f' * 64
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(response))
        with self.assertRaises(ValueError): self.run_main(upload=upload)

    def test_postupload_moved_tag_refuses_success(self):
        def upload(args, **kwargs):
            result = self.record_upload(args)
            if len(self.api.release['assets']) == 3:
                self.api.ref['object']['sha'] = 'b' * 40
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'Tag does not resolve'):
            self.run_main(upload=upload)
        self.assertEqual(len(self.api.release['assets']), 3)

    def test_postupload_changed_target_refuses_success(self):
        def upload(args, **kwargs):
            result = self.record_upload(args)
            if len(self.api.release['assets']) == 3:
                self.api.release['target_commitish'] = 'b' * 40
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'Release target differs'):
            self.run_main(upload=upload)
        self.assertEqual(len(self.api.release['assets']), 3)

    def test_postupload_changed_release_id_refuses_success(self):
        def upload(args, **kwargs):
            result = self.record_upload(args)
            if len(self.api.release['assets']) == 3:
                self.api.release['id'] = 43
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'Release identity changed'):
            self.run_main(upload=upload)
        self.assertEqual(len(self.api.release['assets']), 3)

    def test_tag_lookup_replaced_but_original_release_still_exists_refuses(self):
        def api(path):
            response = self.api(path)
            if '/releases/tags/' in path and len(self.api.release['assets']) == 3:
                response['id'] = 43
            return response
        def upload(args, **kwargs):
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(self.record_upload(args)))
        with self.assertRaisesRegex(ValueError, 'Release identity changed'):
            self.run_main(api=api, upload=upload)

    def test_replacement_after_first_upload_stops_before_second_write(self):
        writes = []
        def upload(args, **kwargs):
            writes.append(args)
            result = self.record_upload(args)
            self.api.release['id'] = 43
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'Release identity changed'):
            self.run_main(upload=upload)
        self.assertEqual(len(writes), 1)
        self.assertIn('/releases/42/assets?', writes[0][6])

    def test_upload_response_wrong_digest_stops_without_retry(self):
        writes = []
        def upload(args, **kwargs):
            writes.append(args)
            result = self.record_upload(args)
            result['digest'] = 'sha256:' + 'f' * 64
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(result))
        with self.assertRaisesRegex(ValueError, 'Upload response does not match'):
            self.run_main(upload=upload)
        self.assertEqual(len(writes), 1)

    def test_unexpected_upload_host_or_release_endpoint_refuses_before_write(self):
        for value in ['https://example.invalid/upload', 'https://uploads.github.com/repos/jserranolaboy/nexo/releases/43/assets{?name,label}']:
            self.api.release['upload_url'] = value
            with self.assertRaisesRegex(ValueError, 'Unexpected release upload endpoint'):
                self.run_main()

    def test_upload_uses_immutable_release_id_binary_endpoint(self):
        def upload(args, **kwargs):
            self.assertEqual(args[:6], ['gh', 'api', '--hostname', 'github.com', '--method', 'POST'])
            self.assertIn('https://uploads.github.com/repos/jserranolaboy/nexo/releases/42/assets?name=Nexo-0.4.1-12-universal.dmg', args)
            self.assertIn('--input', args)
            raise RuntimeError('stop synthetic upload after endpoint assertion')
        with self.assertRaisesRegex(RuntimeError, 'stop synthetic upload'):
            self.run_main(upload=upload)

    def test_workflow_embeds_exact_reviewed_gate_and_scopes_permissions(self):
        workflow = (ROOT / '.github/workflows/macos-package.yml').read_text()
        self.assertIn("permissions:\n  contents: read\n", workflow)
        upload = workflow.split("  upload:\n", 1)[1]
        self.assertIn("permissions:\n      contents: write\n      actions: read\n", upload)
        self.assertNotIn("uses: actions/checkout", upload)
        self.assertEqual(upload.count("      - name:"), 2)
        body = upload.split("        run: |\n", 1)[1]
        body = ''.join(line.removeprefix('          ') + '\n' for line in body.splitlines())
        self.assertEqual(body, "python3 - <<'PY'\n" + (ROOT / 'scripts/release-gate.py').read_text() + 'PY\n')
        self.assertIn("digest-mismatch: error", upload)
        self.assertIn('python3 scripts/release-gate.test.py', workflow)
        self.assertIn('bash -n scripts/package-macos.sh scripts/smoke-macos-package.sh', workflow)
        self.assertLess(workflow.index('python3 scripts/package-macos-validation.test.py'), workflow.index('bash scripts/package-macos.sh'))
        self.assertLess(workflow.index('bash scripts/package-macos.sh'), workflow.index('bash scripts/smoke-macos-package.sh'))
        self.assertLess(workflow.index('bash scripts/smoke-macos-package.sh'), workflow.index('name: Retain product files only'))



if __name__ == '__main__':
    unittest.main()
