#!/usr/bin/env python3
"""Synthetic validator tests only; never invokes Swift, codesign, hdiutil, or Nexo."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('packaging', HERE / 'package-macos-validation.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class PackageValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='nexo-package-validator-test.')
        self.root = Path(self.temporary.name).resolve()
        self.output = self.root / 'nexo-package'
        self.metadata = {'sourceCommit': 'a' * 40, 'version': '0.4.1', 'build': '12',
                         'bundleIdentifier': p.BUNDLE_ID, 'minimumSystemVersion': '15.0',
                         'architectures': ['arm64', 'x86_64']}

    def tearDown(self):
        self.temporary.cleanup()

    def test_new_output_and_scratch_are_owned_and_separate(self):
        work = p.initialize_paths(self.root, self.output)
        self.assertEqual(p.owned_work(self.root, work), work)
        self.assertEqual(work.parent, self.root)
        self.assertNotEqual(work, self.output)
        self.assertEqual(list(self.output.iterdir()), [])

    def test_smoke_scratch_creates_no_product_output_and_cleans_only_itself(self):
        marker=self.root/'keep';marker.write_text('untouched')
        work=p.initialize_smoke(self.root)
        self.assertEqual(p.owned_work(self.root,work),work)
        self.assertFalse((work/'.owned-output').exists())
        self.assertFalse(self.output.exists())
        p.main(['cleanup-work',str(self.root),str(work)])
        self.assertFalse(work.exists())
        self.assertEqual(marker.read_text(),'untouched')

    def test_existing_output_is_never_reused(self):
        self.output.mkdir()
        marker = self.output / 'keep'; marker.write_text('untouched')
        with self.assertRaises(ValueError): p.initialize_paths(self.root, self.output)
        self.assertEqual(marker.read_text(), 'untouched')

    def test_symlink_output_is_refused(self):
        self.output.symlink_to(self.root / 'does-not-exist')
        with self.assertRaises(ValueError): p.initialize_paths(self.root, self.output)

    def test_path_escape_and_nested_output_are_refused(self):
        nested = self.root / 'nested'; nested.mkdir()
        for value in [self.root, self.root / '../nexo-package', nested / 'nexo-package', Path('nexo-package')]:
            with self.subTest(value=value), self.assertRaises(ValueError): p.initialize_paths(self.root, value)

    def test_arbitrary_basename_is_refused(self):
        with self.assertRaises(ValueError): p.initialize_paths(self.root, self.root / 'user-data')

    def test_cleanup_rejects_foreign_or_symlinked_work(self):
        foreign = self.root / 'foreign'; foreign.mkdir()
        with self.assertRaises(ValueError): p.owned_work(self.root, foreign)
        work = p.initialize_paths(self.root, self.output)
        link = self.root / 'nexo-package-work.link'; link.symlink_to(work, target_is_directory=True)
        with self.assertRaises(ValueError): p.owned_work(self.root, link)

    def test_cleanup_marker_must_match(self):
        work = p.initialize_paths(self.root, self.output)
        (work / '.owned-package-work').write_text('/somewhere-else\n')
        with self.assertRaises(ValueError): p.owned_work(self.root, work)

    def test_clean_manifest_has_only_product_metadata_and_actual_hash(self):
        dmg = self.root / 'Nexo-0.4.1-12-universal.dmg'; dmg.write_bytes(b'synthetic-not-a-real-dmg')
        result = p.manifest(self.metadata, dmg)
        self.assertEqual(set(result), {'schemaVersion','sourceCommit','version','build','bundleIdentifier','minimumSystemVersion','architectures','signing','notarized','dmg','dmgSHA256','dmgSize'})
        self.assertEqual(result['dmgSHA256'], p.digest(dmg))
        self.assertEqual(result['dmgSize'], len(dmg.read_bytes()))
        self.assertEqual(result['signing'], 'ad-hoc')
        self.assertIs(result['notarized'], False)
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_manifest_refuses_mismatched_empty_and_symlink_images(self):
        wrong = self.root / 'wrong.dmg'; wrong.write_bytes(b'payload')
        with self.assertRaises(ValueError): p.manifest(self.metadata, wrong)
        image = self.root / 'Nexo-0.4.1-12-universal.dmg'; image.touch()
        with self.assertRaises(ValueError): p.manifest(self.metadata, image)
        image.unlink(); image.symlink_to(wrong)
        with self.assertRaises(ValueError): p.manifest(self.metadata, image)

    def test_manifest_rejects_foreign_identity_architecture_or_paths(self):
        image = self.root / 'Nexo-0.4.1-12-universal.dmg'; image.write_bytes(b'payload')
        for key, value in [('sourceCommit','bad'),('version','../other'),('build','-1'),('bundleIdentifier','different'),('architectures',['arm64']),('minimumSystemVersion','14.0')]:
            bad = dict(self.metadata); bad[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): p.manifest(bad, image)

    def test_publish_is_exact_three_files_and_checksums(self):
        work = p.initialize_paths(self.root, self.output)
        image = work / 'Nexo-0.4.1-12-universal.dmg'; image.write_bytes(b'synthetic')
        meta = work / 'source-info.json'; meta.write_text(json.dumps(self.metadata))
        p.main(['publish', str(meta), str(image), str(self.output)])
        self.assertEqual({x.name for x in self.output.iterdir()}, {image.name,'build-info.json','SHA256SUMS'})
        for line in (self.output / 'SHA256SUMS').read_text().splitlines():
            digest, name = line.split('  '); self.assertEqual(p.digest(self.output / name), digest)
        self.assertEqual(p.verify_output(self.output)['dmg'], image.name)
        with self.assertRaises(ValueError): p.main(['publish', str(meta), str(image), str(self.output)])


    def test_output_verifier_refuses_tampering_and_extras(self):
        work = p.initialize_paths(self.root, self.output)
        image = work / 'Nexo-0.4.1-12-universal.dmg'; image.write_bytes(b'synthetic')
        meta = work / 'source-info.json'; meta.write_text(json.dumps(self.metadata))
        p.main(['publish', str(meta), str(image), str(self.output)])
        (self.output / 'extra.log').write_text('not a product')
        with self.assertRaises(ValueError): p.verify_output(self.output)
        (self.output / 'extra.log').unlink()
        (self.output / image.name).write_bytes(b'tampered')
        with self.assertRaises(ValueError): p.verify_output(self.output)

    def bundle_fixture(self, name, private_source=False):
        # Synthetic full bundle shape, not a real executable/signature/icon or Mac build.
        root = self.root / name
        source, image = root / 'source', root / 'image'
        app = image / 'Nexo.app'
        originals = {'Native/Info.plist': b'plist',
                     'iOS/Resources/PrivacyInfo.xcprivacy': b'privacy',
                     'LICENSE': b'license', 'Web/public/ThirdPartyNotices.txt': b'notices',
                     'Web/dist/index.html': b'<html></html>',
                     'Web/dist/ThirdPartyNotices.txt': b'notices',
                     'Web/dist/assets/app.js': b'export {};'}
        previous_umask = os.umask(0o077)
        try:
            for name, data in originals.items():
                path = source / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            for folder in ['Contents/MacOS', 'Contents/Resources', 'Contents/_CodeSignature']:
                (app / folder).mkdir(parents=True, exist_ok=True)
            (app / 'Contents/MacOS/Nexo').write_bytes(b'synthetic executable')
            (app / 'Contents/_CodeSignature/CodeResources').write_bytes(b'synthetic signature')
            for destination, original in [('Contents/Info.plist', 'Native/Info.plist'),
                                          ('Contents/Resources/PrivacyInfo.xcprivacy', 'iOS/Resources/PrivacyInfo.xcprivacy'),
                                          ('Contents/Resources/LICENSE', 'LICENSE'),
                                          ('Contents/Resources/ThirdPartyNotices.txt', 'Web/public/ThirdPartyNotices.txt')]:
                shutil.copy2(source / original, app / destination)
            shutil.copytree(source / 'Web/dist', app / 'Contents/Resources/Web')
            (app / 'Contents/Resources/Nexo.icns').write_bytes(b'icns-synthetic')
        finally:
            os.umask(previous_umask)
        p.normalize_image(image)
        if not private_source:
            # Content-rejection controls start with equal modes even on the old validator.
            for path in [source / 'Web/dist', *(source / 'Web/dist').rglob('*')]:
                path.chmod(0o755 if path.is_dir() else 0o644)
        return app, source

    def test_bundle_accepts_private_web_source_without_changing_either_modes(self):
        app, source = self.bundle_fixture('private', private_source=True)
        source_web, packaged_web = source / 'Web/dist', app / 'Contents/Resources/Web'
        before_source = p.tree_inventory(source_web)
        before_payload = p.tree_inventory(app)
        self.assertEqual((source_web / 'assets').stat().st_mode & 0o777, 0o700)
        self.assertEqual((source_web / 'assets/app.js').stat().st_mode & 0o777, 0o600)
        self.assertEqual((packaged_web / 'assets').stat().st_mode & 0o777, 0o755)
        self.assertEqual((packaged_web / 'assets/app.js').stat().st_mode & 0o777, 0o644)
        p.verify_bundle(app, source)
        self.assertEqual(p.tree_inventory(source_web), before_source)
        self.assertEqual(p.tree_inventory(app), before_payload)
        p.verify_payload_modes(app, 'Contents/MacOS/Nexo')

    def test_bundle_web_comparison_rejects_bytes_names_extras_and_types(self):
        for change in ['bytes', 'rename', 'extra', 'missing', 'directory-to-file']:
            with self.subTest(change=change):
                app, source = self.bundle_fixture(change)
                web = app / 'Contents/Resources/Web'
                if change == 'bytes':
                    (web / 'assets/app.js').write_bytes(b'export  0;')  # Same length, different hash.
                elif change == 'rename':
                    (web / 'assets/app.js').rename(web / 'assets/other.js')
                elif change == 'extra':
                    (web / 'extra.js').write_bytes(b'extra')
                    (web / 'extra.js').chmod(0o644)
                elif change == 'missing':
                    (web / 'assets/app.js').unlink()
                else:
                    shutil.rmtree(web / 'assets')
                    (web / 'assets').write_bytes(b'not a directory')
                    (web / 'assets').chmod(0o644)
                with self.assertRaisesRegex(ValueError, 'Bundled web output differs from build'):
                    p.verify_bundle(app, source)

    def test_bundle_web_comparison_rejects_symlinks_on_either_side(self):
        for side in ['source', 'payload']:
            with self.subTest(side=side):
                app, source = self.bundle_fixture(side)
                web = source / 'Web/dist' if side == 'source' else app / 'Contents/Resources/Web'
                path = web / 'assets/app.js'
                path.unlink()
                path.symlink_to(web / 'index.html')
                with self.assertRaisesRegex(ValueError, 'Unexpected symlink'):
                    p.verify_bundle(app, source)

    def test_bundle_still_rejects_nonportable_payload_modes(self):
        for name, relative, mode in [('file', 'Contents/Resources/Web/assets/app.js', 0o600),
                                     ('directory', 'Contents/Resources/Web/assets', 0o700),
                                     ('executable', 'Contents/MacOS/Nexo', 0o644)]:
            with self.subTest(name=name):
                app, source = self.bundle_fixture(name)
                (app / relative).chmod(mode)
                with self.assertRaisesRegex(ValueError, 'Unexpected payload permissions'):
                    p.verify_bundle(app, source)

    def test_version_contract_accepts_consistent_11_and_12_and_rejects_drift(self):
        source = self.root / 'source'
        for folder in ['Native', 'Core', 'Web/public', 'iOS/Nexo.xcodeproj']:
            (source / folder).mkdir(parents=True, exist_ok=True)
        for name in ['Core/Package.swift','Native/Package.swift']:
            (source / name).write_text('platforms: [.macOS(.v15)]')
        (source / 'LICENSE').write_text('license')
        (source / 'Web/public/ThirdPartyNotices.txt').write_text('notices')
        (source / 'Web/package.json').write_text(json.dumps({'version':'0.4.1','packageManager':'pnpm@11.19.0'}))
        (source / 'iOS/Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString':'$(MARKETING_VERSION)','CFBundleVersion':'$(CURRENT_PROJECT_VERSION)'}))
        for build in ['11','12']:
            (source / 'Native/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':p.BUNDLE_ID,'CFBundleExecutable':'Nexo','CFBundlePackageType':'APPL','CFBundleIconFile':'Nexo','LSMinimumSystemVersion':'15.0','CFBundleShortVersionString':'0.4.1','CFBundleVersion':build}))
            (source / 'iOS/project.yml').write_text('MARKETING_VERSION: \'0.4.1\'\nCURRENT_PROJECT_VERSION: ' + build + '\n')
            (source / 'iOS/Nexo.xcodeproj/project.pbxproj').write_text(('MARKETING_VERSION = 0.4.1; CURRENT_PROJECT_VERSION = ' + build + ';\n') * 2)
            self.assertEqual(p.versions(source,'a'*40)['build'], build)
        (source / 'iOS/project.yml').write_text('MARKETING_VERSION: \'0.4.1\'\nCURRENT_PROJECT_VERSION: 11\n')
        with self.assertRaises(ValueError): p.versions(source,'a'*40)

    def test_malformed_attachment_report_is_not_treated_as_cleaned_up(self):
        image,mount,info=self.image_info()
        with self.assertRaises(ValueError):p.owned_device({},image,mount)

    def test_inventory_does_not_follow_unexpected_symlinks(self):
        image = self.root / 'image'; image.mkdir(); (image / 'Nexo.app').mkdir()
        (image / 'Applications').symlink_to('/Applications')
        p.tree_inventory(image, True)
        with self.assertRaises(ValueError): p.tree_inventory(image, False)
        (image / 'Nexo.app/escape').symlink_to(self.root)
        with self.assertRaises(ValueError): p.tree_inventory(image, True)

    def test_binary_reports_accept_system_only_macos15(self):
        p.binary_report('platform MACOS\nminos 15.0\n',
                        'Nexo:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n', '')
        p.binary_report('platform MACOS\nminos 15.0.0\n',
                        'Nexo:\n\t@rpath/libswiftCore.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
                        'cmd LC_RPATH\ncmdsize 32\npath /usr/lib/swift (offset 12)\n')

    def test_binary_reports_fail_closed(self):
        good = ('platform MACOS\nminos 15.0\n','Nexo:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n','')
        bad = [(good[0].replace('MACOS','IOS'),good[1],''),(good[0].replace('15.0','16.0'),good[1],''),
               (good[0],good[1].replace('/usr/lib/libSystem.B.dylib','/tmp/tool.dylib'),''),
               (good[0],good[1].replace('/usr/lib/libSystem.B.dylib','/usr/lib/../../tmp/tool.dylib'),''),
               (good[0],good[1], 'cmd LC_RPATH\ncmdsize 32\npath /Users/runner/build (offset 12)\n'),
               (good[0],good[1].replace('/usr/lib/libSystem.B.dylib','@rpath/libswiftCore.dylib'),'')]
        for data in bad:
            with self.subTest(data=data), self.assertRaises(ValueError): p.binary_report(*data)

    def test_rejected_runtime_paths_report_observed_values_without_accepting_them(self):
        paths = ['/usr/lib/swift', '@executable_path', '/Users/runner/synthetic-build',
                 '/Applications/Xcode.app/Contents/Developer/synthetic-runtime']
        loads = ''.join('cmd LC_RPATH\ncmdsize 64\npath ' + value + ' (offset 12)\n' for value in paths)
        with self.assertRaises(ValueError) as caught:
            p.binary_report('platform MACOS\nminos 15.0\n',
                            'Nexo:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\n',
                            loads)
        self.assertEqual(str(caught.exception),
                         'Nonportable runtime search path; observed LC_RPATH values: ' + repr(paths))

    def image_info(self):
        image=self.root/'image.dmg';image.write_bytes(b'owned')
        mount=self.root/'mount';mount.mkdir()
        info={'images':[{'image-path':str(image),'system-entities':[{'dev-entry':'/dev/disk42'},{'dev-entry':'/dev/disk42s1','mount-point':str(mount)}]}]}
        return image,mount,info

    def test_owned_device_ignores_other_images(self):
        image,mount,info=self.image_info()
        info['images'].insert(0,{'image-path':'/foreign/image.dmg','system-entities':[{'dev-entry':'/dev/disk9','mount-point':'/Volumes/Foreign'}]})
        self.assertEqual(p.owned_device(info,image,mount),'/dev/disk42')
        self.assertIsNone(p.owned_device({'images':info['images'][:1]},image,mount))

    def test_ambiguous_or_relocated_owned_attachments_fail_closed(self):
        image,mount,info=self.image_info()
        duplicate=copy.deepcopy(info);duplicate['images']*=2
        with self.assertRaises(ValueError):p.owned_device(duplicate,image,mount)
        relocated=copy.deepcopy(info);relocated['images'][0]['system-entities'][1]['mount-point']='/Volumes/Other'
        with self.assertRaises(ValueError):p.owned_device(relocated,image,mount)
        malformed=copy.deepcopy(info);malformed['images'][0]['system-entities'][0]['dev-entry']='all'
        with self.assertRaises(ValueError):p.owned_device(malformed,image,mount)

    def test_readonly_mount_requires_exact_payload(self):
        image,mount,info=self.image_info()
        staged=self.root/'staged';staged.mkdir()
        for root in [staged,mount]:
            (root/'Nexo.app/Contents/MacOS').mkdir(parents=True)
            (root/'Nexo.app/Contents/MacOS/Nexo').write_text('same')
            (root/'LICENSE').write_text('license');(root/'ThirdPartyNotices.txt').write_text('notices')
            (root/'Applications').symlink_to('/Applications')
            p.normalize_image(root)
        disk={'ReadOnlyVolume':True,'MountPoint':str(mount),'DeviceNode':'/dev/disk42s1'}
        p.verify_mount(info,image,mount,disk,staged)
        with self.assertRaises(ValueError):p.verify_mount(info,image,mount,{**disk,'ReadOnlyVolume':False},staged)
        (mount/'Nexo.app/Contents/MacOS/Nexo').write_text('tampered')
        with self.assertRaises(ValueError):p.verify_mount(info,image,mount,disk,staged)


    def test_distribution_modes_are_normalized_without_following_links(self):
        image=self.root/'image'; (image/'Nexo.app/Contents/MacOS').mkdir(parents=True, mode=0o700)
        binary=image/'Nexo.app/Contents/MacOS/Nexo'; binary.write_bytes(b'synthetic');binary.chmod(0o700)
        resource=image/'LICENSE';resource.write_text('license');resource.chmod(0o600)
        (image/'Applications').symlink_to('/Applications')
        p.normalize_image(image)
        p.verify_payload_modes(image,'Nexo.app/Contents/MacOS/Nexo',True)
        self.assertEqual(binary.stat().st_mode & 0o777,0o755)
        self.assertEqual(resource.stat().st_mode & 0o777,0o644)
        self.assertEqual(os.readlink(image/'Applications'),'/Applications')
        resource.chmod(0o600)
        with self.assertRaises(ValueError):p.verify_payload_modes(image,'Nexo.app/Contents/MacOS/Nexo',True)

    def test_normalization_refuses_foreign_symlink_before_any_chmod(self):
        image=self.root/'image'; (image/'Nexo.app/Contents/MacOS').mkdir(parents=True)
        (image/'Nexo.app/Contents/MacOS/Nexo').write_bytes(b'synthetic')
        foreign=self.root/'foreign';foreign.write_text('keep');foreign.chmod(0o600)
        (image/'unexpected').symlink_to(foreign)
        with self.assertRaises(ValueError):p.normalize_image(image)
        self.assertEqual(foreign.stat().st_mode & 0o777,0o600)

    def test_wrong_host_and_argument_count_do_not_create_output(self):
        for args in [[],[str(self.output)]]:
            result=subprocess.run(['bash',str(HERE/'package-macos.sh'),*args],env={'PATH':'/usr/bin:/bin','RUNNER_TEMP':str(self.root)},capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
