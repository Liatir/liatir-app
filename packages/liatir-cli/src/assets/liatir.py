# Liatir Python plugin SDK — managed by @liatir/cli.
#
# `liatir init` writes this file next to your entry point so editors resolve
# `import liatir`, and `liatir build` keeps it in sync with your CLI version and
# ships the same file inside the .lia bundle. Do not edit it: local changes are
# overwritten by the next `liatir build`.
#
# Declare the plugin I/O contract once with define_plugin(...); the manifest
# schema is generated from it by `liatir build`, and every run is validated
# against it before and after your handler executes.
#
# Plugin API surface (minimal — a plugin is a tool, not an orchestrator):
#   jobs, deps, desktop.fs (data/cache/pluginFs), desktop.app (info),
#   log, progress, paths, invoke.
#
# Docs: https://liatir.com/docs/plugins

import inspect
import json
import os
import sys
import time
import urllib.error
import urllib.request

__version__ = "0.2.0"

# Field types accepted by Liatir, mirroring the manifest schema contract
# (inputs render as form fields; outputs feed Results and pipeline wiring).
INPUT_FIELD_TYPES = ("string", "number", "boolean", "file")
OUTPUT_FIELD_TYPES = ("string", "number", "boolean", "file", "json", "stats")

CONTRACT_VERSION = 1


class LiatirContractError(Exception):
    """The plugin contract itself is invalid (wrong field type, bad schema)."""


class LiatirInputError(Exception):
    """The run payload does not satisfy the declared input contract."""


class LiatirOutputError(Exception):
    """The handler returned data that does not satisfy the output contract."""


class LiatirBridgeError(Exception):
    """A bridge call (ctx.liatir.*) failed, or the Liatir app is not reachable."""


def _field(field_type, label=None, description=None, required=None, default=None,
           accept=None, ext=None, format=None):
    """Build a field schema dict, keeping only the properties that are set."""
    schema = {"type": field_type}
    if label is not None:
        schema["label"] = label
    if description is not None:
        schema["description"] = description
    if required is not None:
        schema["required"] = bool(required)
    if default is not None:
        schema["default"] = default
    if accept is not None:
        schema["accept"] = list(accept)
    if ext is not None:
        schema["ext"] = list(ext)
    if format is not None:
        schema["format"] = format
    return schema


class field:
    """Field builders: declare what a plugin's inputs/outputs are, once."""

    @staticmethod
    def string(label=None, description=None, required=None, default=None):
        return _field("string", label, description, required, default)

    @staticmethod
    def number(label=None, description=None, required=None, default=None, format=None):
        return _field("number", label, description, required, default, format=format)

    @staticmethod
    def boolean(label=None, description=None, required=None, default=None):
        return _field("boolean", label, description, required, default)

    @staticmethod
    def file(label=None, description=None, required=None, default=None, accept=None, ext=None):
        return _field("file", label, description, required, default, accept=accept, ext=ext)

    @staticmethod
    def json(label=None, description=None, required=None, default=None):
        return _field("json", label, description, required, default)

    @staticmethod
    def stats(label=None, description=None, required=None):
        return _field("stats", label, description, required)


# ── Bridge (ctx.liatir) ──────────────────────────────────────────────────────
#
# The bridge is NOT in-process: the Liatir app runs a loopback HTTP server
# (127.0.0.1:<port>, Bearer-token auth) whose coordinates it writes to a `.ipc`
# file. This is the SAME transport the Node SDK (@liatir/api) uses; the only
# per-language part is this thin HTTP client. Every method below maps 1:1 to a
# native `lia_*` command — the single source of truth is the dispatch table in
# the Rust IPC server, so command strings and payload keys stay identical to
# the Node builders (camelCase payload keys; snake_case Python method names).

# Injected into every payload during `liatir dev` so the app scopes fs/jobs/
# global-vars to the sandbox session — mirrors the Node SDK.
DEV_CONTEXT_PAYLOAD_KEY = "__liatirDevContext"
SANDBOX_WORKSPACE_ID = "__test__"


def _compact(payload):
    """Drop keys whose value is None so they are absent from the JSON body.

    Node relies on JSON.stringify dropping `undefined`; Python must do the same
    explicitly so optional params reach Rust as "not provided", not as null.
    """
    return {key: value for key, value in payload.items() if value is not None}


def _app_data_dir_candidates():
    """Known locations of the app's `.ipc` file, mirroring appDataDirCandidates."""
    candidates = []
    env_ipc_file = os.environ.get("LIATIR_IPC_FILE")
    env_ipc_dir = os.environ.get("LIATIR_IPC_DIR")
    if env_ipc_file:
        candidates.append(os.path.dirname(env_ipc_file))
    if env_ipc_dir:
        candidates.append(env_ipc_dir)

    home = os.path.expanduser("~")
    names = ("app.liatir.app", "liatir", "Liatir")
    if sys.platform == "darwin":
        base = os.path.join(home, "Library", "Application Support")
        candidates += [os.path.join(base, name) for name in names]
    elif sys.platform == "win32":
        base = os.environ.get("APPDATA") or home
        candidates += [os.path.join(base, name) for name in names]
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
        candidates += [os.path.join(base, name) for name in names]

    # De-duplicate while preserving order.
    seen = set()
    unique = []
    for path in candidates:
        if path not in seen:
            seen.add(path)
            unique.append(path)
    return unique


def _read_ipc_info():
    """Locate and read the app's `.ipc` file -> {"port", "token"}.

    Rust injects LIATIR_IPC_FILE when it spawns the plugin; the app-data
    fallback keeps the SDK usable outside that spawn path (e.g. local testing).
    """
    env_ipc_file = os.environ.get("LIATIR_IPC_FILE")
    port_files = []
    if env_ipc_file:
        port_files.append(env_ipc_file)
    port_files += [os.path.join(d, ".ipc") for d in _app_data_dir_candidates()]

    for port_file in port_files:
        try:
            with open(port_file, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            continue

    raise LiatirBridgeError(
        "Liatir app is not running or IPC not ready. Expected one of:\n"
        + "\n".join("- " + path for path in port_files)
        + "\nStart the Liatir desktop app first."
    )


def _read_dev_context():
    """Mirror of readDevContextFromEnv: active only during `liatir dev`."""
    if os.environ.get("LIATIR_RUN_SCOPE") != "plugin-dev":
        return None
    session_id = (os.environ.get("LIATIR_DEV_SESSION_ID") or "").strip()
    if not session_id:
        return None
    return {
        "scope": "plugin-dev",
        "sessionId": session_id,
        "workspaceId": (os.environ.get("LIATIR_WORKSPACE_ID") or "").strip()
        or SANDBOX_WORKSPACE_ID,
    }


def _http_invoke(ipc, cmd, payload):
    """POST {cmd, payload} to the app's /invoke endpoint and unwrap the result."""
    url = "http://127.0.0.1:{}/invoke".format(ipc["port"])
    body = json.dumps({"cmd": cmd, "payload": payload}).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Authorization", "Bearer " + ipc["token"])
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        raise LiatirBridgeError("HTTP {} for {}".format(exc.code, cmd))
    except urllib.error.URLError as exc:
        raise LiatirBridgeError("cannot reach Liatir app for {}: {}".format(cmd, exc.reason))

    data = json.loads(raw)
    if not data.get("ok"):
        raise LiatirBridgeError(data.get("error") or (cmd + " failed"))
    return data.get("result")


def _is_current_dev_job(entry, dev):
    metadata = entry.get("metadata") or {}
    return metadata.get("pluginDevSessionId") == dev["sessionId"]


class _Jobs:
    """Async process manager — spawn/stream/kill any system binary."""

    def __init__(self, bridge):
        self._bridge = bridge

    def _with_dev_spawn(self, kind, metadata):
        # Mirror withDevSpawnOptions: tag spawns so the app can scope them to
        # the current dev session.
        dev = self._bridge._dev
        if not dev:
            return kind, metadata
        new_kind = kind if (kind and kind.startswith("lia-plugin-dev")) else "lia-plugin-dev-child"
        new_metadata = dict(metadata or {})
        new_metadata["pluginDev"] = True
        new_metadata["pluginDevSessionId"] = dev["sessionId"]
        return new_kind, new_metadata

    def spawn(self, cmd, args=None, cwd=None, env=None, label=None, kind=None, metadata=None):
        kind, metadata = self._with_dev_spawn(kind, metadata)
        return self._bridge.invoke("lia_jobs_spawn", _compact({
            "cmd": cmd,
            "args": args or [],
            "cwd": cwd,
            "env": env,
            "label": label,
            "kind": kind,
            "metadata": metadata,
        }))

    def kill(self, job_id):
        return self._bridge.invoke("lia_jobs_kill", {"jobId": job_id})

    def status(self, job_id):
        return self._bridge.invoke("lia_jobs_status", {"jobId": job_id})

    def list(self):
        dev = self._bridge._dev
        if not dev:
            return self._bridge.invoke("lia_jobs_list")
        entries = self._bridge.invoke(
            "lia_jobs_list", {"workspaceId": dev["workspaceId"], "includeDev": True}
        ) or []
        return [entry for entry in entries if _is_current_dev_job(entry, dev)]

    def clear_done(self):
        if self._bridge._dev:
            return 0
        return self._bridge.invoke("lia_jobs_clear_done")

    def get_output(self, job_id, since=None):
        return self._bridge.invoke("lia_jobs_get_output", _compact({"jobId": job_id, "since": since}))

    def run(self, cmd, args=None, cwd=None, on_stdout=None, on_stderr=None):
        """Spawn, poll to exit, and stream output line-by-line (mirror of runJob)."""
        spawned = self.spawn(cmd, args or [], cwd=cwd)
        job_id = spawned["jobId"]
        stdout_offset = 0
        stderr_offset = 0
        while True:
            time.sleep(0.1)
            out = self.get_output(job_id)
            entry = self.status(job_id)
            for line in out["stdout"][stdout_offset:]:
                if on_stdout:
                    on_stdout(line)
            for line in out["stderr"][stderr_offset:]:
                if on_stderr:
                    on_stderr(line)
            stdout_offset = out["stdoutTotal"]
            stderr_offset = out["stderrTotal"]
            if entry["status"]["type"] != "running":
                return entry


class _Deps:
    """Check whether external binaries are available on the host."""

    def __init__(self, bridge):
        self._bridge = bridge

    def check(self, binary):
        return self._bridge.invoke("lia_deps_check", {"binary": binary})

    def check_many(self, binaries):
        return self._bridge.invoke("lia_deps_check_many", {"binaries": binaries})


class _Log:
    """Structured logging — entries are tagged with the job ID and streamed to the Jobs UI.

    Mirrors the Node `Liatir.log` builder: same `lia_plugin_log` command and
    camelCase payload keys (jobId/level/message/meta).
    """

    def __init__(self, bridge, job_id):
        self._bridge = bridge
        self._job_id = job_id

    def _send(self, level, message, meta=None):
        return self._bridge.invoke("lia_plugin_log", _compact({
            "jobId": self._job_id,
            "level": level,
            "message": message,
            "meta": meta,
        }))

    def info(self, message, meta=None):
        return self._send("info", message, meta)

    def warn(self, message, meta=None):
        return self._send("warn", message, meta)

    def error(self, message, meta=None):
        return self._send("error", message, meta)

    def debug(self, message, meta=None):
        return self._send("debug", message, meta)


class _Progress:
    """Progress tracking — updates are streamed to the Jobs UI.

    Mirrors the Node `Liatir.progress` builder: same `lia_plugin_progress`
    command. `advance` sends a `delta`, `update` an absolute `current`; optional
    keys are dropped (via _compact) so they reach Rust as "not provided".
    """

    def __init__(self, bridge, job_id):
        self._bridge = bridge
        self._job_id = job_id

    def start(self, total, label=None):
        return self._bridge.invoke("lia_plugin_progress", _compact({
            "jobId": self._job_id, "current": 0, "total": total, "label": label,
        }))

    def advance(self, n=1, label=None):
        return self._bridge.invoke("lia_plugin_progress", _compact({
            "jobId": self._job_id, "delta": n, "label": label,
        }))

    def update(self, current, label=None):
        return self._bridge.invoke("lia_plugin_progress", _compact({
            "jobId": self._job_id, "current": current, "label": label,
        }))

    def done(self):
        return self._bridge.invoke("lia_plugin_progress", {
            "jobId": self._job_id, "done": True,
        })


class _FsScope:
    """One filesystem scope (.data = permanent, .cache = ephemeral)."""

    def __init__(self, bridge, permanent, plugin=None):
        self._bridge = bridge
        self._permanent = permanent
        self._plugin = plugin or None

    def _payload(self, extra):
        base = {"permanent": self._permanent, "windowLabel": None, "pluginStoragePlugin": self._plugin}
        base.update(extra)
        return _compact(base)

    def list_content(self, rel=""):
        return self._bridge.invoke("lia_fs_list_dir", self._payload({"rel": rel}))

    def new_directory(self, rel):
        return self._bridge.invoke("lia_fs_mkdir", self._payload({"rel": rel}))

    def remove(self, rel, recursive=False):
        return self._bridge.invoke("lia_fs_rm", self._payload({"rel": rel, "recursive": recursive}))

    def stat(self, rel=""):
        return self._bridge.invoke("lia_fs_stat", self._payload({"rel": rel}))

    def write_text(self, rel, contents, create_dirs=None, append=None):
        return self._bridge.invoke("lia_fs_write_text", self._payload({
            "rel": rel, "contents": contents, "createDirs": create_dirs, "append": append,
        }))

    def read_text(self, rel):
        return self._bridge.invoke("lia_fs_read_text", self._payload({"rel": rel}))

    def write_bytes(self, rel, data_base64, create_dirs=None):
        return self._bridge.invoke("lia_fs_write_bytes", self._payload({
            "rel": rel, "dataBase64": data_base64, "createDirs": create_dirs,
        }))

    def read_bytes(self, rel):
        return self._bridge.invoke("lia_fs_read_bytes", self._payload({"rel": rel}))

    def exists(self, rel):
        return self._bridge.invoke("lia_fs_exists", self._payload({"rel": rel}))

    def move(self, src, dest, create_dirs=None, overwrite=None):
        return self._bridge.invoke("lia_fs_move", self._payload({
            "src": src, "dest": dest, "createDirs": create_dirs, "overwrite": overwrite,
        }))

    def copy(self, src, dest, recursive=None, create_dirs=None, overwrite=None):
        return self._bridge.invoke("lia_fs_copy", self._payload({
            "src": src, "dest": dest, "recursive": recursive,
            "createDirs": create_dirs, "overwrite": overwrite,
        }))

    def path(self):
        paths = self._bridge.invoke("lia_fs_paths")
        return paths["data"] if self._permanent else paths["cache"]

    def clear(self):
        return self._bridge.invoke("lia_fs_clear_data" if self._permanent else "lia_fs_clear_cache")


class _FsPluginScope(_FsScope):
    """Isolated per-plugin storage under the permanent scope."""

    def __init__(self, bridge, plugin):
        super().__init__(bridge, True, plugin=plugin)

    def clear_storage(self):
        return self._bridge.invoke("lia_plugin_storage_clear", {"plugin": self._plugin})


class _Fs:
    """App-managed filesystem: .data (permanent), .cache (ephemeral), pluginFs (isolated)."""

    def __init__(self, bridge):
        self._bridge = bridge
        self.cache = _FsScope(bridge, False)
        self.data = _FsScope(bridge, True)

    def plugin_fs(self, plugin):
        name = (plugin or "").strip()
        if not name:
            raise LiatirBridgeError("plugin_fs requires a non-empty plugin name")
        return _FsPluginScope(self._bridge, name)

    def paths(self):
        return self._bridge.invoke("lia_fs_paths")


class _App:
    """App info — read-only runtime information about the Liatir app."""

    def __init__(self, bridge):
        self._bridge = bridge

    def info(self):
        return self._bridge.invoke("lia_app_info")


class _Desktop:
    """Desktop bridge subset available to headless plugins."""

    def __init__(self, bridge):
        self.fs = _Fs(bridge)
        self.app = _App(bridge)


class Liatir:
    """The bridge handed to Python plugins as `ctx.liatir`.

    Same capabilities as the Node `Liatir` object: every namespace forwards to a
    native `lia_*` command over the app's loopback HTTP IPC server. The IPC
    coordinates are resolved lazily on the first call, so plugins that never
    touch the bridge run without requiring the app to be reachable.

    Plugin API surface:
      jobs      — spawn/stream/kill any system binary
      deps      — check whether external binaries are available
      desktop   — fs (data/cache/pluginFs) and app (info)
      log       — structured logging streamed to the Jobs UI
      progress  — progress updates streamed to the Jobs UI
      paths()   — app filesystem paths
      invoke()  — raw escape hatch for any native command
    """

    def __init__(self):
        self._ipc = None
        self._dev = _read_dev_context()
        # The runtime injects the current job's ID; log/progress tag their
        # entries with it (mirrors the Node factory reading LIATIR_JOB_ID).
        self._job_id = os.environ.get("LIATIR_JOB_ID", "unknown")
        self.jobs = _Jobs(self)
        self.deps = _Deps(self)
        self.desktop = _Desktop(self)
        self.log = _Log(self, self._job_id)
        self.progress = _Progress(self, self._job_id)

    def invoke(self, cmd, payload=None):
        """Raw escape hatch: call any native command not covered by a namespace."""
        if self._ipc is None:
            self._ipc = _read_ipc_info()
        if self._dev and payload is not None:
            payload = dict(payload)
            payload[DEV_CONTEXT_PAYLOAD_KEY] = self._dev
        elif self._dev:
            payload = {DEV_CONTEXT_PAYLOAD_KEY: self._dev}
        return _http_invoke(self._ipc, cmd, payload)

    def paths(self):
        """App filesystem paths, rewritten to the sandbox root during `liatir dev`."""
        base = self.invoke("lia_fs_paths") or {}
        if not self._dev:
            return base
        rel = "workspaces/{}/plugin-dev/{}".format(self._dev["workspaceId"], self._dev["sessionId"])
        self.invoke("lia_fs_mkdir", {"rel": rel, "permanent": True})
        self.invoke("lia_fs_mkdir", {"rel": rel, "permanent": False})
        rewritten = dict(base)
        rewritten["data"] = "{}/{}".format(base.get("data"), rel)
        rewritten["cache"] = "{}/{}".format(base.get("cache"), rel)
        rewritten["temp"] = "{}/{}".format(base.get("cache"), rel)
        return rewritten


class PluginContext:
    """What the handler receives: validated input, the raw payload, and the bridge."""

    def __init__(self, validated_input, raw_input):
        self.input = validated_input
        self.raw_input = raw_input
        # The bridge (ctx.liatir) is constructed eagerly but resolves its IPC
        # connection lazily, so it costs nothing until the plugin actually uses it.
        self.liatir = Liatir()


def _type_error(kind, name, expected, value):
    return "{} \"{}\" must be {}, got {}".format(kind, name, expected, type(value).__name__)


def _check_scalar(kind, name, schema, value):
    """Validate one scalar value against a field schema. Returns an error or None."""
    field_type = schema["type"]
    if field_type == "string" or field_type == "file":
        if not isinstance(value, str):
            return _type_error(kind, name, "a string", value)
    elif field_type == "number":
        # bool is an int subclass in Python: reject it explicitly for numbers.
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return _type_error(kind, name, "a number", value)
    elif field_type == "boolean":
        if not isinstance(value, bool):
            return _type_error(kind, name, "a boolean", value)
    return None


def _check_file_output(name, value):
    """File outputs are a path string, {"path": ...} or {"content": ...}."""
    if isinstance(value, str):
        return None
    if isinstance(value, dict):
        if isinstance(value.get("path"), str):
            return None
        if isinstance(value.get("content"), str):
            return None
        return ("output \"{}\" must be a file path string, {{\"path\": ...}} or "
                "{{\"content\": ..., \"fileName\": ...}}").format(name)
    return _type_error("output", name, "a file path string or file object", value)


def _validate_schema(kind, schema, allowed_types):
    if not isinstance(schema, dict):
        raise LiatirContractError("define_plugin {} must be a dict of name -> field.*(...)".format(kind))
    for name, spec in schema.items():
        if not isinstance(name, str) or not name:
            raise LiatirContractError("{} field names must be non-empty strings".format(kind))
        if not isinstance(spec, dict) or "type" not in spec:
            raise LiatirContractError(
                "{} \"{}\" must be declared with liatir.field.* builders".format(kind, name))
        if spec["type"] not in allowed_types:
            raise LiatirContractError(
                "{} \"{}\" has invalid type \"{}\" (allowed: {})".format(
                    kind, name, spec["type"], ", ".join(allowed_types)))
        # A default that does not match its own field type would silently
        # bypass input validation; reject it at declaration time.
        if "default" in spec:
            error = _check_scalar(kind, name, spec, spec["default"])
            if error:
                raise LiatirContractError("invalid default: {}".format(error))


class LiatirMain:
    """The callable Liatir invokes as `main(input)`.

    Wraps the user handler with contract enforcement:
    - validates/normalizes the input payload (defaults, required, types);
    - calls the handler with a PluginContext;
    - validates the returned output against the declared schema.
    """

    # Marker read by `liatir build` and by the extraction script.
    __liatir_plugin__ = True

    def __init__(self, plugin, handler):
        self._plugin = plugin
        self._handler = handler
        self.inputs = plugin.inputs
        self.outputs = plugin.outputs
        # Keep the wrapped callable introspectable (name, docstring).
        self.__name__ = getattr(handler, "__name__", "main")
        self.__doc__ = getattr(handler, "__doc__", None)

    def contract(self):
        """The JSON-safe contract emitted into the manifest by `liatir build`."""
        return {
            "liatirContract": CONTRACT_VERSION,
            "sdkVersion": __version__,
            "language": "python",
            "inputs": self.inputs,
            "outputs": self.outputs,
        }

    def _validate_input(self, payload):
        if payload is None:
            payload = {}
        if not isinstance(payload, dict):
            raise LiatirInputError("plugin input must be a JSON object")

        unknown = [key for key in payload.keys() if key not in self.inputs]
        if unknown:
            # Unknown keys are dropped, not fatal: hosts may add bookkeeping
            # fields, and typos surface as "missing required input" instead.
            print("[liatir] ignoring input keys not in the contract: "
                  + ", ".join(sorted(unknown)), file=sys.stderr)

        validated = {}
        errors = []
        for name, schema in self.inputs.items():
            value = payload.get(name)
            if value is None:
                if "default" in schema:
                    validated[name] = schema["default"]
                    continue
                if schema.get("required"):
                    errors.append("missing required input \"{}\"".format(name))
                    continue
                validated[name] = None
                continue
            error = _check_scalar("input", name, schema, value)
            if error:
                errors.append(error)
                continue
            validated[name] = value

        if errors:
            raise LiatirInputError("; ".join(errors))
        return validated

    def _validate_output(self, result):
        if not isinstance(result, dict):
            raise LiatirOutputError(
                "the handler must return a dict matching the declared outputs, got {}".format(
                    type(result).__name__))

        errors = []
        for name in result.keys():
            if name not in self.outputs:
                errors.append("output \"{}\" is not declared in the contract".format(name))

        for name, schema in self.outputs.items():
            if name not in result or result[name] is None:
                if schema.get("required"):
                    errors.append("missing required output \"{}\"".format(name))
                continue
            value = result[name]
            field_type = schema["type"]
            if field_type == "file":
                error = _check_file_output(name, value)
            elif field_type == "stats":
                error = None if isinstance(value, dict) else _type_error(
                    "output", name, "a stats object (dict with sections)", value)
            elif field_type == "json":
                error = None
            else:
                error = _check_scalar("output", name, schema, value)
            if error:
                errors.append(error)

        if errors:
            raise LiatirOutputError("; ".join(errors))

        try:
            json.dumps(result)
        except (TypeError, ValueError) as exc:
            raise LiatirOutputError("output is not JSON-serializable: {}".format(exc))
        return result

    def __call__(self, payload=None):
        ctx = PluginContext(self._validate_input(payload), payload)
        result = self._handler(ctx)
        if inspect.isawaitable(result):
            # Liatir's runner awaits awaitable results, so hand it a coroutine
            # that still validates the output after the await completes.
            return self._finish_async(result)
        return self._validate_output(result)

    async def _finish_async(self, awaitable):
        return self._validate_output(await awaitable)


class LiatirPlugin:
    """The declared contract. Finish it with @plugin.main on your handler."""

    __liatir_plugin_contract__ = True

    def __init__(self, inputs, outputs):
        _validate_schema("inputs", inputs, INPUT_FIELD_TYPES)
        _validate_schema("outputs", outputs, OUTPUT_FIELD_TYPES)
        self.inputs = inputs
        self.outputs = outputs

    def main(self, handler):
        if not callable(handler):
            raise LiatirContractError("@plugin.main must decorate a callable handler")
        return LiatirMain(self, handler)


def define_plugin(inputs=None, outputs=None):
    """Define a Liatir Python plugin contract.

    Declare inputs/outputs once with `field.*`: the manifest schema is
    generated from them by `liatir build`, and runs are validated both ways.

        from liatir import define_plugin, field

        plugin = define_plugin(
            inputs={"text": field.string(label="Text", required=True)},
            outputs={"length": field.number(label="Length", format="integer")},
        )

        @plugin.main
        def main(ctx):
            return {"length": len(ctx.input["text"])}
    """
    return LiatirPlugin(inputs or {}, outputs or {})