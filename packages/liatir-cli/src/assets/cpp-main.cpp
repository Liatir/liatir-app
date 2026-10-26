#include "liatir.hpp"

int main() {
    return liatir::define_plugin()
        .input("text", liatir::field::string().label("Text").required(true)
            .default_value("hello from Liatir"))
        .output("length", liatir::field::number().label("Length").integer())
        .main([](const liatir::Context& ctx) {
            const auto& text = ctx.str("text");
            const auto length = std::count_if(text.begin(), text.end(),
                [](unsigned char byte) { return (byte & 0xc0) != 0x80; });
            return liatir::json{{"length", length}};
        });
}
