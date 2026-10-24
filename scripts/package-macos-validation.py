#!/usr/bin/env python3
"""Pure packaging validators; no installer, account, launch, or publication API."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile

BUNDLE_ID = 'org.vrr.valentina.experience'
MIN_OS = '15.0'
ARCHITECTURES = ['arm64', 'x86_64']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def initialize_paths(temp, output):
    root = Path(temp).resolve(strict=True)
    out = Path(output)
    require(root.is_dir() and root.stat().st_uid == os.getuid(), 'RUNNER_TEMP must be an owned directory')
    require(out.is_absolute() and '..' not in out.parts, 'Output must be an absolute child path')
    require(out.parent.resolve(strict=True) == root, 'Output must be a direct child of RUNNER_TEMP')
    require(re.fullmatch(r'nexo-package(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?', out.name), 'Invalid output basename')
    require(not out.exists() and not out.is_symlink(), 'Refusing existing output')
    out = root / out.name
    out.mkdir(mode=0o700)  # Exclusive: never replace a caller's directory.
    work = initialize_smoke(root)
    (work / '.owned-output').write_text(str(out) + '\n')
    return work


def initialize_smoke(temp):
    root = Path(temp).resolve(strict=True)
    require(root.is_dir() and root.stat().st_uid == os.getuid(), 'RUNNER_TEMP must be an owned directory')
    work = Path(tempfile.mkdtemp(prefix='nexo-package-work.', dir=root))
    (work / '.owned-package-work').write_text(str(root) + '\n')
    return work


def owned_work(temp, work):
    root = Path(temp).resolve(strict=True)
    path = Path(work)
    require(path.is_absolute() and not path.is_symlink(), 'Invalid scratch directory')
    require(path.resolve(strict=True) == path and path.parent == root, 'Scratch escaped RUNNER_TEMP')
    require(path.name.startswith('nexo-package-work.') and path.stat().st_uid == os.getuid(), 'Unowned scratch')
    marker = path / '.owned-package-work'
    require(marker.is_file() and not marker.is_symlink(), 'Invalid scratch ownership marker')
    require(marker.read_text() == str(root) + '\n', 'Missing scratch ownership marker')
    return path


def versions(source, commit):
    root = Path(source)
    require(re.fullmatch(r'[0-9a-f]{40}', commit), 'Invalid source commit')
    native = plistlib.loads((root / 'Native/Info.plist').read_bytes())
    ios = plistlib.loads((root / 'iOS/Info.plist').read_bytes())
    package = json.loads((root / 'Web/package.json').read_text())
    expected = {'CFBundleIdentifier': BUNDLE_ID, 'CFBundleExecutable': 'Nexo',
                'CFBundlePackageType': 'APPL', 'CFBundleIconFile': 'Nexo',
                'LSMinimumSystemVersion': MIN_OS}
    require(all(native.get(k) == v for k, v in expected.items()), 'Unexpected Native bundle contract')
    version, build = native['CFBundleShortVersionString'], native['CFBundleVersion']
    require(isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid version')
    require(isinstance(build, str) and re.fullmatch(r'[1-9]\d*', build), 'Invalid build')
    require(package['version'] == version, 'Web/Native versions disagree')
    require(ios['CFBundleShortVersionString'] == '$(MARKETING_VERSION)' and
            ios['CFBundleVersion'] == '$(CURRENT_PROJECT_VERSION)', 'Unexpected iOS version placeholders')
    yaml = (root / 'iOS/project.yml').read_text()
    pbx = (root / 'iOS/Nexo.xcodeproj/project.pbxproj').read_text()
    for key, expected_value in [('MARKETING_VERSION', version), ('CURRENT_PROJECT_VERSION', build)]:
        yaml_values = re.findall(r'^\s*' + key + r':\s*[\'\"]?([0-9.]+)[\'\"]?\s*$', yaml, re.M)
        pbx_values = re.findall(r'\b' + key + r'\s*=\s*\"?([0-9.]+)\"?\s*;', pbx)
        require(yaml_values == [expected_value], 'iOS project.yml version/build mismatch')
        require(len(pbx_values) >= 2 and set(pbx_values) == {expected_value}, 'iOS committed project version/build mismatch')
    manager = package['packageManager']
    require(re.fullmatch(r'pnpm@\d+\.\d+\.\d+', manager), 'pnpm must be exactly pinned')
    for file in ['Core/Package.swift', 'Native/Package.swift']:
        require('.macOS(.v15)' in (root / file).read_text(), 'Package macOS target mismatch')
    require((root / 'LICENSE').is_file() and (root / 'Web/public/ThirdPartyNotices.txt').is_file(), 'Missing license/notices')
    return {'sourceCommit': commit, 'version': version, 'build': build,
            'bundleIdentifier': BUNDLE_ID, 'minimumSystemVersion': MIN_OS,
            'architectures': ARCHITECTURES, 'pnpmVersion': manager.removeprefix('pnpm@')}


def binary_report(vtool, otool, loads):
    require(re.findall(r'^\s*platform\s+(\S+)', vtool, re.M) == ['MACOS'], 'Wrong binary platform')
    require(re.findall(r'^\s*minos\s+(\S+)', vtool, re.M) in [['15.0'], ['15.0.0']], 'Wrong binary minimum OS')
    dependencies = re.findall(r'^\s+(.+?)\s+\(compatibility version', otool, re.M)
    require(bool(dependencies), 'Missing dependency report')
    for value in dependencies:
        require('..' not in Path(value).parts, 'Dependency path traversal')
        require(value.startswith(('/System/Library/', '/usr/lib/')) or
                re.fullmatch(r'@rpath/libswift[A-Za-z0-9_]+\.dylib', value), 'Non-system runtime dependency: ' + value)
    rpaths = re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset', loads)
    require(all(value in ['/usr/lib/swift', '@executable_path/../Frameworks'] for value in rpaths), 'Nonportable runtime search path')
    if any(value.startswith('@rpath/') for value in dependencies):
        require('/usr/lib/swift' in rpaths, 'Swift runtime search path missing')


def tree_inventory(root, allow_application_link=False):
    root = Path(root)
    require(root.is_dir() and not root.is_symlink(), 'Inventory root must be a real directory')
    rows = []
    def walk(directory):
        for path in sorted(directory.iterdir()):
            relative = path.relative_to(root).as_posix()
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode):
                require(allow_application_link and relative == 'Applications' and os.readlink(path) == '/Applications', 'Unexpected symlink: ' + relative)
                rows.append([relative, 'symlink', '/Applications'])
            elif stat.S_ISDIR(mode):
                rows.append([relative, 'directory', stat.S_IMODE(mode)])
                walk(path)
            elif stat.S_ISREG(mode):
                rows.append([relative, 'file', path.stat().st_size, stat.S_IMODE(mode), digest(path)])
            else:
                raise ValueError('Unexpected filesystem item: ' + relative)
    walk(root)
    return rows


def web_content_inventory(root):
    # Build output stays private (umask 077); only the packaged copy has public modes.
    # Retain names, types, sizes and hashes, including tree_inventory's symlink refusal.
    rows = []
    for row in tree_inventory(root):
        if row[1] == 'directory':
            rows.append(row[:2])
        else:
            rows.append([row[0], row[1], row[2], row[4]])
    return rows


def normalize_image(root):
    root = Path(root)
    rows = tree_inventory(root, True)  # Validate every link before chmod; never follow Applications.
    require((root / 'Nexo.app/Contents/MacOS/Nexo').is_file(), 'Expected main executable is missing')
    os.chmod(root, 0o755)
    for row in rows:
        relative, kind = row[:2]
        if kind == 'symlink':
            continue
        mode = 0o755 if kind == 'directory' or relative == 'Nexo.app/Contents/MacOS/Nexo' else 0o644
        os.chmod(root / relative, mode, follow_symlinks=False)
    verify_payload_modes(root, 'Nexo.app/Contents/MacOS/Nexo', True)


def verify_payload_modes(root, executable, allow_application_link=False):
    root = Path(root)
    require(stat.S_IMODE(root.stat().st_mode) == 0o755, 'Payload root must have mode 0755')
    for row in tree_inventory(root, allow_application_link):
        relative, kind = row[:2]
        if kind == 'symlink':
            continue
        actual = row[2] if kind == 'directory' else row[3]
        expected = 0o755 if kind == 'directory' or relative == executable else 0o644
        require(actual == expected, 'Unexpected payload permissions: ' + relative)


def verify_bundle(app, source):
    app, source = Path(app), Path(source)
    files = tree_inventory(app)
    verify_payload_modes(app, 'Contents/MacOS/Nexo')
    require({p.name for p in (app / 'Contents').iterdir()} == {'Info.plist', 'MacOS', 'Resources', '_CodeSignature'}, 'Unexpected bundle contents')
    require({p.name for p in (app / 'Contents/MacOS').iterdir()} == {'Nexo'}, 'Unexpected executable contents')
    require(os.access(app / 'Contents/MacOS/Nexo', os.X_OK), 'Main executable is not executable')
    resources = app / 'Contents/Resources'
    require({p.name for p in resources.iterdir()} == {'Web', 'Nexo.icns', 'PrivacyInfo.xcprivacy', 'LICENSE', 'ThirdPartyNotices.txt'}, 'Unexpected resources (OAuth configuration is forbidden)')
    require((resources / 'Web/index.html').is_file(), 'Missing web entry point')
    require((resources / 'Nexo.icns').read_bytes()[:4] == b'icns', 'Invalid icon container')
    for packaged, original in [('Contents/Info.plist', 'Native/Info.plist'),
                               ('Contents/Resources/PrivacyInfo.xcprivacy', 'iOS/Resources/PrivacyInfo.xcprivacy'),
                               ('Contents/Resources/LICENSE', 'LICENSE'),
                               ('Contents/Resources/ThirdPartyNotices.txt', 'Web/public/ThirdPartyNotices.txt'),
                               ('Contents/Resources/Web/ThirdPartyNotices.txt', 'Web/public/ThirdPartyNotices.txt')]:
        require((app / packaged).read_bytes() == (source / original).read_bytes(), 'Resource mismatch: ' + packaged)
    require(web_content_inventory(resources / 'Web') == web_content_inventory(source / 'Web/dist'), 'Bundled web output differs from build')
    require(not any('GoogleOAuth' in row[0] or 'client_secret' in row[0] for row in files), 'OAuth configuration is forbidden')
    return files


def owned_device(info, dmg, mount):
    expected_image, expected_mount = Path(dmg).resolve(), Path(mount).resolve()
    require(isinstance(info, dict) and isinstance(info.get('images'), list), 'Invalid disk-image info')
    matches = [image for image in info['images']
               if image.get('image-path') and Path(image['image-path']).resolve() == expected_image]
    require(len(matches) <= 1, 'Ambiguous owned image attachments')
    if not matches:
        return None
    entities = matches[0].get('system-entities', [])
    require(bool(entities), 'Owned attachment has no device entries')
    devices = []
    for entity in entities:
        if entity.get('mount-point'):
            require(Path(entity['mount-point']).resolve() == expected_mount, 'Owned image mounted somewhere unexpected')
        if entity.get('dev-entry'):
            require(re.fullmatch(r'/dev/disk\d+(?:s\d+)*', entity['dev-entry']), 'Invalid device node')
            devices.append(entity['dev-entry'])
    roots = {re.match(r'/dev/disk\d+', value)[0] for value in devices}
    require(len(roots) == 1, 'Ambiguous device ownership')
    return roots.pop()


def readonly_mount(info, dmg, mount, disk):
    device = owned_device(info, dmg, mount)
    require(device is not None, 'Expected image is not attached')
    require(disk.get('ReadOnlyVolume') is True, 'Mounted filesystem is not read-only')
    require(Path(disk.get('MountPoint', '')).resolve() == Path(mount).resolve(), 'Wrong mount point')
    require(re.fullmatch(re.escape(device) + r'(?:s\d+)*', disk.get('DeviceNode', '')), 'Mounted device ownership mismatch')


def verify_mount(info, dmg, mount, disk, staged):
    readonly_mount(info, dmg, mount, disk)
    verify_payload_modes(mount, 'Nexo.app/Contents/MacOS/Nexo', True)
    require({p.name for p in Path(mount).iterdir()} == {'Nexo.app', 'Applications', 'LICENSE', 'ThirdPartyNotices.txt'}, 'Unexpected DMG root contents')
    require(tree_inventory(mount, True) == tree_inventory(staged, True), 'DMG contents differ from staged payload')


def manifest(metadata, dmg):
    require(re.fullmatch(r'[0-9a-f]{40}', metadata['sourceCommit']), 'Invalid manifest commit')
    require(re.fullmatch(r'\d+\.\d+\.\d+', metadata['version']) and re.fullmatch(r'[1-9]\d*', metadata['build']), 'Invalid manifest version/build')
    require(metadata['bundleIdentifier'] == BUNDLE_ID and metadata['minimumSystemVersion'] == MIN_OS and metadata['architectures'] == ARCHITECTURES, 'Invalid manifest product contract')
    dmg = Path(dmg)
    require(dmg.is_file() and not dmg.is_symlink(), 'DMG must be a regular file')
    expected = f"Nexo-{metadata['version']}-{metadata['build']}-universal.dmg"
    require(dmg.name == expected and dmg.stat().st_size > 0, 'Unexpected or empty DMG')
    return {'schemaVersion': 1, **{k: metadata[k] for k in ['sourceCommit', 'version', 'build', 'bundleIdentifier', 'minimumSystemVersion', 'architectures']},
            'signing': 'ad-hoc', 'notarized': False, 'dmg': dmg.name,
            'dmgSHA256': digest(dmg), 'dmgSize': dmg.stat().st_size}


def verify_output(output):
    output = Path(output)
    require(output.is_dir() and not output.is_symlink(), 'Output must be a real directory')
    for path in output.iterdir():
        require(path.is_file() and not path.is_symlink(), 'Output contains a nonregular file')
    data = json.loads((output / 'build-info.json').read_text())
    require(type(data.get('schemaVersion')) is int and data['schemaVersion'] == 1 and data.get('notarized') is False, 'Invalid manifest schema/signing claim')
    require(type(data.get('dmgSize')) is int, 'Invalid manifest image size')
    require(isinstance(data.get('dmg'), str) and Path(data['dmg']).name == data['dmg'], 'Invalid DMG basename')
    require({p.name for p in output.iterdir()} == {data['dmg'], 'build-info.json', 'SHA256SUMS'}, 'Output must contain exactly three product files')
    require(data == manifest(data, output / data['dmg']), 'Manifest fields/hash disagree with product')
    expected = ''.join(digest(output / name) + '  ' + name + '\n' for name in [data['dmg'], 'build-info.json'])
    require((output / 'SHA256SUMS').read_text() == expected, 'Product checksums disagree')
    return data


def main(args):
    command, *a = args
    if command == 'initialize-smoke':
        print(initialize_smoke(a[0]))
    elif command == 'initialize':
        print(initialize_paths(*a))
    elif command == 'metadata':
        source, commit, destination = a
        Path(destination).write_text(json.dumps(versions(source, commit), indent=2) + '\n')
    elif command == 'get':
        print(json.loads(Path(a[0]).read_text())[a[1]])
    elif command == 'binary':
        binary_report(*(Path(p).read_text() for p in a))
    elif command == 'normalize-image':
        normalize_image(a[0])
    elif command == 'bundle':
        verify_bundle(*a)
    elif command == 'device':
        print(owned_device(plistlib.loads(Path(a[0]).read_bytes()), a[1], a[2]) or '')
    elif command == 'verify-output':
        print(verify_output(a[0])['dmg'])
    elif command == 'readonly-mount':
        readonly_mount(plistlib.loads(Path(a[0]).read_bytes()), a[1], a[2], plistlib.loads(Path(a[3]).read_bytes()))
    elif command == 'mount':
        verify_mount(plistlib.loads(Path(a[0]).read_bytes()), a[1], a[2], plistlib.loads(Path(a[3]).read_bytes()), a[4])
    elif command == 'manifest':
        metadata, dmg, destination = a
        Path(destination).write_text(json.dumps(manifest(json.loads(Path(metadata).read_text()), dmg), indent=2) + '\n')
    elif command == 'publish':
        metadata, dmg, output = a
        image, destination = Path(dmg), Path(output)
        work = owned_work(Path(dmg).parent.parent, Path(dmg).parent)
        require(destination.is_dir() and not destination.is_symlink() and destination.stat().st_uid == os.getuid(), 'Output is not owned')
        require((work / '.owned-output').read_text() == str(destination.resolve()) + '\n', 'Output ownership mismatch')
        require(not list(destination.iterdir()), 'Output must still be empty')
        data = manifest(json.loads(Path(metadata).read_text()), image)
        with image.open('rb') as source, (destination / image.name).open('xb') as target:
            shutil.copyfileobj(source, target)
        require(digest(destination / image.name) == data['dmgSHA256'], 'Output DMG copy mismatch')
        with (destination / 'build-info.json').open('x') as target:
            target.write(json.dumps(data, indent=2) + '\n')
        with (destination / 'SHA256SUMS').open('x') as target:
            target.write(''.join(digest(destination / name) + '  ' + name + '\n' for name in [image.name, 'build-info.json']))
        for path in destination.iterdir():
            os.chmod(path, 0o644, follow_symlinks=False)
        verify_output(destination)
    elif command == 'run':
        seconds, executable, *arguments = a
        require(executable in ['/usr/bin/hdiutil', '/usr/bin/codesign', '/usr/sbin/diskutil'], 'Unsupported bounded tool')
        require(seconds.isdigit() and 1 <= int(seconds) <= 600, 'Invalid tool timeout')
        sys.exit(subprocess.run([executable, *arguments], timeout=int(seconds)).returncode)
    elif command == 'cleanup-work':
        work = owned_work(*a)
        require(not os.path.ismount(work / 'mount'), 'Refusing to remove a mounted work directory')
        shutil.rmtree(work)
    else:
        raise ValueError('Unsupported validation command')


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        sys.exit('Packaging validation failed: ' + str(error))
