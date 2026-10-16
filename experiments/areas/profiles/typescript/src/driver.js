// Type-checks and emits one in-memory project with TypeScript's own compiler,
// and returns the diagnostics and the emitted files as JSON. The host sets two
// globals first: `ts`, from typescript.js, and `PROJECT`, a JSON string of
// { roots, files, options }, where options.target names a ts.ScriptTarget.
// It runs unchanged under QuickJS-ng and under Node, so the two can be compared.
(function () {
  var project = JSON.parse(PROJECT);
  var files = project.files;
  var options = {
    noLib: true,
    strict: true,
    noEmitOnError: false,
    target: ts.ScriptTarget[project.options.target],
    module: ts.ModuleKind.ESNext,
    types: [],
    outDir: "/out",
    newLine: ts.NewLineKind.LineFeed,
  };
  var out = {};
  var host = {
    getSourceFile: function (name, lang) {
      return files[name] !== undefined ? ts.createSourceFile(name, files[name], lang) : undefined;
    },
    getDefaultLibFileName: function () { return "/lib.d.ts"; },
    writeFile: function (name, text) { out[name] = text; },
    getCurrentDirectory: function () { return "/"; },
    getDirectories: function () { return []; },
    fileExists: function (name) { return files[name] !== undefined; },
    readFile: function (name) { return files[name]; },
    getCanonicalFileName: function (name) { return name; },
    useCaseSensitiveFileNames: function () { return true; },
    getNewLine: function () { return "\n"; },
  };
  var program = ts.createProgram(project.roots, options, host);
  var diags = ts.getPreEmitDiagnostics(program).map(function (d) {
    var at = d.file ? d.file.getLineAndCharacterOfPosition(d.start) : { line: -1, character: -1 };
    return {
      file: d.file ? d.file.fileName : null,
      line: at.line + 1,
      column: at.character + 1,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    };
  });
  program.emit();
  return JSON.stringify({ version: ts.version, diags: diags, out: out });
})()
