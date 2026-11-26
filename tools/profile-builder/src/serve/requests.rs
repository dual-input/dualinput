//! The server's answers to the editor's requests: outside a script from profile-language, and
//! inside one from TypeScript's language service, its places mapped through the program the
//! engine writes for the profile.

use std::path::{Path, PathBuf};

use lsp_server::{ErrorCode, Request, RequestId, Response};
use lsp_types::{
    CodeActionParams, CodeLensParams, CompletionParams, DocumentFormattingParams,
    DocumentOnTypeFormattingParams, DocumentSymbolParams, ExecuteCommandParams, FoldingRangeParams,
    GotoDefinitionParams, HoverParams, NumberOrString, ReferenceParams, RenameParams,
    SignatureHelpParams, TextDocumentPositionParams, WorkspaceSymbolParams,
};
use profile_engine::{Place, ProgramPlace};
use profile_language::{
    CompletionKind, Context, Location, Pos, Symbol, SymbolKind, Unformatted, Workspace, complete,
    definition, edit_between, fix, folds, format, hover, in_script, indent_after, indent_closing,
    prepare_rename, references, rename, symbols, workspace_symbols,
};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use super::convert::{Lines, path_of, uri_of};
use super::{Server, full, locate};

/// A profiles' folder, a file's path in it, and every profile's and module's text in it, by path.
struct Folder {
    root: PathBuf,
    rel: String,
    texts: Vec<(String, String)>,
}

fn parse<T: DeserializeOwned>(params: Value) -> Result<T, String> {
    serde_json::from_value(params).map_err(|e| format!("the request's parameters didn't read: {e}"))
}

/// A JSON object without the fields that are null, which the protocol leaves out.
fn object(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(_, v)| !v.is_null())
                .collect::<Map<String, Value>>(),
        ),
        other => other,
    }
}

impl Server {
    pub(super) fn request(&mut self, request: Request) -> Option<Response> {
        let Request { id, method, params } = request;
        let answer = match method.as_str() {
            "shutdown" => Ok(Value::Null),
            "textDocument/completion" => parse(params).and_then(|p| self.completion(p)),
            "completionItem/resolve" => self.resolve(params),
            "textDocument/hover" => parse(params).and_then(|p| self.hover(p)),
            "textDocument/signatureHelp" => parse(params).and_then(|p| self.signature_help(p)),
            "textDocument/definition" => parse(params).and_then(|p| self.definition(p)),
            "textDocument/references" => parse(params).and_then(|p| self.references(p)),
            "textDocument/prepareRename" => parse(params).and_then(|p| self.prepare_rename(p)),
            "textDocument/rename" => parse(params).and_then(|p| self.rename(p)),
            "textDocument/documentSymbol" => parse(params).and_then(|p| self.symbols(p)),
            "workspace/symbol" => parse(params).and_then(|p| self.workspace_symbols(p)),
            "textDocument/foldingRange" => parse(params).and_then(|p| self.folds(p)),
            "textDocument/formatting" => parse(params).and_then(|p| self.formatting(p)),
            "textDocument/onTypeFormatting" => parse(params).and_then(|p| self.on_type(p)),
            "textDocument/codeAction" => parse(params).and_then(|p| self.code_actions(p)),
            "textDocument/codeLens" => parse::<CodeLensParams>(params)
                .map(|p| self.code_lenses(p.text_document.uri.as_str())),
            "workspace/executeCommand" => {
                return match parse(params) {
                    Ok(p) => self.execute(id, p),
                    Err(e) => Some(Response::new_err(id, ErrorCode::InvalidParams as i32, e)),
                };
            }
            _ => {
                let message = format!("{method} isn't a request this server answers");
                return Some(Response::new_err(
                    id,
                    ErrorCode::MethodNotFound as i32,
                    message,
                ));
            }
        };
        Some(match answer {
            Ok(value) => Response::new_ok(id, value),
            Err(e) => Response::new_err(id, ErrorCode::RequestFailed as i32, e),
        })
    }

    /// A document's file and text: its editor's, or else the one on disk.
    fn document(&self, uri: &lsp_types::Uri) -> Result<(PathBuf, String), String> {
        let path = path_of(uri.as_str()).ok_or_else(|| format!("{} isn't a file", uri.as_str()))?;
        let text = self
            .text_of(&path)
            .ok_or_else(|| format!("couldn't read {}", path.display()))?;
        Ok((path, text))
    }

    /// The profiles' folder that holds `file`, `file`'s path in it, and every text in it.
    fn workspace_of(&self, file: &Path) -> Option<Folder> {
        let (root, rel) = locate(file)?;
        let texts = self
            .texts(&root, false)
            .into_iter()
            .map(|(k, v)| (k, v.to_string()))
            .collect();
        Some(Folder { root, rel, texts })
    }

    /// The place in the program TypeScript checks that a place in a script sits at, with the
    /// program held in the requests' runtime: the file's own program, or for a module, the first
    /// program that imports it.
    fn script_place(&mut self, file: &Path, at: Pos) -> Result<Option<ProgramPlace>, String> {
        let Some(root) = self.programs_of(file).into_iter().next() else {
            return Ok(None);
        };
        let Some(program) = self.program_of(&root) else {
            return Ok(None);
        };
        let Some((_, rel)) = locate(file) else {
            return Ok(None);
        };
        let Some(place) = program
            .to_program(&Place::new(&rel, at.line, at.column))
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        self.service().set_program(&program)?;
        Ok(Some(place))
    }

    fn completion(&mut self, p: CompletionParams) -> Result<Value, String> {
        let uri = p.text_document_position.text_document.uri;
        let (file, text) = self.document(&uri)?;
        let lines = Lines::new(&text);
        let at = lines.pos(p.text_document_position.position);
        if in_script(&text, at) {
            let Some(place) = self.script_place(&file, at)? else {
                return Ok(json!([]));
            };
            let found = self.service().completions(&place)?;
            let position = p.text_document_position.position;
            let items: Vec<Value> = found
                .iter()
                .map(|c| {
                    json!({
                        "label": c.label,
                        "kind": script_kind(&c.kind),
                        "sortText": c.sort_text,
                        "data": { "uri": uri.as_str(), "line": position.line, "character": position.character },
                    })
                })
                .collect();
            return Ok(json!({ "isIncomplete": false, "items": items }));
        }
        let Some(Folder { rel, texts, .. }) = self.workspace_of(&file) else {
            return Ok(json!([]));
        };
        let modules: Vec<String> = texts
            .iter()
            .filter_map(|(k, _)| {
                k.strip_prefix("modules/")
                    .map(|m| format!("modules/{}", m.trim_end_matches(".yaml")))
            })
            .filter(|m| format!("{m}.yaml") != rel)
            .collect();
        let cx = Context {
            module: rel.starts_with("modules/"),
            modules: &modules,
        };
        let items: Vec<Value> = complete(&text, at, &cx)
            .iter()
            .map(|c| {
                object(json!({
                    "label": c.label,
                    "kind": kind(c.kind),
                    "detail": c.detail,
                    "sortText": c.sort,
                    "insertTextFormat": 2,
                    "insertTextMode": 2,
                    "textEdit": { "range": lines.range(c.replace), "newText": c.insert },
                    "command": c.again.then(|| json!({ "title": "", "command": "editor.action.triggerSuggest" })),
                }))
            })
            .collect();
        Ok(json!({ "isIncomplete": false, "items": items }))
    }

    /// A completion inside a script with its detail and documentation, which for a key of
    /// `state` is its entry's `name:`. These come one at a time, since details for all 183 of
    /// the 58P's keys took 410ms (profile_build::Service::completions).
    fn resolve(&mut self, item: Value) -> Result<Value, String> {
        let mut item = item;
        let data = item.get("data").cloned().unwrap_or(Value::Null);
        let (Some(uri), Some(line), Some(character), Some(label)) = (
            data.get("uri").and_then(Value::as_str),
            data.get("line").and_then(Value::as_u64),
            data.get("character").and_then(Value::as_u64),
            item.get("label").and_then(Value::as_str).map(String::from),
        ) else {
            return Ok(item);
        };
        let uri: lsp_types::Uri = uri.parse().map_err(|_| format!("{uri} isn't a URI"))?;
        let (file, text) = self.document(&uri)?;
        let at = Lines::new(&text).pos(lsp_types::Position::new(line as u32, character as u32));
        let Some(place) = self.script_place(&file, at)? else {
            return Ok(item);
        };
        if let Some(details) = self.service().completion_details(&place, &label)? {
            item["detail"] = details.detail.into();
            if !details.documentation.is_empty() {
                item["documentation"] =
                    json!({ "kind": "markdown", "value": details.documentation });
            }
        }
        Ok(item)
    }

    fn hover(&mut self, p: HoverParams) -> Result<Value, String> {
        let at_lsp = p.text_document_position_params.position;
        let (file, text) = self.document(&p.text_document_position_params.text_document.uri)?;
        let lines = Lines::new(&text);
        let at = lines.pos(at_lsp);
        if in_script(&text, at) {
            let Some(place) = self.script_place(&file, at)? else {
                return Ok(Value::Null);
            };
            let Some(info) = self.service().quick_info(&place)? else {
                return Ok(Value::Null);
            };
            let mut value = format!("```typescript\n{}\n```", info.display);
            if !info.documentation.is_empty() {
                value.push_str(&format!("\n\n{}", info.documentation));
            }
            return Ok(json!({ "contents": { "kind": "markdown", "value": value } }));
        }
        Ok(match hover(&text, at) {
            Some((value, range)) => json!({
                "contents": { "kind": "markdown", "value": value },
                "range": lines.range(range),
            }),
            None => Value::Null,
        })
    }

    fn signature_help(&mut self, p: SignatureHelpParams) -> Result<Value, String> {
        let (file, text) = self.document(&p.text_document_position_params.text_document.uri)?;
        let at = Lines::new(&text).pos(p.text_document_position_params.position);
        if !in_script(&text, at) {
            return Ok(Value::Null);
        }
        let Some(place) = self.script_place(&file, at)? else {
            return Ok(Value::Null);
        };
        let Some(help) = self.service().signature_help(&place)? else {
            return Ok(Value::Null);
        };
        let signatures: Vec<Value> = help
            .signatures
            .iter()
            .map(|s| {
                json!({
                    "label": s.label,
                    "documentation": s.documentation,
                    "parameters": s.parameters.iter().map(|p| json!({ "label": p.label, "documentation": p.documentation })).collect::<Vec<_>>(),
                })
            })
            .collect();
        Ok(json!({
            "signatures": signatures,
            "activeSignature": help.active_signature,
            "activeParameter": help.active_parameter,
        }))
    }

    /// The protocol's locations for the profile language's, each range in its own file's text.
    fn locations(&self, root: &Path, found: Vec<Location>) -> Value {
        let out: Vec<Value> = found
            .into_iter()
            .map(|l| {
                let file = full(root, &l.path);
                let text = self.text_of(&file).unwrap_or_default();
                json!({ "uri": uri_of(&file), "range": Lines::new(&text).range(l.range) })
            })
            .collect();
        Value::Array(out)
    }

    fn definition(&mut self, p: GotoDefinitionParams) -> Result<Value, String> {
        let (file, text) = self.document(&p.text_document_position_params.text_document.uri)?;
        let at = Lines::new(&text).pos(p.text_document_position_params.position);
        let Some(Folder { root, rel, texts }) = self.workspace_of(&file) else {
            return Ok(Value::Null);
        };
        let ws = workspace(&texts);
        Ok(self.locations(&root, definition(&ws, &rel, at)))
    }

    fn references(&mut self, p: ReferenceParams) -> Result<Value, String> {
        let (file, text) = self.document(&p.text_document_position.text_document.uri)?;
        let at = Lines::new(&text).pos(p.text_document_position.position);
        let Some(Folder { root, rel, texts }) = self.workspace_of(&file) else {
            return Ok(Value::Null);
        };
        let ws = workspace(&texts);
        let found = references(&ws, &rel, at, p.context.include_declaration);
        Ok(self.locations(&root, found))
    }

    fn prepare_rename(&mut self, p: TextDocumentPositionParams) -> Result<Value, String> {
        let (_, text) = self.document(&p.text_document.uri)?;
        let lines = Lines::new(&text);
        Ok(match prepare_rename(&text, lines.pos(p.position)) {
            Some(range) => serde_json::to_value(lines.range(range)).unwrap_or(Value::Null),
            None => Value::Null,
        })
    }

    fn rename(&mut self, p: RenameParams) -> Result<Value, String> {
        let (file, text) = self.document(&p.text_document_position.text_document.uri)?;
        let at = Lines::new(&text).pos(p.text_document_position.position);
        let Some(Folder { root, rel, texts }) = self.workspace_of(&file) else {
            return Ok(Value::Null);
        };
        let ws = workspace(&texts);
        let edits = rename(&ws, &rel, at, &p.new_name)?;
        let mut changes = Map::new();
        for (path, edits) in edits {
            let target = full(&root, &path);
            let text = self.text_of(&target).unwrap_or_default();
            let lines = Lines::new(&text);
            let list: Vec<Value> = edits
                .iter()
                .map(|e| json!({ "range": lines.range(e.range), "newText": e.text }))
                .collect();
            changes.insert(uri_of(&target), Value::Array(list));
        }
        Ok(json!({ "changes": changes }))
    }

    fn symbols(&mut self, p: DocumentSymbolParams) -> Result<Value, String> {
        let (_, text) = self.document(&p.text_document.uri)?;
        let lines = Lines::new(&text);
        fn convert(lines: &Lines, s: &Symbol) -> Value {
            object(json!({
                "name": s.name,
                "detail": s.detail,
                "kind": symbol_kind(s.kind),
                "range": lines.range(s.range),
                "selectionRange": lines.range(s.selection),
                "children": s.children.iter().map(|c| convert(lines, c)).collect::<Vec<_>>(),
            }))
        }
        Ok(Value::Array(
            symbols(&text).iter().map(|s| convert(&lines, s)).collect(),
        ))
    }

    fn workspace_symbols(&mut self, p: WorkspaceSymbolParams) -> Result<Value, String> {
        let mut out = Vec::new();
        for root in self.roots.clone() {
            let texts: Vec<(String, String)> = self
                .texts(&root, false)
                .into_iter()
                .map(|(k, v)| (k, v.to_string()))
                .collect();
            let ws = workspace(&texts);
            for e in workspace_symbols(&ws, &p.query) {
                let file = full(&root, &e.path);
                let text = self.text_of(&file).unwrap_or_default();
                out.push(json!({
                    "name": e.name,
                    "kind": if e.event { 24 } else { 8 },
                    "containerName": format!("{} in {}", e.key, e.path),
                    "location": { "uri": uri_of(&file), "range": Lines::new(&text).range(e.range) },
                }));
            }
        }
        Ok(Value::Array(out))
    }

    fn folds(&mut self, p: FoldingRangeParams) -> Result<Value, String> {
        let (_, text) = self.document(&p.text_document.uri)?;
        let out: Vec<Value> = folds(&text)
            .iter()
            .map(|f| json!({ "startLine": f.start - 1, "endLine": f.end - 1, "kind": "region" }))
            .collect();
        Ok(Value::Array(out))
    }

    fn formatting(&mut self, p: DocumentFormattingParams) -> Result<Value, String> {
        let (file, text) = self.document(&p.text_document.uri)?;
        let formatted = match format(&text) {
            Ok(formatted) => formatted,
            Err(Unformatted::Yaml(_)) => return Ok(json!([])),
            Err(Unformatted::Changed) => {
                eprintln!(
                    "{} is left as it is, since the formatted text read as a different profile, a fault of the formatter's",
                    file.display()
                );
                return Ok(json!([]));
            }
        };
        // An editor keeps a document's line ends whatever an edit holds, so the formatted text
        // takes the document's, and the edit covers only the lines that changed.
        let formatted = if text.contains("\r\n") {
            formatted.replace('\n', "\r\n")
        } else {
            formatted
        };
        let lines = Lines::new(&text);
        Ok(match edit_between(&text, &formatted) {
            Some(edit) => json!([{ "range": lines.range(edit.range), "newText": edit.text }]),
            None => json!([]),
        })
    }

    fn on_type(&mut self, p: DocumentOnTypeFormattingParams) -> Result<Value, String> {
        let (_, text) = self.document(&p.text_document_position.text_document.uri)?;
        let line = p.text_document_position.position.line as usize;
        let indent = match p.ch.as_str() {
            "\n" => indent_after(&text, line + 1),
            "}" => indent_closing(&text, line + 1),
            _ => None,
        };
        let range = Lines::new(&text).indentation(line);
        Ok(match indent {
            Some(n) if n as u32 != range.end.character => {
                json!([{ "range": range, "newText": " ".repeat(n) }])
            }
            _ => json!([]),
        })
    }

    fn code_actions(&mut self, p: CodeActionParams) -> Result<Value, String> {
        let uri = p.text_document.uri;
        let (_, text) = self.document(&uri)?;
        let lines = Lines::new(&text);
        let mut out = Vec::new();
        for d in p.context.diagnostics {
            let Some(NumberOrString::String(code)) = &d.code else {
                continue;
            };
            let Some(found) = fix(&text, code, lines.pos(d.range.start)) else {
                continue;
            };
            let edits: Vec<Value> = found
                .edits
                .iter()
                .map(|e| json!({ "range": lines.range(e.range), "newText": e.text }))
                .collect();
            out.push(json!({
                "title": found.title,
                "kind": "quickfix",
                "diagnostics": [d],
                "isPreferred": true,
                "edit": { "changes": { uri.as_str(): edits } },
            }));
        }
        Ok(Value::Array(out))
    }

    /// The server's commands, each on a file's URI but `dualInput.localFolder`, which takes none
    /// and answers with the local folder's path, and the panel's, whose answer says only that the
    /// command was taken. "Build now" is answered once its build is done.
    fn execute(&mut self, id: RequestId, p: ExecuteCommandParams) -> Option<Response> {
        let failed = |id: RequestId, message: String| {
            Some(Response::new_err(
                id,
                ErrorCode::RequestFailed as i32,
                message,
            ))
        };
        if p.command.starts_with("dualInput.panel.") {
            return match self.panel_command(&p.command, &p.arguments) {
                Ok(()) => Some(Response::new_ok(id, Value::Null)),
                Err(e) => failed(id, e),
            };
        }
        if p.command.starts_with("dualInput.syncLog.") {
            return match self.sync_log_command(&p.command, &p.arguments) {
                Ok(()) => Some(Response::new_ok(id, Value::Null)),
                Err(e) => failed(id, e),
            };
        }
        if p.command == "dualInput.localFolder" {
            return match self.settings.local() {
                Ok(folder) => Some(Response::new_ok(id, folder.to_string_lossy())),
                Err(e) => failed(id, e),
            };
        }
        let Some(path) = p
            .arguments
            .first()
            .and_then(Value::as_str)
            .and_then(path_of)
        else {
            return failed(id, format!("{} takes a file's URI", p.command));
        };
        match p.command.as_str() {
            "dualInput.build" => match self.build(&path, Some(id.clone())) {
                Ok(()) => None,
                Err(e) => failed(id, e),
            },
            "dualInput.removeLocalBundle" => match self.remove_bundle(&path) {
                Ok(()) => Some(Response::new_ok(id, Value::Null)),
                Err(e) => failed(id, e),
            },
            "dualInput.importers" => {
                let Some((root, rel)) = locate(&path) else {
                    return failed(id, format!("{} isn't a module", path.display()));
                };
                let uris: Vec<String> = self
                    .importers(&root, &rel)
                    .iter()
                    .map(|p| uri_of(&full(&root, p)))
                    .collect();
                Some(Response::new_ok(id, uris))
            }
            other => failed(id, format!("{other} isn't a command this server runs")),
        }
    }

    /// Deletes a profile's bundle from the local folder, which moves no pin in a session already
    /// held (record/areas/profiles/03-the-extension.md, "Building on save").
    fn remove_bundle(&mut self, profile: &Path) -> Result<(), String> {
        let (_, rel) = locate(profile)
            .filter(|(_, rel)| rel.starts_with("aircraft/"))
            .ok_or_else(|| format!("{} isn't a profile", profile.display()))?;
        let name = rel.rsplit('/').next().unwrap_or(&rel);
        let bundle = self.settings.local()?.join(name);
        if bundle.exists() {
            std::fs::remove_file(&bundle)
                .map_err(|e| format!("couldn't delete {}: {e}", bundle.display()))?;
            eprintln!("Deleted {}", bundle.display());
        }
        let errors = self.errors.get(profile).copied().unwrap_or(0);
        self.notify_build(profile, profile, None, errors);
        Ok(())
    }
}

fn workspace(texts: &[(String, String)]) -> Workspace<'_> {
    Workspace {
        files: texts
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect(),
    }
}

/// The protocol's completion kind for one of TypeScript's.
fn script_kind(kind: &str) -> u32 {
    match kind {
        "method" => 2,
        "function" | "local function" => 3,
        "var" | "let" | "local var" | "parameter" => 6,
        "class" => 7,
        "interface" => 8,
        "module" => 9,
        "property" => 10,
        "keyword" => 14,
        "enum" => 13,
        "enum member" => 20,
        "const" => 21,
        "type" | "alias" | "type parameter" => 25,
        _ => 1,
    }
}

fn kind(kind: CompletionKind) -> u32 {
    match kind {
        CompletionKind::Field => 5,
        CompletionKind::Word => 12,
        CompletionKind::Name => 3,
        CompletionKind::Variant => 20,
        CompletionKind::Module => 9,
        CompletionKind::Snippet => 15,
    }
}

/// The protocol's symbol kind, whose number picks an editor's icon: a state entry a field's, and
/// an event entry an event's.
fn symbol_kind(kind: SymbolKind) -> u32 {
    match kind {
        SymbolKind::Block => 2,
        SymbolKind::Section => 3,
        SymbolKind::Subsection => 4,
        SymbolKind::StateEntry => 8,
        SymbolKind::EventEntry => 24,
        SymbolKind::Variant => 14,
        SymbolKind::Seat => 19,
    }
}
