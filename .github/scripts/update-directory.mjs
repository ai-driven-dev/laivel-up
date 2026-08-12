#!/usr/bin/env node
/**
 * Met à jour directory.json à partir d'une issue d'inscription ou de désinscription.
 *
 * L'identité vient toujours de l'auteur de l'issue, jamais d'un champ du
 * formulaire. Personne ne peut donc s'inscrire ni désinscrire à la place
 * de quelqu'un d'autre.
 *
 * Usage : node .github/scripts/update-directory.mjs <inscription|desinscription>
 * Lit l'évènement GitHub dans $GITHUB_EVENT_PATH.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const FILE = 'directory.json'
const action = process.argv[2]

if (action !== 'inscription' && action !== 'desinscription') {
  console.error('Usage : update-directory.mjs <inscription|desinscription>')
  process.exit(2)
}

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const issue = event.issue
const login = issue.user.login

/** Découpe le corps d'un formulaire d'issue en { titre: valeur }. */
function parseIssueForm(body = '') {
  const fields = {}
  const blocks = body.split(/^###\s+/m).slice(1)
  for (const block of blocks) {
    const [label, ...rest] = block.split('\n')
    const value = rest.join('\n').trim()
    if (value && value !== '_No response_') fields[label.trim()] = value
  }
  return fields
}

/**
 * N'accepte qu'une URL de profil LinkedIn.
 *
 * Ce champ est rempli librement par l'inscrit et rendu en lien sur une page
 * publique. Sans ce filtre, n'importe qui pourrait faire pointer son entrée de
 * l'annuaire vers n'importe quoi, et le site le relaierait. Tout ce qui ne
 * correspond pas est jeté, silencieusement : ce n'est pas une raison de refuser
 * l'inscription.
 */
function cleanLinkedIn(value) {
  if (!value) return null
  const raw = value.trim().split(/\s/)[0]
  let url
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null
  if (!/^\/(in|company)\/[^/]+\/?$/.test(url.pathname)) return null
  return `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}`
}

const directory = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, 'utf8'))
  : { event: 'laivel-up', updated_at: null, count: 0, participants: [] }

const before = directory.participants.length
directory.participants = directory.participants.filter((p) => p.github !== login)

if (action === 'inscription') {
  const f = parseIssueForm(issue.body)
  directory.participants.push({
    github: login,
    name: f["Nom d'affichage"] ?? login,
    discord: f['Pseudo Discord'] ?? null,
    linkedin: cleanLinkedIn(f['Ton LinkedIn']),
    tools: f['Tes outils'] ?? null,
    piste: f['La piste que tu comptes explorer'] ?? null,
    registered_at: issue.created_at,
    issue: issue.number,
  })
}

directory.participants.sort((a, b) => a.registered_at.localeCompare(b.registered_at))
directory.count = directory.participants.length
directory.updated_at = new Date().toISOString()

writeFileSync(FILE, JSON.stringify(directory, null, 2) + '\n')

const verb = action === 'inscription' ? 'inscrit' : 'retiré'
console.log(`${login} ${verb}. ${before} -> ${directory.count} participants.`)

if (process.env.GITHUB_OUTPUT) {
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    `login=${login}\ncount=${directory.count}\n`,
    { flag: 'a' }
  )
}
