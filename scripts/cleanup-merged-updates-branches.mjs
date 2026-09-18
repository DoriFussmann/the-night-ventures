import { Octokit } from "@octokit/rest";

const owner = String(process.env.GITHUB_OWNER || "").trim();
const repo = String(process.env.GITHUB_REPO || "").trim();
const token = String(process.env.GITHUB_TOKEN || "").trim();
const targetBranch = String(process.env.TARGET_BRANCH || "main").trim() || "main";
const dryRun = process.env.DRY_RUN !== "false";

if (!owner || !repo || !token) {
  console.error("Set GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN");
  process.exit(1);
}

const octokit = new Octokit({ auth: token });

console.log(`Repo: ${owner}/${repo}`);
console.log(`Target: ${targetBranch}`);
console.log(`Mode: ${dryRun ? "DRY_RUN (no deletes)" : "DELETE"}`);
console.log("");

const allBranches = await octokit.paginate(octokit.repos.listBranches, {
  owner,
  repo,
  per_page: 100,
});
const updates = allBranches.filter((branch) =>
  String(branch.name || "").startsWith("updates/")
);

let merged = 0;
let skippedUnmerged = 0;
let deleted = 0;
let failed = 0;
let wouldDelete = 0;

for (const { name } of updates) {
  let aheadBy;
  try {
    const cmp = await octokit.repos.compareCommits({
      owner,
      repo,
      base: targetBranch,
      head: name,
    });
    aheadBy = cmp.data.ahead_by;
  } catch (err) {
    console.log(`SKIP (compare failed): ${name} (${err.message})`);
    skippedUnmerged += 1;
    continue;
  }

  if (aheadBy !== 0) {
    console.log(`SKIP (unmerged): ${name} (+${aheadBy})`);
    skippedUnmerged += 1;
    continue;
  }

  merged += 1;

  if (dryRun) {
    console.log(`WOULD DELETE: ${name}`);
    wouldDelete += 1;
    continue;
  }

  try {
    await octokit.git.deleteRef({
      owner,
      repo,
      ref: `heads/${name}`,
    });
    console.log(`DELETED: ${name}`);
    deleted += 1;
  } catch (err) {
    console.log(`FAILED: ${name} (${err.message})`);
    failed += 1;
  }
}

console.log("");
console.log(`updates/* found: ${updates.length}`);
console.log(`merged: ${merged}`);
console.log(`skipped-unmerged: ${skippedUnmerged}`);
if (dryRun) {
  console.log(`would-delete: ${wouldDelete}`);
} else {
  console.log(`deleted: ${deleted}`);
  console.log(`failed: ${failed}`);
}
