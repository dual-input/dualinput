// Runs TypeScript's own compiler, which typescript.js defines as the global `ts`, for the
// profile builder. The builder evaluates this file once after typescript.js, then calls the
// functions it defines with JSON, and reads JSON back. The language service's runtime evaluates
// it too, for the options, so TypeScript reads a script there as the build does.
var dualInputBuild = {
  // The options every check takes: no lib of TypeScript's own, since the level's declarations
  // are the scripts' whole world.
  options: function () {
    return {
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
  },

  // Type-checks a program held in memory, { roots, files }, and refuses each reserved name its
  // scripts declare. Lines and columns are from 0.
  check: function (json) {
    var project = JSON.parse(json);
    var files = project.files;
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
    var program = ts.createProgram(project.roots, dualInputBuild.options(), host);
    var found = ts.getPreEmitDiagnostics(program).map(dualInputBuild.diagnostic);
    project.roots.forEach(function (name) {
      var file = program.getSourceFile(name);
      if (file && !file.isDeclarationFile) found = found.concat(dualInputBuild.reserved(file));
    });
    return JSON.stringify(found);
  },

  // One of TypeScript's diagnostics as profile-engine's `TypeError` reads it.
  diagnostic: function (d) {
    var at = d.file ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
    return {
      file: d.file ? d.file.fileName : "",
      line: at.line,
      column: at.character,
      code: "TS" + d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    };
  },

  // The names Dual Input gives every script, each with what it is. A script may declare none of
  // them, so every `state` and `write` in a script is Dual Input's, which the profile
  // extension's grammar colors without asking the server. `value` stays free, since every write
  // function names its own parameter so (record/areas/profiles/03-the-extension.md, "Checks").
  reservedNames: {
    state: "holds the profile's entries",
    write: "hands Dual Input an action",
    L: "names an `L:` variable",
    A: "names an `A:` variable",
    B: "names an input event",
    K: "names a `K:` event",
    H: "names an `H:` event",
  },

  // An error at each declaration of a reserved name in the scripts of a program file: a
  // variable, a parameter, a function, a class, a name taken apart from an object, or a catch
  // clause's. The scripts are the values of the file's top-level constants, the only
  // declarations profile-engine's program.rs writes there with a value, so change both together.
  reserved: function (file) {
    var reserved = dualInputBuild.reservedNames;
    var found = [];
    var named = function (name) {
      if (!name || !ts.isIdentifier(name)) return;
      if (!Object.prototype.hasOwnProperty.call(reserved, name.text)) return;
      var at = file.getLineAndCharacterOfPosition(name.getStart(file));
      found.push({
        file: file.fileName,
        line: at.line,
        column: at.character,
        code: "reserved-name",
        message: "A script can't declare `" + name.text + "`, which " + reserved[name.text],
      });
    };
    var visit = function (node) {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node) ||
          ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
          ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        named(node.name);
      }
      ts.forEachChild(node, visit);
    };
    file.statements.forEach(function (statement) {
      if (!ts.isVariableStatement(statement)) return;
      statement.declarationList.declarations.forEach(function (d) {
        if (d.initializer) visit(d.initializer);
      });
    });
    return found;
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
