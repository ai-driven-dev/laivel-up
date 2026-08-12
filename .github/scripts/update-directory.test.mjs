import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = new URL('./update-directory.mjs', import.meta.url).pathname

/** Corps tel que GitHub le rend pour le formulaire d'inscription. */
function inscriptionBody({
  nom = 'Test',
  discord = 'test',
  linkedin = null,
  outils = null,
  piste = null,
} = {}) {
  return [
    '### Édition\n\nlAIvel Up (28 au 31 août 2026)',
    `### Nom d'affichage\n\n${nom}`,
    `### Pseudo Discord\n\n${discord}`,
    `### Ton LinkedIn\n\n${linkedin ?? '_No response_'}`,
    `### Tes outils\n\n${outils ?? '_No response_'}`,
    `### La piste que tu comptes explorer\n\n${piste ?? '_No response_'}`,
    '### Licence\n\n- [X] J’accepte',
  ].join('\n\n')
}

function event({ login, number = 1, body = '', createdAt = '2026-08-05T09:00:00Z' }) {
  return { issue: { number, created_at: createdAt, user: { login }, body } }
}

/** Lance le script dans un dossier isolé et rend le directory.json produit. */
function run(dir, action, ev) {
  const evPath = join(dir, `event-${ev.issue.number}.json`)
  writeFileSync(evPath, JSON.stringify(ev))
  execFileSync('node', [SCRIPT, action], {
    cwd: dir,
    env: { ...process.env, GITHUB_EVENT_PATH: evPath, GITHUB_OUTPUT: '' },
    stdio: 'pipe',
  })
  return JSON.parse(readFileSync(join(dir, 'directory.json'), 'utf8'))
}

const fresh = () => mkdtempSync(join(tmpdir(), 'directory-'))

test('une première inscription crée le fichier et la première entrée', () => {
  const dir = fresh()
  const d = run(dir, 'inscription', event({ login: 'alice', body: inscriptionBody({ nom: 'Alice' }) }))
  assert.equal(d.count, 1)
  assert.equal(d.participants[0].github, 'alice')
  assert.equal(d.participants[0].name, 'Alice')
})

test('une seconde personne s’ajoute sans écraser la première', () => {
  const dir = fresh()
  run(dir, 'inscription', event({ login: 'alice', number: 1, body: inscriptionBody() }))
  const d = run(dir, 'inscription', event({ login: 'bob', number: 2, body: inscriptionBody() }))
  assert.equal(d.count, 2)
  assert.deepEqual(d.participants.map((p) => p.github), ['alice', 'bob'])
})

test('une réinscription remplace l’entrée au lieu de la dupliquer', () => {
  const dir = fresh()
  run(dir, 'inscription', event({ login: 'alice', number: 1, body: inscriptionBody({ discord: 'ancien' }) }))
  const d = run(dir, 'inscription', event({ login: 'alice', number: 5, body: inscriptionBody({ discord: 'nouveau' }) }))
  assert.equal(d.count, 1)
  assert.equal(d.participants[0].discord, 'nouveau')
})

test('une désinscription retire son auteur, et lui seul', () => {
  const dir = fresh()
  run(dir, 'inscription', event({ login: 'alice', number: 1, body: inscriptionBody() }))
  run(dir, 'inscription', event({ login: 'bob', number: 2, body: inscriptionBody() }))
  const d = run(dir, 'desinscription', event({ login: 'alice', number: 3, body: '### Une raison ?\n\nPas dispo' }))
  assert.equal(d.count, 1)
  assert.equal(d.participants[0].github, 'bob')
})

test('personne ne peut désinscrire quelqu’un d’autre en trichant sur le corps', () => {
  const dir = fresh()
  run(dir, 'inscription', event({ login: 'alice', number: 1, body: inscriptionBody() }))
  const d = run(dir, 'desinscription', event({
    login: 'mallory',
    number: 2,
    body: '### Une raison ?\n\nalice\n\n### Nom d’affichage\n\nalice',
  }))
  assert.equal(d.count, 1)
  assert.equal(d.participants[0].github, 'alice')
})

test('une désinscription sans inscription préalable ne casse rien', () => {
  const dir = fresh()
  const d = run(dir, 'desinscription', event({ login: 'inconnu', body: '' }))
  assert.equal(d.count, 0)
  assert.deepEqual(d.participants, [])
})

test('les champs optionnels absents deviennent null, pas la chaîne du formulaire', () => {
  const dir = fresh()
  const d = run(dir, 'inscription', event({ login: 'alice', body: inscriptionBody() }))
  assert.equal(d.participants[0].tools, null)
  assert.equal(d.participants[0].piste, null)
})

test('sans nom d’affichage, le handle GitHub sert de repli', () => {
  const dir = fresh()
  const d = run(dir, 'inscription', event({ login: 'alice', body: '### Pseudo Discord\n\nalice' }))
  assert.equal(d.participants[0].name, 'alice')
})

test('les participants restent ordonnés par date d’inscription', () => {
  const dir = fresh()
  run(dir, 'inscription', event({ login: 'tard', number: 1, createdAt: '2026-08-10T09:00:00Z', body: inscriptionBody() }))
  const d = run(dir, 'inscription', event({ login: 'tot', number: 2, createdAt: '2026-08-01T09:00:00Z', body: inscriptionBody() }))
  assert.deepEqual(d.participants.map((p) => p.github), ['tot', 'tard'])
})

test('une action inconnue échoue au lieu de toucher au fichier', () => {
  const dir = fresh()
  run(dir, 'inscription', event({ login: 'alice', body: inscriptionBody() }))
  assert.throws(() => run(dir, 'nimporte-quoi', event({ login: 'bob', number: 2 })))
  const d = JSON.parse(readFileSync(join(dir, 'directory.json'), 'utf8'))
  assert.equal(d.count, 1)
})

test('le fichier produit est du JSON valide terminé par un retour à la ligne', () => {
  const dir = fresh()
  run(dir, 'inscription', event({ login: 'alice', body: inscriptionBody() }))
  const raw = readFileSync(join(dir, 'directory.json'), 'utf8')
  assert.ok(raw.endsWith('\n'))
  assert.doesNotThrow(() => JSON.parse(raw))
  assert.ok(existsSync(join(dir, 'directory.json')))
})

test('un LinkedIn valide est conservé et normalisé', () => {
  const dir = fresh()
  const d = run(
    dir,
    'inscription',
    event({ login: 'alice', body: inscriptionBody({ linkedin: 'linkedin.com/in/alice-renard/' }) })
  )
  assert.equal(d.participants[0].linkedin, 'https://www.linkedin.com/in/alice-renard')
})

test('un LinkedIn absent reste null', () => {
  const dir = fresh()
  const d = run(dir, 'inscription', event({ login: 'alice', body: inscriptionBody() }))
  assert.equal(d.participants[0].linkedin, null)
})

test('une URL qui n’est pas LinkedIn est refusée', () => {
  const dir = fresh()
  for (const hostile of [
    'https://evil.example.com/in/alice',
    'https://linkedin.com.evil.example/in/alice',
    'javascript:alert(1)',
    'http://www.linkedin.com/in/alice',
    'https://www.linkedin.com/feed/?redirect=evil',
  ]) {
    const d = run(
      dir,
      'inscription',
      event({ login: 'alice', body: inscriptionBody({ linkedin: hostile }) })
    )
    assert.equal(d.participants[0].linkedin, null, `accepté à tort : ${hostile}`)
  }
})
