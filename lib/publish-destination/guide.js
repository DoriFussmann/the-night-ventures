// Publish Destination setup guide. One source for the Company Data dialog and
// the Site Build Flow checklist text.

export const PUBLISH_GUIDE = [
  {
    where: 'On GitHub',
    goal: 'Create the token',
    steps: [
      'github.com → your avatar (top-right) → Settings → Developer settings (bottom of the left menu) → Personal access tokens → Fine-grained tokens → Generate new token.',
      'Token name: the site name, for example album-amicorum-publish. Only you see it.',
      'Resource owner: the account or organization that owns the site repo. If the repo sits under an organization, pick the organization, not your username.',
      'Expiration: the longest allowed. Write down the date.',
      'Repository access: Only select repositories → pick this site repo.',
      'Permissions → Repository permissions: Contents = Read and write, Pull requests = Read and write. Leave everything else as it is.',
      'Generate token, then copy the value (it starts with github_pat_). GitHub shows it only once.',
    ],
  },
  {
    where: "In TNV's Vercel project",
    goal: 'Store the token',
    steps: [
      'vercel.com → the-night-ventures project (TNV itself, not the site) → Settings → Environment Variables.',
      'Key: GITHUB_TOKEN_ plus a label you choose, capitals and underscores only, for example GITHUB_TOKEN_ALBUM_AMICORUM.',
      'Value: paste the github_pat_… token. This is the only place the token goes.',
      'Environments: Production. Save.',
      'Deployments → the latest Production deployment → ⋯ → Redeploy. The variable does nothing until that deploy finishes (1–2 minutes).',
    ],
  },
  {
    where: 'Here, in Publish Destination',
    goal: 'Point TNV at it',
    steps: [
      'GitHub owner: the name between github.com/ and the repo in the repo URL.',
      'GitHub repo: the repo name only.',
      'GitHub token key: the label only, for example ALBUM_AMICORUM. Not GITHUB_TOKEN_, and never the github_pat_… value.',
      'Click Check Connection. When every line is green, Save.',
    ],
  },
]

/** Plain-text version for checklists and copy. */
export function publishGuideText() {
  return PUBLISH_GUIDE.map((part, index) => {
    const steps = part.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')
    return `Part ${index + 1} — ${part.where}: ${part.goal}\n${steps}`
  }).join('\n\n')
}
