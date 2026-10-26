cmake_minimum_required(VERSION 3.21)
project(liatir_plugin LANGUAGES CXX)

find_package(nlohmann_json 3.12 CONFIG QUIET)
if(NOT nlohmann_json_FOUND)
  include(FetchContent)
  FetchContent_Declare(nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
    URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa)
  FetchContent_MakeAvailable(nlohmann_json)
endif()

add_executable(liatir_plugin src/main.cpp)
target_compile_features(liatir_plugin PRIVATE cxx_std_17)
target_link_libraries(liatir_plugin PRIVATE nlohmann_json::nlohmann_json)

if(CMAKE_SYSTEM_NAME STREQUAL "WASI")
  target_compile_options(liatir_plugin PRIVATE -fno-exceptions)
  set_target_properties(liatir_plugin PROPERTIES SUFFIX ".wasm")
else()
  find_package(CURL REQUIRED)
  target_link_libraries(liatir_plugin PRIVATE CURL::libcurl)
endif()

# The CLI reads one deterministic output location on single/multi-config generators.
set_target_properties(liatir_plugin PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
foreach(config DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
  set_target_properties(liatir_plugin PROPERTIES RUNTIME_OUTPUT_DIRECTORY_${config} "${CMAKE_BINARY_DIR}/bin")
endforeach()
