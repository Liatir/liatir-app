use std::io::{self, Read, Write};
use serde::{Deserialize, Serialize};

// Input — keys match inputSchema (camelCase JSON → snake_case fields via serde).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    sequence: String,
}

// Output — keys match outputSchema.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    length: u64,
    gc_percent: f64,
    a: u64,
    c: u64,
    g: u64,
    t: u64,
}

// A WASM custom tool is PURE computation: it reads JSON from stdin and writes
// JSON to stdout. It runs sandboxed — no network, no arbitrary filesystem (only
// the dirs of "file" inputs are mounted read-only). No Liatir bridge here.
fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("read stdin");
    let input: Input = serde_json::from_str(&buf).expect("invalid JSON input");

    let (mut a, mut c, mut g, mut t) = (0u64, 0u64, 0u64, 0u64);
    for ch in input.sequence.chars() {
        match ch.to_ascii_uppercase() {
            'A' => a += 1,
            'C' => c += 1,
            'G' => g += 1,
            'T' => t += 1,
            _ => {}
        }
    }

    let total = a + c + g + t;
    let gc_percent = if total > 0 {
        ((c + g) as f64 / total as f64) * 100.0
    } else {
        0.0
    };
    let length = input.sequence.chars().filter(|ch| !ch.is_whitespace()).count() as u64;

    let output = Output {
        length,
        gc_percent: (gc_percent * 10.0).round() / 10.0, // 1 decimal
        a,
        c,
        g,
        t,
    };

    let json = serde_json::to_string(&output).expect("serialize output");
    io::stdout().write_all(json.as_bytes()).expect("write stdout");
}
