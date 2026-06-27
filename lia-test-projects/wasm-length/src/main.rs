use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    length: u64,
}

fn main() {
    let mut buf = String::new();
    io::stdin()
        .read_to_string(&mut buf)
        .expect("failed to read stdin");

    let input: Input = serde_json::from_str(&buf).expect("invalid JSON input");
    let output = Output {
        length: input.text.len() as u64,
    };

    let json = serde_json::to_string(&output).expect("failed to serialize output");
    io::stdout()
        .write_all(json.as_bytes())
        .expect("failed to write stdout");
}
