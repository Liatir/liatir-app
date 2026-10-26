// Liatir C++ Plugin SDK — managed by @liatir/cli.
// Declare one contract; the CLI extracts it and every run validates its values.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace liatir {
[[noreturn]] inline void fail(const std::string& message) {
#ifdef __wasi__
    std::cerr << "[liatir] " << message << '\n';
    std::exit(1);
#else
    throw std::runtime_error(message);
#endif
}
}

#ifdef __wasi__
// Preview 1 needs no C++ exception runtime: JSON errors use the same SDK failure path.
#define JSON_NOEXCEPTION 1
#define JSON_THROW_USER(error) ::liatir::fail((error).what())
#endif
#include <nlohmann/json.hpp>
#ifndef __wasi__
#include "liatir_bridge.hpp"
#endif

namespace liatir {
using json = nlohmann::ordered_json;

struct Field {
    json schema;
    explicit Field(const char* type) : schema{{"type", type}} {}
    Field& label(const std::string& value) { schema["label"] = value; return *this; }
    Field& description(const std::string& value) { schema["description"] = value; return *this; }
    Field& required(bool value) { schema["required"] = value; return *this; }
    Field& default_value(json value) { schema["default"] = std::move(value); return *this; }
    Field& accept(const std::vector<std::string>& value) { schema["accept"] = value; return *this; }
    Field& ext(const std::vector<std::string>& value) { schema["ext"] = value; return *this; }
    Field& format(const std::string& value) { schema["format"] = value; return *this; }
    Field& integer() { return format("integer"); }
    Field& artifact(json value) { schema["artifact"] = std::move(value); return *this; }
};
namespace field {
inline Field string() { return Field("string"); }
inline Field number() { return Field("number"); }
inline Field boolean() { return Field("boolean"); }
inline Field file() { return Field("file"); }
inline Field json() { return Field("json"); }
inline Field stats() { return Field("stats"); }
}

inline bool matches(const std::string& type, const json& value, bool output) {
    if (type == "string") return value.is_string();
    if (type == "number") return value.is_number() && std::isfinite(value.get<double>());
    if (type == "boolean") return value.is_boolean();
    if (type == "file") return value.is_string() || (output && value.is_object() &&
        ((value.contains("path") && value["path"].is_string()) ||
         (value.contains("content") && value["content"].is_string())));
    if (type == "json") return output;
    if (type == "stats") return output && value.is_object();
    return false;
}

class Context {
    json input_;
    json raw_;
public:
    Context(json input, json raw) : input_(std::move(input)), raw_(std::move(raw)) {}
    const json& raw_input() const { return raw_; }
    const json& input() const { return input_; }
    const json& get(const std::string& name) const {
        static const json missing;
        return input_.contains(name) ? input_.at(name) : missing;
    }
    const std::string& str(const std::string& name) const {
        const auto& value = get(name);
        if (!value.is_string()) fail("input \"" + name + "\" must be a string");
        return value.get_ref<const std::string&>();
    }
    std::string string(const std::string& name) const { return str(name); }
    double f64(const std::string& name) const {
        const auto& value = get(name);
        if (!matches("number", value, false)) fail("input \"" + name + "\" must be a number");
        return value.get<double>();
    }
    std::int64_t i64(const std::string& name) const {
        const auto& value = get(name);
        if (!value.is_number_integer() || (value.is_number_unsigned() &&
            value.get<std::uint64_t>() > static_cast<std::uint64_t>((std::numeric_limits<std::int64_t>::max)())))
            fail("input \"" + name + "\" must be an integer");
        return value.get<std::int64_t>();
    }
    bool boolean(const std::string& name) const {
        const auto& value = get(name);
        if (!value.is_boolean()) fail("input \"" + name + "\" must be a boolean");
        return value.get<bool>();
    }
    std::filesystem::path path(const std::string& name) const { return std::filesystem::u8path(str(name)); }
    std::filesystem::path work_dir() const { return "."; }
#ifdef __wasi__
    std::filesystem::path storage_dir() const { return "/storage"; }
#endif
};

class Plugin {
    json inputs_ = json::object();
    json outputs_ = json::object();
    void declare(json& schema, const std::string& name, const Field& field) {
        if (name.empty() || schema.contains(name)) fail("Empty or duplicate Plugin field: " + name);
        schema[name] = field.schema;
    }
    void validate_schema(const json& schema, bool output) const {
        for (const auto& item : schema.items()) {
            const auto type = item.value().at("type").get<std::string>();
            const std::vector<std::string> allowed = output
                ? std::vector<std::string>{"string", "number", "boolean", "file", "json", "stats"}
                : std::vector<std::string>{"string", "number", "boolean", "file"};
            if (std::find(allowed.begin(), allowed.end(), type) == allowed.end())
                fail("Invalid Plugin field type: " + item.key() + " (" + type + ")");
            if (item.value().contains("default") && !matches(type, item.value()["default"], output))
                fail("Invalid default for field: " + item.key());
        }
    }
    json validate(const json& schema, const json& payload, bool output) const {
        if (!payload.is_object()) fail(output ? "Plugin output must be an object" : "Plugin input must be an object");
        if (output) for (const auto& item : payload.items())
            if (!schema.contains(item.key())) fail("output \"" + item.key() + "\" is not declared in the contract");
        json result = json::object();
        for (const auto& item : schema.items()) {
            const auto& name = item.key();
            const auto& spec = item.value();
            auto value = payload.value(name, json(nullptr));
            if (value.is_null() && !output && spec.contains("default")) value = spec.at("default");
            if (value.is_null()) {
                if (spec.value("required", false)) fail("missing required " + std::string(output ? "output" : "input") + " \"" + name + "\"");
            } else if (!matches(spec.at("type").get<std::string>(), value, output)) {
                fail(std::string(output ? "output" : "input") + " \"" + name + "\" must be " + spec.at("type").get<std::string>());
            }
            result[name] = std::move(value);
        }
        return output ? payload : result;
    }
public:
    Plugin& input(const std::string& name, const Field& field) { declare(inputs_, name, field); return *this; }
    Plugin& output(const std::string& name, const Field& field) { declare(outputs_, name, field); return *this; }
    template<class Handler> int main(Handler handler) const {
#ifndef __wasi__
        try {
#endif
            validate_schema(inputs_, false);
            validate_schema(outputs_, true);
            if (std::getenv("LIATIR_EMIT_CONTRACT")) {
                std::cout << "__LIATIR_CONTRACT__" << json{{"liatirContract", 1},
                    {"language", "cpp"}, {"inputs", inputs_}, {"outputs", outputs_}}.dump() << '\n';
                return 0;
            }
            json raw;
#ifndef __wasi__
            const auto file = env_path("LIATIR_INPUT_FILE");
            if (!file.empty()) {
                std::ifstream stream(file);
                if (!stream) fail("Cannot read Plugin input file");
                raw = json::parse(stream);
            } else
#endif
            {
                std::string text{std::istreambuf_iterator<char>(std::cin), std::istreambuf_iterator<char>()};
                raw = text.find_first_not_of(" \r\n\t") == std::string::npos ? json::object() : json::parse(text);
            }
            // Null input is treated as an empty form, matching the Rust SDK.
            const auto validated = validate(inputs_, raw.is_null() ? json::object() : raw, false);
            const Context context(validated, raw);
            const auto result = validate(outputs_, json(handler(context)), true);
#ifndef __wasi__
            std::cout << "__LIATIR_RESULT__";
#endif
            std::cout << result.dump() << '\n';
            return 0;
#ifndef __wasi__
        } catch (const std::exception& error) {
            std::cerr << "[liatir] " << error.what() << '\n';
            return 1;
        }
#endif
    }
};
inline Plugin define_plugin() { return Plugin(); }
} // namespace liatir
