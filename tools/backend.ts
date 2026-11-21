// Deploys the backend to Cloudflare: D1's migrations, then the Worker, so a Worker never runs
// on a database older than it reads (record/areas/build/01-the-build.md, "The backend").
// .github/workflows/backend.yml runs it whenever CI passes on main.
//
//   node tools/backend.ts deploy <commit>
//
// It deploys nothing once main has moved past <commit>, the commit checked out, since a run of
// CI that passes late, such as one run again, would otherwise put an older Worker over main's,
// on a D1 holding main's newer migrations. It reaches Cloudflare with the token in
// CLOUDFLARE_API_TOKEN, which needs D1 and Workers Scripts edit rights on the account in
// CLOUDFLARE_ACCOUNT_ID and Workers Routes on dualinput.app's zone, for the Worker's custom
// domain, api.dualinput.app.

import { CONFIG, QUIET, WRANGLER } from "./lib/backend.ts"
import { Failed, main, output, run } from "./lib/run.ts"

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== "deploy" || !/^[0-9a-f]{40}$/.test(args[1]!)) throw new Failed("usage: node tools/backend.ts deploy <commit>")
  const commit = args[1]!
  // `git ls-remote` prints "<commit>\trefs/heads/main".
  const tip = output("git", ["ls-remote", "origin", "refs/heads/main"]).split("\t")[0]
  if (tip !== commit) return console.log(`main has moved past ${commit} to ${tip}, whose own CI run deploys the backend`)
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!process.env[name]) throw new Failed(`${name} isn't set; the workflows set it from the repository's secrets`)
  }
  run(process.execPath, [WRANGLER, "d1", "migrations", "apply", "DB", "--remote", "--config", CONFIG], { env: QUIET })
  run(process.execPath, [WRANGLER, "deploy", "--config", CONFIG], { env: QUIET })
})
