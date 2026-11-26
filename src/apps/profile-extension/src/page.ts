// The page of each of the extension's webviews, the Dual Input panel's and the Sync log's, and the Content Security
// Policy it runs under. A webview's page can run whatever it loads, so the policy lets in only the view's own script, by
// a nonce drawn for each page, and only the stylesheet and fonts the extension packs, from the origin VS Code serves the
// extension's files from. It names no 'unsafe-inline' and no 'unsafe-eval', so no inline style or script runs, as VS
// Code's guide to webviews advises, and no `eval` (documented,
// https://code.visualstudio.com/api/extension-guides/webview#content-security-policy). React sets an element's style
// through the DOM, which the policy doesn't govern. It imports nothing of VS Code's, so Node's test runner tests it alone.

/** Where the page loads its files from, as the webview's `asWebviewUri` gives them, and the page's nonce. */
export type PageFiles = {
  /** The webview's `cspSource`, the origin VS Code serves the extension's files from. */
  source: string
  /** The script's nonce, fresh for each page, so no other script can carry it. */
  nonce: string
  script: string
  style: string
}

/** The policy, which shuts out everything it doesn't name. */
export function contentSecurityPolicy(source: string, nonce: string): string {
  return [`default-src 'none'`, `style-src ${source}`, `font-src ${source}`, `script-src 'nonce-${nonce}'`].join("; ")
}

/** A webview's page: the stylesheet, the root the view's script draws into, and the script, under the policy. */
export function webviewPage({ source, nonce, script, style }: PageFiles): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${attribute(contentSecurityPolicy(source, nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${attribute(style)}">
</head>
<body>
<div id="root"></div>
<script nonce="${attribute(nonce)}" src="${attribute(script)}"></script>
</body>
</html>
`
}

function attribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}
