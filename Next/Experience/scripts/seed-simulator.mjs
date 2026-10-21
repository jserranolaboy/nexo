// Development fixture for an isolated simulator, never a physical device or Drive.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const device = process.argv[2]
if (!device || !/^[0-9a-f-]{36}$/i.test(device)) throw new Error('Pass a simulator UDID')
const env = {
  ...process.env,
  DEVELOPER_DIR: process.env.DEVELOPER_DIR || '/Applications/Xcode.app/Contents/Developer',
}
const list = JSON.parse(
  execFileSync('xcrun', ['simctl', 'list', 'devices', '--json'], { env, encoding: 'utf8' }),
)
const simulator = Object.values(list.devices)
  .flat()
  .find((d) => d.udid === device)
if (!simulator?.name.startsWith('Nexo ·'))
  throw new Error('Use a dedicated simulator named Nexo · …')
const container = execFileSync(
  'xcrun',
  ['simctl', 'get_app_container', device, 'org.nexo.ios', 'data'],
  { env, encoding: 'utf8' },
).trim()
const directory = join(container, 'Library', 'Application Support', 'Nexo')
const target = join(directory, 'workspace-v1.json')
if (existsSync(target)) {
  const previous = JSON.parse(readFileSync(target, 'utf8'))
  if (
    previous.organizations.some((o) => o.name !== 'Círculo · Pruebas') ||
    previous.driveReplicas?.length
  )
    throw new Error('Refusing to replace non-fixture data or a connected workspace')
}
const temporary = mkdtempSync(join(tmpdir(), 'nexo-fixture-'))
try {
  const source = fileURLToPath(new URL('../src/', import.meta.url))
  for (const name of ['domain', 'demo']) {
    writeFileSync(
      join(temporary, name + '.ts'),
      readFileSync(join(source, name + '.ts'), 'utf8').replace(/import \{ t as tr(?:, locale)? \} from '\.\/i18n'\n/, 'const tr = (key: string) => key\n').replaceAll(
        "from './domain'",
        "from './domain.ts'",
      ),
    )
  }
  const { makeDemo } = await import(pathToFileURL(join(temporary, 'demo.ts')))
  const snapshot = makeDemo()
  snapshot.organizations[0].name = 'Círculo · Pruebas'
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    target,
    JSON.stringify(snapshot, (_, value) =>
      typeof value === 'string' ? value.replace(/\.\d{3}Z$/, 'Z') : value,
    ),
  )
  console.log(
    `Prepared ${snapshot.members.length} synthetic people and ${snapshot.events.length} events in ${simulator.name}`,
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
