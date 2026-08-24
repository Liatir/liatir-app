# API Connector

Status: implemented and native-E2E verified on macOS arm64, 2026-08-24

## Product contract

API Connector is a Liatir request builder, not a Bubble API Connector clone.
Saved calls have one execution meaning; there is no `Use as Data/Action` mode.

A parameter has five explicit properties: key, saved value, enabled, exposed as
a run input, and required. Its URL/body destination is used only when the
parameter is not already embedded in a template. `[name]` in a URL or header
and `<name>` in a body create the matching parameter automatically. The two
syntaxes are deliberately different so JSON arrays are not mistaken for body
parameters.

Fixed values are stored locally with the workspace. They are not described as
server-private: Liatir is a local desktop app and sends them from the user's
machine. Credentials are likewise stored locally and sent as configured by the
request.

The editor supports no auth mode that the runtime cannot execute. Current modes
are HTTP Basic, bearer token, API key in a header or query parameter, OAuth2
password/custom token requests, and HMAC-signed JWT. The copied Bubble OAuth
User-Agent option is gone.

## Test and run

`Test request and detect outputs` sends the real request and updates its response
preview and detected output schema. It deliberately creates no Job or Result.
Retesting ignores the old declared schema so a changed API response can replace
it, while still rejecting network and non-2xx HTTP failures.

`Run` uses the same request renderer and response validator, but owns a normal
Liatir execution: cancellable Job, run transcript, response artifact and Result.
Pipeline and MCP execution use the same exposed-input and required-value rules.

Structured JSON responses retain nested paths and primitive types. Pipeline
outputs expose nested leaves by stable keys such as `sample.count`; validation
rejects missing fields and wrong types. Text responses remain a response file
without invented structured outputs.

## Native transport and limits

HTTP runs through the Rust bridge rather than the webview, so ordinary APIs are
not blocked by browser CORS. Only `http` and `https` URLs are accepted and URL
credentials are rejected. Requests have bounded redirects, connect/total
timeouts, cancellable response reads and a 32 MB response limit.

Bodies are exactly one of JSON, raw text or URL-encoded form. Invalid JSON fails
before sending instead of silently becoming `{}`. GET and HEAD cannot carry body
parameters.

## Legacy migration

Existing `api-workspace.json` files are migrated once and rewritten without
Bubble-only fields. `private`, `querystring`, `optional`, `Use as`, legacy API-key
names, `form-data`, unused environments and OAuth User-Agent are mapped or
removed while preserving calls that Liatir can execute.
