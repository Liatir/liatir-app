use std::io::{self, Read, Write};
use serde::{Deserialize, Serialize};

// Inputs must match the inputSchema in .lia-manifest.json.
// Keys are camelCase in JSON; serde maps them to snake_case fields.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    text: String,
}

// Outputs must match the outputSchema in .lia-manifest.json.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    length: u64,
}

// A Liatir WASM plugin reads its JSON input from STDIN and writes JSON output to
// STDOUT. It runs in a sandbox: no network access and no arbitrary filesystem.
// Only directories mounted by Liatir are available to the tool.
fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("failed to read stdin");
    let input: Input = serde_json::from_str(&buf).expect("invalid JSON input");

    // Write your tool logic here.
    let output = Output { length: input.text.len() as u64 };

    let json = serde_json::to_string(&output).expect("failed to serialize output");
    io::stdout().write_all(json.as_bytes()).expect("failed to write stdout");
}
