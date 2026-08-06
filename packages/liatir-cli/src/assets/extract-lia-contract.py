# Contract extraction for Python .lia plugins — internal to @liatir/cli.
#
# Usage: python extract-lia-contract.py <entry_path> <sdk_dir>
#
# Imports the plugin entry module the same way the Liatir runtime does and
# prints one of:
#   __LIATIR_CONTRACT__{json}   the module's main is SDK-wrapped (define_plugin)
#   __LIATIR_LEGACY__           the module has a plain callable main(input)
#
# Third-party imports that are not installed at build time are stubbed so the
# module can be imported to read its contract; the stub only has to survive
# module-level code, the real dependency is installed by Liatir at run time.

import importlib.abc
import importlib.util
import json
import pathlib
import sys

CONTRACT_MARKER = "__LIATIR_CONTRACT__"
LEGACY_MARKER = "__LIATIR_LEGACY__"
STUBBED_MARKER = "__LIATIR_STUBBED__"

_stubbed_modules = set()


class _StubValue:
    """Inert placeholder produced by stubbed imports at module import time."""

    def __init__(self, origin):
        self._origin = origin

    def __getattr__(self, name):
        return _StubValue(self._origin)

    def __call__(self, *args, **kwargs):
        return _StubValue(self._origin)

    def __getitem__(self, key):
        return _StubValue(self._origin)

    def __iter__(self):
        return iter(())

    def __repr__(self):
        return "<liatir build stub for {!r}>".format(self._origin)


class _StubLoader(importlib.abc.Loader):
    def __init__(self, name):
        self._name = name

    def create_module(self, spec):
        module = type(sys)(spec.name)
        module.__getattr__ = lambda attr: _StubValue("{}.{}".format(spec.name, attr))
        module.__path__ = []
        return module

    def exec_module(self, module):
        _stubbed_modules.add(self._name.split(".")[0])


class _StubFinder(importlib.abc.MetaPathFinder):
    """Last-resort finder: stub anything the real finders cannot resolve."""

    def find_spec(self, fullname, path=None, target=None):
        # Never stub the SDK itself: a missing liatir module is a real error
        # that must surface as an ImportError, not fake its way to a contract.
        if fullname.split(".")[0] == "liatir":
            return None
        return importlib.util.spec_from_loader(fullname, _StubLoader(fullname))


def _fail(message, code=1):
    print("[liatir] {}".format(message), file=sys.stderr)
    sys.exit(code)


def main():
    if len(sys.argv) < 3:
        _fail("usage: extract-lia-contract.py <entry_path> <sdk_dir>", 2)

    entry_path = pathlib.Path(sys.argv[1]).resolve()
    sdk_dir = pathlib.Path(sys.argv[2]).resolve()
    if not entry_path.is_file():
        _fail("Python plugin entry not found: {}".format(entry_path), 2)

    # Mirror the runtime import context: entry directory first, project root
    # next. The CLI's SDK directory goes last so a local liatir.py wins.
    sys.path.insert(0, str(entry_path.parent.parent))
    sys.path.insert(0, str(entry_path.parent))
    sys.path.append(str(sdk_dir))
    sys.meta_path.append(_StubFinder())

    spec = importlib.util.spec_from_file_location("_liatir_python_plugin", entry_path)
    if spec is None or spec.loader is None:
        _fail("cannot load Python plugin entry: {}".format(entry_path))
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:  # surfaced as a build error with full context
        import traceback
        traceback.print_exc(file=sys.stderr)
        _fail("importing {} failed: {}".format(entry_path.name, exc))

    handler = getattr(module, "main", None)
    if handler is None:
        _fail(
            "the plugin entry must define main — declare the contract with "
            "`from liatir import define_plugin, field` and finish with @plugin.main",
            3,
        )

    if not getattr(handler, "__liatir_plugin__", False):
        if callable(handler):
            # Plain main(input) without the SDK: legacy plugin, the manifest
            # still owns the schema.
            print(LEGACY_MARKER)
            return
        _fail("main must be callable (found {})".format(type(handler).__name__), 3)

    try:
        contract = handler.contract()
        payload = json.dumps(contract)
    except Exception as exc:
        hint = ""
        if _stubbed_modules:
            hint = (
                " The contract contains values from imports not installed at build time ({});"
                " keep define_plugin(...) free of third-party values and move heavy work"
                " inside the handler.".format(", ".join(sorted(_stubbed_modules)))
            )
        _fail("cannot serialize the plugin contract: {}.{}".format(exc, hint))
        return

    print(CONTRACT_MARKER + payload)
    if _stubbed_modules:
        # Informative: lets `liatir build` show which imports were assumed to
        # exist at run time, so typo'd module names are visible at build time.
        print(STUBBED_MARKER + ",".join(sorted(_stubbed_modules)))


if __name__ == "__main__":
    main()
