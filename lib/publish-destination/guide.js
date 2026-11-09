// Publish Destination setup guide. One source for the AEO Playbook
// Company tab, Workspace Admin and the Site Build Flow checklist text.
//
// One workspace token (GITHUB_TOKEN in TNV's Vercel project) covers every
// company repo. Adding a new site means adding its repo to that token, not
// creating a new token.

export const PUBLISH_GUIDE = [
  {
    where: 'On GitHub',
    goal: 'Give the workspace token access to this repo',
    steps: [
      'github.com → your avatar (top-right) → Settings → Developer settings → Personal access tokens → Fine-grained tokens.',
      'First site only: Generate new token. Name it tnv-publish. Resource owner: the account that owns the site repos. Expiration: the longest allowed; write down the date. Permissions → Repository permissions: Contents = Read and write, Pull requests = Read and write. Generate, then copy the value (it starts with github_pat_; GitHub shows it only once).',
      'Every new site after that: open the existing tnv-publish token → Edit → Repository access → add this site repo → Update. The token value does not change.',
    ],
  },
  {
    where: "In TNV's Vercel project",
    goal: 'Store the token (first site only)',
    steps: [
      'vercel.com → the-night-ventures project (TNV itself, not the site) → Settings → Environment Variables.',
      'Key: GITHUB_TOKEN. Value: the github_pat_… token. Environments: Production. Save.',
      'Deployments → the latest Production deployment → ⋯ → Redeploy. The variable does nothing until that deploy finishes (1–2 minutes).',
    ],
  },
  {
    where: 'Here, in Publish Destination',
    goal: 'Point TNV at the repo',
    steps: [
      'GitHub owner: the name between github.com/ and the repo in the repo URL.',
      'GitHub repo: the repo name only.',
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
