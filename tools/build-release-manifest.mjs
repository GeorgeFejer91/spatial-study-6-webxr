import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const outputRoot = resolve(repositoryRoot, 'dist')
const manifestPath = join(outputRoot, 'release-manifest.json')
const signaturePath = join(outputRoot, 'release-manifest.sig')

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute)))
    else if (entry.isFile()) files.push(absolute)
  }
  return files
}

function publicPath(absolute) {
  return relative(outputRoot, absolute).split(sep).join('/')
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function optionalSha256(name) {
  const value = process.env[name]?.trim()
  if (!value) return null
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest.`)
  }
  return value
}

const ignored = new Set(['release-manifest.json', 'release-manifest.sig'])
const artifacts = []
for (const absolute of await filesBelow(outputRoot)) {
  const path = publicPath(absolute)
  if (ignored.has(path)) continue
  const bytes = await readFile(absolute)
  artifacts.push({
    path,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}

const signingKeyPem = process.env.STUDY6_RELEASE_SIGNING_KEY_PEM
let signingKey = null
let signingMetadata
if (signingKeyPem) {
  signingKey = createPrivateKey(signingKeyPem)
  if (signingKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('STUDY6_RELEASE_SIGNING_KEY_PEM must contain an Ed25519 private key.')
  }
  const publicDer = createPublicKey(signingKey).export({ type: 'spki', format: 'der' })
  const fingerprint = createHash('sha256').update(publicDer).digest('hex')
  signingMetadata = {
    status: 'signed',
    algorithm: 'Ed25519',
    key_id: process.env.STUDY6_RELEASE_SIGNING_KEY_ID?.trim() || `sha256:${fingerprint}`,
  }
} else {
  signingMetadata = {
    status: 'unsigned_rehearsal',
    algorithm: null,
    key_id: null,
  }
}

const bridgeSchemaPath = resolve(repositoryRoot, 'contracts', 'study6-bridge-v1.schema.json')
const brspCorePath = resolve(
  repositoryRoot,
  'src',
  'companion',
  'vendor',
  'browser-remote-sync-protocol',
  'brsp.js',
)
const manifest = {
  schema: 'spatial.study6.webxr_release.v1',
  application: 'spatial-study-6-webxr',
  release_scope: 'placeholder-acquisition-rehearsal',
  participant_data_eligible: false,
  source_revision: process.env.GITHUB_SHA ?? process.env.STUDY6_WEBXR_SOURCE_REVISION ?? 'development-worktree',
  native_ui_oracle_revision: '384935890d8ba29a2851002163352019d65768f6',
  native_bridge: {
    source_revision:
      process.env.STUDY6_NATIVE_BRIDGE_SOURCE_REVISION?.trim() || 'unqualified-worktree',
    apk_version: process.env.STUDY6_NATIVE_BRIDGE_APK_VERSION?.trim() || null,
    apk_sha256: optionalSha256('STUDY6_NATIVE_BRIDGE_APK_SHA256'),
    contract_protocol: 'study6.bridge.v1',
    contract_schema_sha256: await sha256File(bridgeSchemaPath),
  },
  remote_control: {
    protocol: 'brsp/1',
    role: 'webxr_target',
    upstream_repository: 'https://github.com/GeorgeFejer91/browser-remote-sync-protocol',
    upstream_revision: '17b5cdba9d4ac01d6d70bfccf83daf492b5e3d11',
    vendored_core_sha256: await sha256File(brspCorePath),
    transport: 'vdo_ninja_same_peer_dual_data_channel',
  },
  signing: signingMetadata,
  artifacts,
}
const canonical = `${JSON.stringify(manifest, null, 2)}\n`
await writeFile(manifestPath, canonical, 'utf8')

if (signingKey) {
  await writeFile(signaturePath, `${base64Url(sign(null, Buffer.from(canonical), signingKey))}\n`, 'utf8')
} else {
  // Never let a signature from an older local/CI artifact survive a rebuild of
  // a different manifest.
  await rm(signaturePath, { force: true })
  if (process.env.STUDY6_REQUIRE_SIGNED_RELEASE === '1') {
    throw new Error('A signed release was required but STUDY6_RELEASE_SIGNING_KEY_PEM is unavailable.')
  }
}

process.stdout.write(`Release manifest covers ${artifacts.length} files.\n`)
