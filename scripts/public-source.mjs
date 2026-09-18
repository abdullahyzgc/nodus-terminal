import { constants, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const signatures = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{32,}/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ['google-oauth-secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['personal-home-path', /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/)[^\s'"`<>]+/g],
  ['credential-url', /https?:\/\/[^\s'"`/@:]+:[^\s'"`/@]+@(?!example\.(?:com|org|net)\b)[^\s'"`/]+/g],
]

export function scanText(text) {
  const findings = []
  for (const [rule, pattern] of signatures) {
    for (const match of text.matchAll(pattern)) findings.push({ rule, line: text.slice(0, match.index).split('\n').length })
  }
  return findings
}

export function forbiddenPath(path) {
  return path.split('/').some((part) => /^(?:\.env.*|\.git|\.ssh|\.aws|\.azure|\.config|\.codex|\.idea|\.vscode|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.test-data|\.public-export|node_modules|dist|dist-electron|release|coverage|playwright-report|test-results)$/i.test(part))
    || /(?:\.nodus(?:[.-].*)?|\.(?:pem|key|ppk|p12|pfx|log|bak|tmp|dmp|exe|dmg|zip|7z|blockmap))$/i.test(path)
    || /(?:^|\/)(?:device-key\.bin.*|google-drive\.bin.*|id_(?:rsa|ed25519|ecdsa|dsa).*|known_hosts.*|authorized_keys.*|(?:client_secret|credentials|token|oauth|service-account).*\.json)$/i.test(path)
}

function checkedPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /[\\:\x00-\x1f]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..') || forbiddenPath(path)) throw new Error('Yasak veya geçersiz manifest yolu.')
  let target = root
  for (const part of path.split('/')) {
    target = join(target, part)
    if (lstatSync(target).isSymbolicLink()) throw new Error('Sembolik bağlantı paylaşılmaz: ' + path)
  }
  const actual = relative(realpathSync.native(root), realpathSync.native(target))
  if (actual.startsWith('..') || isAbsolute(actual) || !lstatSync(target).isFile()) throw new Error('Kaynak klasörü dışına çıkılamaz: ' + path)
  return target
}

export function collectSource(root = projectRoot) {
  const manifestPath = checkedPath(root, 'public-files.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(manifest.files) || !manifest.files.includes('public-files.json') || new Set(manifest.files).size !== manifest.files.length) throw new Error('Geçersiz public-files.json.')
  const files = manifest.files.map((path) => {
    const target = checkedPath(root, path)
    if (lstatSync(target).size > 2 * 1024 * 1024) throw new Error('Büyük dosyayı elle inceleyin: ' + path)
    const content = readFileSync(target)
    const findings = scanText(content.toString('utf8'))
    if (!/\.(?:png|ico)$/.test(path) && content.includes(0)) throw new Error('Beklenmeyen ikili dosya: ' + path)
    if (findings.length) throw new Error(findings.map(({ rule, line }) => path + ':' + line + ' [' + rule + ']').join('\n'))
    return { path, content }
  })
  const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', windowsHide: true })
  if (gitRoot.error || (gitRoot.status !== 0 && gitRoot.status !== 128)) throw new Error('Git denetimi çalıştırılamadı.')
  if (gitRoot.status === 128 && !gitRoot.stderr.includes('not a git repository')) throw new Error('Git deposu denetlenemedi.')
  if (gitRoot.status === 0) {
    if (realpathSync.native(gitRoot.stdout.trim()) !== realpathSync.native(root)) throw new Error('Denetimi bağımsız kaynak deposunun kökünde çalıştırın.')
    const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true })
    if (listing.status !== 0) throw new Error('Git dosya listesi okunamadı.')
    const extra = listing.stdout.split('\0').filter((path) => path && !manifest.files.includes(path))
    if (extra.length) throw new Error('Git paylaşım listesinde manifest dışı dosyalar var:\n' + extra.join('\n'))
    const staged = spawnSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true })
    if (staged.status !== 0) throw new Error('Git hazırlama alanı okunamadı.')
    for (const entry of staged.stdout.split('\0').filter(Boolean)) {
      const match = /^(\d+) ([a-f0-9]+) (\d)\t(.+)$/.exec(entry)
      if (!match || match[3] !== '0' || !['100644', '100755'].includes(match[1])) throw new Error('Git hazırlama alanında normal dosya olmayan veya çakışmalı kayıt var.')
      const [, , objectId, , path] = match
      const blob = spawnSync('git', ['cat-file', 'blob', objectId], { cwd: root, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      if (blob.status !== 0 || blob.error) throw new Error('Git dosyası okunamadı veya çok büyük: ' + path)
      const findings = scanText(blob.stdout.toString('utf8'))
      if (findings.length) throw new Error(findings.map(({ rule, line }) => 'Git index: ' + path + ':' + line + ' [' + rule + ']').join('\n'))
      if (!/\.(?:png|ico)$/.test(path) && blob.stdout.includes(0)) throw new Error('Git hazırlama alanında beklenmeyen ikili dosya: ' + path)
    }
  }
  return files
}

export function exportSource(root = projectRoot) {
  const files = collectSource(root)
  const outputRoot = join(root, '.public-export')
  mkdirSync(outputRoot, { recursive: true })
  if (lstatSync(outputRoot).isSymbolicLink() || dirname(realpathSync.native(outputRoot)) !== realpathSync.native(root)) throw new Error('Geçersiz çıktı dizini.')
  const destination = mkdtempSync(join(outputRoot, 'nodus-'))
  for (const { path, content } of files) {
    const target = join(destination, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL })
  }
  return destination
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((argument) => argument !== '--export')) throw new Error('Kullanım: node scripts/public-source.mjs [--export]')
    if (process.argv.includes('--export')) console.log('Kaynak kopyası: ' + exportSource())
    else console.log('PASS: ' + collectSource().length + ' seçili kaynak dosyası kontrol edildi.')
    console.log('Bu kontrol tam gizlilik garantisi değildir. Yüklemeden önce dosya listesini ve içerikleri inceleyin. Git geçmişi taranmaz.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Paylaşım kontrolü başarısız.')
    process.exitCode = 1
  }
}
