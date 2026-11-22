// TypeScript's language service, for the profile language server's requests inside a script.
// profile-build's `Service` evaluates this file once after typescript.js and driver.js, then
// calls the functions it defines with JSON, and reads JSON back. Lines and columns are from 0,
// a column in UTF-16 code units, as TypeScript and the Language Server Protocol count them.

// QuickJS-ng as rquickjs builds it has no `Intl`, and TypeScript sorts completions with
// `Intl.Collator`, so completion failed with "Intl is not defined"
// (record/areas/profiles/log.md, 2026-11-22). This stand-in compares by code unit; the order
// never reaches an author, since an editor sorts completions by their sort text.
var Intl = {
  Collator: function () {
    return { compare: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; } };
  },
};

var dualInputService = (function () {
  // Each program file's text and version by its name. A version only rises, even for a file
  // that leaves the program and comes back, so TypeScript never takes a new text for one it
  // built before.
  var files = {};
  var versions = {};
  var names = [];
  var host = {
    getScriptFileNames: function () { return names; },
    getScriptVersion: function (name) { return String(versions[name] || 0); },
    getScriptSnapshot: function (name) {
      return files[name] === undefined ? undefined : ts.ScriptSnapshot.fromString(files[name]);
    },
    getCurrentDirectory: function () { return "/"; },
    getCompilationSettings: function () { return dualInputBuild.options(); },
    getDefaultLibFileName: function () { return "/lib.d.ts"; },
    fileExists: function (name) { return files[name] !== undefined; },
    readFile: function (name) { return files[name]; },
    readDirectory: function () { return []; },
    directoryExists: function () { return true; },
    getDirectories: function () { return []; },
    useCaseSensitiveFileNames: function () { return true; },
  };
  var service = ts.createLanguageService(host, ts.createDocumentRegistry(true, "/"));

  // The offset of a line and column in a file, the column held to its line.
  var offset = function (file, line, column) {
    var text = files[file];
    if (text === undefined) throw new Error("the program has no file " + file);
    var start = 0;
    for (var i = 0; i < line; i++) {
      var next = text.indexOf("\n", start);
      if (next < 0) return text.length;
      start = next + 1;
    }
    var end = text.indexOf("\n", start);
    return Math.min(start + column, end < 0 ? text.length : end);
  };
  var text = function (parts) { return parts ? ts.displayPartsToString(parts) : ""; };
  var place = function (json) {
    var at = JSON.parse(json);
    return { file: at.file, position: offset(at.file, at.line, at.column) };
  };

  return {
    // Holds a program's files, [[name, text], ...], the declarations first, in place of the
    // ones it held.
    set: function (json) {
      var given = JSON.parse(json);
      var next = {};
      names = given.map(function (f) {
        next[f[0]] = f[1];
        if (files[f[0]] !== f[1]) versions[f[0]] = (versions[f[0]] || 0) + 1;
        return f[0];
      });
      files = next;
      return "null";
    },

    completions: function (json) {
      var at = place(json);
      var info = service.getCompletionsAtPosition(at.file, at.position, {});
      return JSON.stringify((info ? info.entries : []).map(function (e) {
        return { label: e.name, kind: e.kind, sort_text: e.sortText };
      }));
    },

    // The detail and documentation of one completion, by its label, which an editor asks for
    // the completion it shows.
    completionDetails: function (json) {
      var at = place(json);
      var label = JSON.parse(json).label;
      var d = service.getCompletionEntryDetails(at.file, at.position, label, undefined, undefined,
        undefined, undefined);
      if (!d) return "null";
      return JSON.stringify({ detail: text(d.displayParts), documentation: text(d.documentation) });
    },

    quickInfo: function (json) {
      var at = place(json);
      var info = service.getQuickInfoAtPosition(at.file, at.position);
      if (!info) return "null";
      return JSON.stringify({ display: text(info.displayParts), documentation: text(info.documentation) });
    },

    signatureHelp: function (json) {
      var at = place(json);
      var help = service.getSignatureHelpItems(at.file, at.position, undefined);
      if (!help) return "null";
      return JSON.stringify({
        signatures: help.items.map(function (item) {
          var parameters = item.parameters.map(function (p) {
            return { label: text(p.displayParts), documentation: text(p.documentation) };
          });
          var label = text(item.prefixDisplayParts) +
            parameters.map(function (p) { return p.label; }).join(text(item.separatorDisplayParts)) +
            text(item.suffixDisplayParts);
          return { label: label, documentation: text(item.documentation), parameters: parameters };
        }),
        active_signature: help.selectedItemIndex,
        active_parameter: help.argumentIndex,
      });
    },
  };
})();
