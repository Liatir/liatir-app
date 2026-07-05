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
# Docs: https://liatir.com/docs/plugins

import inspect
import json
import sys

__version__ = "0.1.0"

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


class PluginContext:
    """What the handler receives: validated input plus the raw payload."""

    def __init__(self, validated_input, raw_input):
        self.input = validated_input
        self.raw_input = raw_input


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
