mod liatir;
use liatir::{define_plugin, field};
use serde_json::json;
fn main() {
    define_plugin()
        .input("file", field::file().label("UTF-8 text file").required(true))
        .output("summary", field::file().label("Summary JSON").ext(&["json"]))
        .output("lines", field::number().label("Lines").integer())
        .main(|ctx| {
            let text = std::fs::read_to_string(ctx.path("file")?)?;
            let lines = text.lines().count();
            ctx.liatir.log().info("Summarized text file", json!({"lines":lines}))?;
            let summary = json!({"lines":lines, "words":text.split_whitespace().count(), "bytes":text.len()});
            Ok(json!({"lines":lines, "summary":{"content":serde_json::to_string_pretty(&summary)?, "fileName":"summary.json"}}))
        });
}
