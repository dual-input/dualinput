// p04: TypeScript's language service on a profile's program, as an editor would ask it while
// someone types inside one write function. It runs unchanged under QuickJS-ng and under Node:
// the host sets the global `ts` from typescript.js and passes a clock in milliseconds, since
// QuickJS-ng has no performance.now. Each request follows an edit, so each one sees a new
// version of the file, as typing gives it.
var p04 = {
  measure: function (json, now, runs) {
    var program = JSON.parse(json);
    var files = program.files;
    var versions = {};
    Object.keys(files).forEach(function (n) { versions[n] = 0; });
    // The builder's options (src/engines/profile-build/src/driver.js).
    var options = {
      noLib: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      types: [],
    };
    var host = {
      getScriptFileNames: function () { return program.roots; },
      getScriptVersion: function (n) { return String(versions[n]); },
      getScriptSnapshot: function (n) {
        return files[n] === undefined ? undefined : ts.ScriptSnapshot.fromString(files[n]);
      },
      getCurrentDirectory: function () { return "/"; },
      getCompilationSettings: function () { return options; },
      getDefaultLibFileName: function () { return "/lib.d.ts"; },
      fileExists: function (n) { return files[n] !== undefined; },
      readFile: function (n) { return files[n]; },
      readDirectory: function () { return []; },
      directoryExists: function () { return true; },
      getDirectories: function () { return []; },
      useCaseSensitiveFileNames: function () { return true; },
    };

    var t0 = now();
    var service = ts.createLanguageService(host, ts.createDocumentRegistry(true, "/"));
    var file = program.roots[1];
    var base = files[file];
    // The first write function with a block body, just inside its brace.
    var marker = "=> {\n";
    var at = base.indexOf(marker);
    if (at < 0) throw new Error("no write function with a block body in " + file);
    at += marker.length;
    var edit = function (insert) {
      files[file] = base.slice(0, at) + insert + base.slice(at);
      versions[file] += 1;
      return at + insert.length;
    };

    var result = {
      version: ts.version,
      file: file,
      scripts: program.scripts,
      fileLines: base.split("\n").length,
      declarationsBytes: files[program.roots[0]].length,
      completion: [],
      signature: [],
      hover: [],
      diagnostics: [],
    };
    // The first request builds the program and checks what it needs, as a server's first does.
    var pos = edit("  state.");
    var first = service.getCompletionsAtPosition(file, pos, undefined);
    result.cold = now() - t0;
    result.completionEntries = first ? first.entries.length : -1;

    for (var i = 0; i < runs; i++) {
      var t = now();
      pos = edit("  // " + i + "\n  state.");
      service.getCompletionsAtPosition(file, pos, undefined);
      result.completion.push(now() - t);

      t = now();
      pos = edit("  // " + i + "\n  write(");
      var help = service.getSignatureHelpItems(file, pos, undefined);
      result.signature.push(now() - t);
      if (i === 0) result.signatureItems = help ? help.items.length : -1;

      t = now();
      var line = "  // " + i + "\n";
      edit(line);
      var w = files[file].indexOf("write(", at + line.length);
      var info = w < 0 ? undefined : service.getQuickInfoAtPosition(file, w + 1);
      result.hover.push(now() - t);
      if (i === 0) result.hoverText = info ? ts.displayPartsToString(info.displayParts).slice(0, 200) : null;

      t = now();
      edit("  // d" + i + "\n");
      var found = service.getSyntacticDiagnostics(file).length + service.getSemanticDiagnostics(file).length;
      result.diagnostics.push(now() - t);
      if (i === 0) result.diagnosticCount = found;
    }
    return JSON.stringify(result);
  },
};
