// Liatir C++ Native bridge SDK — managed by @liatir/cli.
#pragma once
#include <curl/curl.h>
#include <nlohmann/json.hpp>
#include <chrono>
#include <cstdlib>
#include <fstream>
#include <filesystem>
#include <functional>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>

namespace liatir {
using json = nlohmann::ordered_json;

inline std::string env(const char* name) {
    const char* value = std::getenv(name);
    return value ? value : "";
}
inline std::filesystem::path env_path(const char* name) {
#ifdef _WIN32
    // Windows environment paths are UTF-16, while Plugin JSON paths are UTF-8.
    const std::string key(name);
    const std::wstring wide_key(key.begin(), key.end());
    const auto* value = _wgetenv(wide_key.c_str());
    return value ? std::filesystem::path(value) : std::filesystem::path();
#else
    return std::filesystem::u8path(env(name));
#endif
}
inline bool is_dev() { return env("LIATIR_RUN_SCOPE") == "plugin-dev"; }
inline std::string job_id() {
    auto id = env("LIATIR_JOB_ID");
    if (id.empty()) throw std::runtime_error("Missing Liatir Job identity");
    return id;
}

inline json invoke(const std::string& command, json payload = json::object()) {
    if (!payload.is_object()) throw std::runtime_error("Bridge payload must be an object");
    if (is_dev()) {
        payload["__liatirDevContext"] = {{"scope", "plugin-dev"},
            {"sessionId", env("LIATIR_DEV_SESSION_ID")}, {"workspaceId", env("LIATIR_WORKSPACE_ID")}};
    }
    std::ifstream connection(env_path("LIATIR_IPC_FILE"));
    if (!connection) throw std::runtime_error("Missing Liatir app connection");
    const auto ipc = json::parse(connection);
    const auto& port_value = ipc.at("port");
    const auto token = ipc.at("token").get<std::string>();
    if (!port_value.is_number_integer() || port_value < 1 || port_value > 65535 ||
        token.empty() || token.find_first_of("\r\n") != std::string::npos)
        throw std::runtime_error("Invalid Liatir app connection");
    const auto port = port_value.get<int>();

    struct CurlLifetime {
        CurlLifetime() {
            if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK)
                throw std::runtime_error("Cannot initialize libcurl");
        }
        ~CurlLifetime() { curl_global_cleanup(); }
    };
    static const CurlLifetime lifetime;
    std::unique_ptr<CURL, decltype(&curl_easy_cleanup)> curl(curl_easy_init(), curl_easy_cleanup);
    if (!curl) throw std::runtime_error("Cannot create bridge request");
    curl_slist* raw_headers = nullptr;
    for (const auto& header : {std::string("Content-Type: application/json"), "Authorization: Bearer " + token}) {
        auto next = curl_slist_append(raw_headers, header.c_str());
        if (!next) { curl_slist_free_all(raw_headers); throw std::bad_alloc(); }
        raw_headers = next;
    }
    std::unique_ptr<curl_slist, decltype(&curl_slist_free_all)> headers(raw_headers, curl_slist_free_all);
    const auto url = "http://127.0.0.1:" + std::to_string(port) + "/invoke";
    const auto body = json{{"cmd", command}, {"payload", payload}}.dump();
    std::string response;
    const auto receive = +[](char* data, size_t size, size_t count, void* output) noexcept -> size_t {
        try {
            static_cast<std::string*>(output)->append(data, size * count);
            return size * count;
        } catch (...) { return 0; }
    };
    const auto set = [&](CURLoption option, auto value) {
        if (curl_easy_setopt(curl.get(), option, value) != CURLE_OK)
            throw std::runtime_error("Cannot configure bridge request");
    };
    set(CURLOPT_URL, url.c_str());
    set(CURLOPT_PROXY, ""); // The authenticated connection must stay on loopback.
    set(CURLOPT_HTTPHEADER, headers.get());
    set(CURLOPT_POSTFIELDS, body.c_str());
    set(CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(body.size()));
    set(CURLOPT_WRITEFUNCTION, receive);
    set(CURLOPT_WRITEDATA, &response);
    set(CURLOPT_TIMEOUT, 600L);
    set(CURLOPT_NOSIGNAL, 1L);
    const auto status = curl_easy_perform(curl.get());
    if (status != CURLE_OK) throw std::runtime_error(curl_easy_strerror(status));
    long http_status = 0;
    if (curl_easy_getinfo(curl.get(), CURLINFO_RESPONSE_CODE, &http_status) != CURLE_OK || http_status != 200)
        throw std::runtime_error("Liatir bridge HTTP request failed");
    const auto result = json::parse(response);
    if (!result.at("ok").get<bool>())
        throw std::runtime_error(result.value("error", std::string("Liatir bridge command failed")));
    return result.at("result");
}

inline json paths() {
    auto result = invoke("lia_fs_paths");
    if (is_dev()) {
        const auto rel = "workspaces/" + env("LIATIR_WORKSPACE_ID") + "/plugin-dev/" + env("LIATIR_DEV_SESSION_ID");
        for (bool permanent : {true, false}) invoke("lia_fs_mkdir", {{"rel", rel}, {"permanent", permanent}});
        for (const auto* key : {"data", "cache"}) result[key] = result.at(key).get<std::string>() + "/" + rel;
        result["temp"] = result["cache"];
    }
    return result;
}

inline json run(const std::string& command, const json& args = json::array(),
                json options = json::object(),
                const std::function<void(const std::string&)>& on_stdout = {},
                const std::function<void(const std::string&)>& on_stderr = {}) {
    options["cmd"] = command;
    options["args"] = args;
    const auto id = invoke("lia_jobs_spawn", options).at("jobId").get<std::string>();
    size_t offsets[2] = {0, 0};
    for (;;) {
        const auto job = invoke("lia_jobs_status", {{"jobId", id}});
        const auto output = invoke("lia_jobs_get_output", {{"jobId", id}});
        for (size_t stream = 0; stream < 2; ++stream) {
            const auto& lines = output.at(stream == 0 ? "stdout" : "stderr");
            const auto& callback = stream == 0 ? on_stdout : on_stderr;
            for (; offsets[stream] < lines.size(); ++offsets[stream])
                if (callback) callback(lines.at(offsets[stream]).get<std::string>());
        }
        if (job.at("status").at("type") != "running") return job;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
}
} // namespace liatir
