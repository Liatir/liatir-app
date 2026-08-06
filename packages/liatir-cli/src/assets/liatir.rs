// Liatir WASM plugin SDK — managed by @liatir/cli.
//
// `liatir init` writes this file into src/ so `mod liatir;` resolves, and
// `liatir build` keeps it in sync with your CLI version. Do not edit it:
// local changes are overwritten by the next `liatir build`.
//
// This is the same Liatir plugin API as Node and Python: declare the I/O
// contract once with define_plugin(); the manifest schema is generated from
// it by `liatir build`, and every run is validated against it before and
// after your handler executes. stdout is reserved for the result JSON — use
// eprintln! for logs.
//
// Docs: https://liatir.com/docs/plugins
#![allow(dead_code)]

use serde_json::{Map, Value};
use std::io::Read;
use std::path::PathBuf;

pub const SDK_VERSION: &str = "0.1.0";
const CONTRACT_VERSION: u32 = 1;

// Marker scanned by `liatir build` when it runs the compiled wasm with
// LIATIR_EMIT_CONTRACT=1 to extract the schema.
const CONTRACT_MARKER: &str = "__LIATIR_CONTRACT__";

// Field types accepted by Liatir, mirroring the manifest schema contract.
const INPUT_FIELD_TYPES: [&str; 4] = ["string", "number", "boolean", "file"];
const OUTPUT_FIELD_TYPES: [&str; 6] = ["string", "number", "boolean", "file", "json", "stats"];

/// Error type returned by Context getters; converts into Box<dyn Error>, so
/// `?` works directly inside the handler.
#[derive(Debug)]
pub struct LiatirError(pub String);

impl std::fmt::Display for LiatirError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.0)
    }
}

impl std::error::Error for LiatirError {}

/// One declared field. Build it with the `field::*` constructors.
pub struct Field {
    field_type: &'static str,
    schema: Map<String, Value>,
}

impl Field {
    fn new(field_type: &'static str) -> Self {
        let mut schema = Map::new();
        schema.insert("type".to_string(), Value::String(field_type.to_string()));
        Field { field_type, schema }
    }

    fn set(mut self, key: &str, value: Value) -> Self {
        self.schema.insert(key.to_string(), value);
        self
    }

    pub fn label(self, label: &str) -> Self {
        self.set("label", Value::String(label.to_string()))
    }

    pub fn description(self, description: &str) -> Self {
        self.set("description", Value::String(description.to_string()))
    }

    pub fn required(self, required: bool) -> Self {
        self.set("required", Value::Bool(required))
    }

    pub fn default_value(self, default: impl Into<Value>) -> Self {
        self.set("default", default.into())
    }

    /// Accepted file extensions for file inputs.
    pub fn accept(self, extensions: &[&str]) -> Self {
        let list = extensions.iter().map(|e| Value::String(e.to_string())).collect();
        self.set("accept", Value::Array(list))
    }

    /// Expected file extensions for file outputs.
    pub fn ext(self, extensions: &[&str]) -> Self {
        let list = extensions.iter().map(|e| Value::String(e.to_string())).collect();
        self.set("ext", Value::Array(list))
    }

    /// Numeric display hint: "integer", "decimal", "percent", or "bytes".
    pub fn format(self, format: &str) -> Self {
        self.set("format", Value::String(format.to_string()))
    }

    /// Shorthand for .format("integer").
    pub fn integer(self) -> Self {
        self.format("integer")
    }
}

/// Field constructors: declare what a plugin's inputs/outputs are, once.
pub mod field {
    use super::Field;

    pub fn string() -> Field {
        Field::new("string")
    }

    pub fn number() -> Field {
        Field::new("number")
    }

    pub fn boolean() -> Field {
        Field::new("boolean")
    }

    pub fn file() -> Field {
        Field::new("file")
    }

    pub fn json() -> Field {
        Field::new("json")
    }

    pub fn stats() -> Field {
        Field::new("stats")
    }
}

/// What the handler receives: validated input plus sandbox path helpers.
pub struct Context {
    input: Map<String, Value>,
    raw_input: Value,
}

impl Context {
    fn missing(&self, name: &str) -> LiatirError {
        LiatirError(format!("input \"{name}\" is not set"))
    }

    /// Raw JSON value of a declared input (None when unset).
    pub fn get(&self, name: &str) -> Option<&Value> {
        match self.input.get(name) {
            Some(Value::Null) | None => None,
            Some(value) => Some(value),
        }
    }

    pub fn str(&self, name: &str) -> Result<&str, LiatirError> {
        self.get(name).and_then(Value::as_str).ok_or_else(|| self.missing(name))
    }

    pub fn string(&self, name: &str) -> Result<String, LiatirError> {
        self.str(name).map(str::to_string)
    }

    pub fn f64(&self, name: &str) -> Result<f64, LiatirError> {
        self.get(name).and_then(Value::as_f64).ok_or_else(|| self.missing(name))
    }

    pub fn i64(&self, name: &str) -> Result<i64, LiatirError> {
        let value = self.get(name).ok_or_else(|| self.missing(name))?;
        value
            .as_i64()
            .ok_or_else(|| LiatirError(format!("input \"{name}\" is not an integer")))
    }

    pub fn bool(&self, name: &str) -> Result<bool, LiatirError> {
        self.get(name).and_then(Value::as_bool).ok_or_else(|| self.missing(name))
    }

    /// Path of a file input (directories of file inputs are mounted read-only).
    pub fn path(&self, name: &str) -> Result<PathBuf, LiatirError> {
        self.str(name).map(PathBuf::from)
    }

    /// The raw payload before validation, as received from Liatir.
    pub fn raw_input(&self) -> &Value {
        &self.raw_input
    }

    /// Persistent per-plugin storage mounted by the Liatir sandbox.
    pub fn storage_dir(&self) -> PathBuf {
        PathBuf::from("/storage")
    }

    /// Temporary job working directory (cleaned after the run).
    pub fn work_dir(&self) -> PathBuf {
        PathBuf::from(".")
    }
}

/// The declared contract. Finish it with .main(handler).
pub struct Plugin {
    inputs: Vec<(String, Field)>,
    outputs: Vec<(String, Field)>,
}

/// Define a Liatir WASM plugin contract — same API as Node and Python.
///
/// ```ignore
/// define_plugin()
///     .input("text", field::string().label("Text").required(true))
///     .output("length", field::number().label("Length").integer())
///     .main(|ctx| Ok(serde_json::json!({ "length": ctx.str("text")?.len() })));
/// ```
pub fn define_plugin() -> Plugin {
    Plugin { inputs: Vec::new(), outputs: Vec::new() }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn type_error(kind: &str, name: &str, expected: &str, value: &Value) -> String {
    format!("{kind} \"{name}\" must be {expected}, got {}", json_type_name(value))
}

/// Validate one scalar value against a field schema. Returns an error or None.
fn check_scalar(kind: &str, name: &str, field_type: &str, value: &Value) -> Option<String> {
    match field_type {
        "string" | "file" if !value.is_string() => Some(type_error(kind, name, "a string", value)),
        "number" if !value.is_number() => Some(type_error(kind, name, "a number", value)),
        "boolean" if !value.is_boolean() => Some(type_error(kind, name, "a boolean", value)),
        _ => None,
    }
}

/// File outputs are a path string, {"path": ...} or {"content": ...}.
fn check_file_output(name: &str, value: &Value) -> Option<String> {
    if value.is_string() {
        return None;
    }
    if let Value::Object(map) = value {
        let has_path = map.get("path").map(Value::is_string).unwrap_or(false);
        let has_content = map.get("content").map(Value::is_string).unwrap_or(false);
        if has_path || has_content {
            return None;
        }
        return Some(format!(
            "output \"{name}\" must be a file path string, {{\"path\": ...}} or {{\"content\": ..., \"fileName\": ...}}"
        ));
    }
    Some(type_error("output", name, "a file path string or file object", value))
}

/// A default that does not match its own field type would silently bypass
/// input validation; reject it at declaration time.
fn assert_valid_default(kind: &str, name: &str, field: &Field) {
    if let Some(default) = field.schema.get("default") {
        if let Some(error) = check_scalar(kind, name, field.field_type, default) {
            panic!("invalid default: {error}");
        }
    }
}

impl Plugin {
    /// Declare one input field. Inputs render as form fields in Liatir.
    pub fn input(mut self, name: &str, field: Field) -> Self {
        if !INPUT_FIELD_TYPES.contains(&field.field_type) {
            panic!(
                "input \"{name}\" has invalid type \"{}\" (allowed: {})",
                field.field_type,
                INPUT_FIELD_TYPES.join(", ")
            );
        }
        assert_valid_default("input", name, &field);
        self.inputs.push((name.to_string(), field));
        self
    }

    /// Declare one output field. Outputs feed Results and pipeline wiring.
    pub fn output(mut self, name: &str, field: Field) -> Self {
        if !OUTPUT_FIELD_TYPES.contains(&field.field_type) {
            panic!(
                "output \"{name}\" has invalid type \"{}\" (allowed: {})",
                field.field_type,
                OUTPUT_FIELD_TYPES.join(", ")
            );
        }
        assert_valid_default("output", name, &field);
        self.outputs.push((name.to_string(), field));
        self
    }

    /// The JSON-safe contract emitted for `liatir build`.
    fn contract(&self) -> Value {
        let mut contract = Map::new();
        contract.insert("liatirContract".to_string(), Value::from(CONTRACT_VERSION));
        contract.insert("sdkVersion".to_string(), Value::String(SDK_VERSION.to_string()));
        contract.insert("language".to_string(), Value::String("rust".to_string()));
        contract.insert("inputs".to_string(), schema_object(&self.inputs));
        contract.insert("outputs".to_string(), schema_object(&self.outputs));
        Value::Object(contract)
    }

    /// Apply defaults and check required/typed inputs against the contract.
    fn validate_input(&self, payload: &Value) -> Result<Map<String, Value>, String> {
        let empty = Map::new();
        let payload_map = match payload {
            Value::Null => &empty,
            Value::Object(map) => map,
            _ => return Err("plugin input must be a JSON object".to_string()),
        };

        let mut unknown: Vec<&String> = payload_map
            .keys()
            .filter(|key| !self.inputs.iter().any(|(name, _)| name == *key))
            .collect();
        if !unknown.is_empty() {
            // Unknown keys are dropped, not fatal: hosts may add bookkeeping
            // fields, and typos surface as "missing required input" instead.
            unknown.sort();
            eprintln!(
                "[liatir] ignoring input keys not in the contract: {}",
                unknown.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
            );
        }

        let mut validated = Map::new();
        let mut errors: Vec<String> = Vec::new();
        for (name, field) in &self.inputs {
            let value = payload_map.get(name).cloned().unwrap_or(Value::Null);
            if value.is_null() {
                if let Some(default) = field.schema.get("default") {
                    validated.insert(name.clone(), default.clone());
                    continue;
                }
                if field.schema.get("required").map(|r| r == &Value::Bool(true)).unwrap_or(false) {
                    errors.push(format!("missing required input \"{name}\""));
                    continue;
                }
                validated.insert(name.clone(), Value::Null);
                continue;
            }
            if let Some(error) = check_scalar("input", name, field.field_type, &value) {
                errors.push(error);
                continue;
            }
            validated.insert(name.clone(), value);
        }

        if errors.is_empty() {
            Ok(validated)
        } else {
            Err(errors.join("; "))
        }
    }

    /// Check the handler result against the declared outputs.
    fn validate_output(&self, result: Value) -> Result<Value, String> {
        let result_map = match &result {
            Value::Object(map) => map,
            other => {
                return Err(format!(
                    "the handler must return an object matching the declared outputs, got {}",
                    json_type_name(other)
                ))
            }
        };

        let mut errors: Vec<String> = Vec::new();
        for key in result_map.keys() {
            if !self.outputs.iter().any(|(name, _)| name == key) {
                errors.push(format!("output \"{key}\" is not declared in the contract"));
            }
        }

        for (name, field) in &self.outputs {
            let value = result_map.get(name).unwrap_or(&Value::Null);
            if value.is_null() {
                if field.schema.get("required").map(|r| r == &Value::Bool(true)).unwrap_or(false) {
                    errors.push(format!("missing required output \"{name}\""));
                }
                continue;
            }
            let error = match field.field_type {
                "file" => check_file_output(name, value),
                "stats" => {
                    if value.is_object() {
                        None
                    } else {
                        Some(type_error("output", name, "a stats object (map with sections)", value))
                    }
                }
                "json" => None,
                other => check_scalar("output", name, other, value),
            };
            if let Some(error) = error {
                errors.push(error);
            }
        }

        if errors.is_empty() {
            Ok(result)
        } else {
            Err(errors.join("; "))
        }
    }

    fn run<F>(&self, handler: F) -> Result<Value, String>
    where
        F: FnOnce(&Context) -> Result<Value, Box<dyn std::error::Error>>,
    {
        let mut buffer = String::new();
        std::io::stdin()
            .read_to_string(&mut buffer)
            .map_err(|error| format!("failed to read stdin: {error}"))?;
        let trimmed = buffer.trim();
        let raw_input: Value = if trimmed.is_empty() {
            Value::Object(Map::new())
        } else {
            serde_json::from_str(trimmed)
                .map_err(|error| format!("plugin input is not valid JSON: {error}"))?
        };

        let input = self.validate_input(&raw_input)?;
        let ctx = Context { input, raw_input };
        let result = handler(&ctx).map_err(|error| error.to_string())?;
        self.validate_output(result)
    }

    /// Run the plugin: validates input from stdin, calls the handler, then
    /// validates and prints the result JSON to stdout. With
    /// LIATIR_EMIT_CONTRACT set it prints the contract instead (used by
    /// `liatir build` to generate the manifest schema).
    pub fn main<F>(self, handler: F)
    where
        F: FnOnce(&Context) -> Result<Value, Box<dyn std::error::Error>>,
    {
        if std::env::var_os("LIATIR_EMIT_CONTRACT").is_some() {
            println!("{CONTRACT_MARKER}{}", self.contract());
            return;
        }

        match self.run(handler) {
            // The result is the only stdout write: Liatir parses stdout as JSON.
            Ok(value) => println!("{value}"),
            Err(message) => {
                eprintln!("[liatir] {message}");
                std::process::exit(1);
            }
        }
    }
}

fn schema_object(fields: &[(String, Field)]) -> Value {
    let mut object = Map::new();
    for (name, field) in fields {
        object.insert(name.clone(), Value::Object(field.schema.clone()));
    }
    Value::Object(object)
}
