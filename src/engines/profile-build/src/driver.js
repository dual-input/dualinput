// Runs TypeScript's own compiler, which typescript.js defines as the global `ts`, for the
// profile builder. The builder evaluates this file once after typescript.js, then calls the
// two functions it defines with JSON, and reads JSON back.
var dualInputBuild = {
  // Type-checks a program held in memory, { roots, files }, with no lib of TypeScript's own,
  // since the level's declarations are the scripts' whole world. Lines and columns are from 0.
  check: function (json) {
    var project = JSON.parse(json);
    var files = project.files;
    var options = {
      noLib: true,
      // The level's declarations are TypeScript's own libraries, checked when generated, so
      // each build checks only the scripts.
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      types: [],
      newLine: ts.NewLineKind.LineFeed,
    };
    var host = {
      getSourceFile: function (name, lang) {
        return files[name] !== undefined ? ts.createSourceFile(name, files[name], lang) : undefined;
      },
      getDefaultLibFileName: function () { return "/lib.d.ts"; },
      writeFile: function () {},
      getCurrentDirectory: function () { return "/"; },
      getDirectories: function () { return []; },
      fileExists: function (name) { return files[name] !== undefined; },
      readFile: function (name) { return files[name]; },
      getCanonicalFileName: function (name) { return name; },
      useCaseSensitiveFileNames: function () { return true; },
      getNewLine: function () { return "\n"; },
    };
    var program = ts.createProgram(project.roots, options, host);
    var found = ts.getPreEmitDiagnostics(program).map(function (d) {
      var at = d.file ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
      return {
        file: d.file ? d.file.fileName : "",
        line: at.line,
        column: at.character,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      };
    });
    return JSON.stringify(found);
  },

  // Compiles every script to JavaScript at ES2020, in one call, since each call parses
  // TypeScript afresh: 300 calls took 1.2s on our development machine, where the type check took
  // 0.64s (record/areas/profiles/log.md, 2026-10-24). Each script is wrapped in parentheses as a
  // constant's value at the top level, which the output keeps, so the output splits back into
  // the scripts at each constant, found at the start of a line, whatever TypeScript prints first.
  compile: function (json) {
    var scripts = JSON.parse(json);
    var name = function (i) { return "const __dualInputScript" + i + " = ("; };
    var source = scripts.map(function (script, i) {
      return name(i) + "\n" + script + "\n);\n";
    }).join("");
    var options = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      newLine: ts.NewLineKind.LineFeed,
    };
    var out = "\n" + ts.transpileModule(source, { compilerOptions: options }).outputText;
    var starts = scripts.map(function (_, i) { return out.indexOf("\n" + name(i)); });
    return JSON.stringify(scripts.map(function (_, i) {
      if (starts[i] < 0) return null;
      var end = i + 1 < scripts.length ? starts[i + 1] : out.length;
      return out.slice(starts[i] + 1, end);
    }));
  },
};
