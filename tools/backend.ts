// Deploys the backend to Cloudflare: D1's migrations, then the Worker, so a Worker never runs
// on a database older than it reads (record/areas/build/01-the-build.md, "The backend"). The
// release workflow runs it just before it publishes a release, and the backend's own workflow,
// .github/workflows/backend.yml, for a fix between releases.
//
//   node tools/backend.ts deploy
//
// It reaches Cloudflare with the token in CLOUDFLARE_API_TOKEN, which needs D1 and Workers
// Scripts edit rights on the account in CLOUDFLARE_ACCOUNT_ID and Workers Routes on
// dualinput.app's zone, for the Worker's custom domain, api.dualinput.app.

import { CONFIG, QUIET, WRANGLER } from "./lib/backend.ts"
import { Failed, main, run } from "./lib/run.ts"

main(() => {
  const args = process.argv.slice(2)
  if (args.length !== 1 || args[0] !== "deploy") throw new Failed("usage: node tools/backend.ts deploy")
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (!process.env[name]) throw new Failed(`${name} isn't set; the workflows set it from the repository's secrets`)
  }
  run(process.execPath, [WRANGLER, "d1", "migrations", "apply", "DB", "--remote", "--config", CONFIG], { env: QUIET })
  run(process.execPath, [WRANGLER, "deploy", "--config", CONFIG], { env: QUIET })
})
