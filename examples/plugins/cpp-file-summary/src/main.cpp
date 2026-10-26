#include "liatir.hpp"

int main() {
    return liatir::define_plugin()
        .input("file", liatir::field::file().label("Text file").required(true))
        .output("report", liatir::field::file().label("Summary").ext({"json"}))
        .main([](const liatir::Context& ctx) {
            std::ifstream input(ctx.path("file"));
            if (!input) liatir::fail("Cannot open the input file");
            std::size_t lines = 0;
            std::string line;
            while (std::getline(input, line)) ++lines;
            if (input.bad()) liatir::fail("Could not finish reading the input file");
#ifndef __wasi__
            liatir::invoke("lia_plugin_log", {{"jobId", liatir::job_id()},
                {"level", "info"}, {"message", "C++ summary completed"}, {"meta", {{"lines", lines}}}});
#endif
            const liatir::json report{{"lines", lines}};
            return liatir::json{{"report", {{"content", report.dump()}, {"fileName", "summary.json"}}}};
        });
}
