"""Run an unpackaged script through the same mandatory SDK as Python Plugins."""
import ast
import asyncio
import importlib.util
import inspect
import json
import os
import pathlib
import sys

source = pathlib.Path(__file__).with_name("main.py")
ast.parse(source.read_text(encoding="utf-8"), filename="main.py")
os.chdir(os.environ["LIATIR_SCRIPT_OUTPUT_DIR"])
sys.path.insert(0, str(source.parent))
from liatir import LiatirMain, define_plugin

snapshot = json.loads(source.with_name("snapshot.json").read_text(encoding="utf-8"))
spec = importlib.util.spec_from_file_location("_liatir_script", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
candidate = getattr(module, "main", None)
if not callable(candidate):
    raise TypeError("Define main(ctx) in your Python script.")
sdk_main = isinstance(candidate, LiatirMain)
if sdk_main:
    contract = candidate.contract()
    if contract["inputs"] != snapshot["inputSchema"] or contract["outputs"] != snapshot["outputSchema"]:
        raise ValueError("The code contract differs from the saved input/output contract.")
# An outer SDK wrapper validates every result, even for decorated handlers.
# A user-supplied marker must never be sufficient to bypass the contract.
handler = define_plugin(inputs=snapshot["inputSchema"], outputs=snapshot["outputSchema"]).main(
    lambda ctx: candidate(ctx.input) if sdk_main else candidate(ctx)
)
payload = json.load(sys.stdin)
result = handler(payload)
if inspect.isawaitable(result):
    result = asyncio.run(result)
# Relative output paths refer to this run's durable working directory.
for key, field in snapshot["outputSchema"].items():
    if field["type"] != "file" or result.get(key) is None:
        continue
    value = result[key]
    if isinstance(value, str):
        result[key] = str(pathlib.Path(value).resolve())
    elif isinstance(value, dict) and isinstance(value.get("path"), str):
        result[key] = dict(value, path=str(pathlib.Path(value["path"]).resolve()))
print("__LIATIR_RESULT__" + json.dumps(result, allow_nan=False))
