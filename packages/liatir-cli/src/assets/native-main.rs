mod liatir;
use liatir::{define_plugin, field};
use serde_json::json;

fn main() {
    define_plugin()
        .input("text", field::string().label("Text").required(true).default_value("hello from Liatir"))
        .output("length", field::number().label("Length").integer())
        .main(|ctx| Ok(json!({ "length": ctx.str("text")?.chars().count() })));
}
