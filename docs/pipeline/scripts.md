# Python Scripts

Scripts are small pieces of Python code saved in a workspace. Use them to
transform values or files without building a `.lia` Plugin. They can run on
their own or as pipeline steps.

## Create and run

1. Open **Scripts** in the sidebar and choose **New script**.
2. Under **Inputs** and **Outputs**, add the fields your script needs. A new
   script starts with none. Give each field a short name used in the code (for
   example `my_variable`), a kind (text, number, yes/no, file, and for outputs
   also structured data or summary numbers), an optional label and a required
   flag.
3. Write your code inside `main(ctx)`, where the starting code says
   *Write your code here...*. Read an input with `ctx.input["my_variable"]` and
   end by returning your outputs by name, for example `return {"my_result": 42}`.
4. Type a value for each input under **Test values**, then choose **Save and
   run**. Test values are used only for this try; in a pipeline the inputs come
   from the pipeline. Progress and logs appear on the page and in Jobs;
   completed, failed and cancelled runs are recorded in Results.

For a numeric input named `value` and a numeric output named `doubled`:

```python
def main(ctx):
    return {"doubled": ctx.input["value"] * 2}
```

Liatir wraps this function with the same Python SDK used by Plugins. The input
and output contracts are mandatory, including when explicitly empty. Missing
required values, incorrect types and undeclared outputs fail visibly rather
than passing invalid data to the next pipeline step. Python syntax is checked
before the source module is imported.

## Python packages and files

List any extra packages the script imports under **Python packages**, one per
line, for example `pandas` or `numpy>=1.26`. Liatir installs them once, on
demand, in a managed Python environment shared with Plugins that need the same
packages. A script that uses only Python itself needs nothing. Only package names
are accepted: installer options such as an alternative package index are refused.

File inputs are local paths. Each execution has its own durable working directory;
relative output paths are resolved there, so separate runs do not overwrite one
another. A file output can return a path to an existing file,
or an object such as `{"content": "value\n7\n", "fileName": "values.csv"}`.

Scripts execute ordinary local Python, with the same operating-system access as
Python Plugins. They are not isolated like Quenta presentations: run code you trust.

## Reuse and history

**Export .py** in the editor saves the script's Python code as a `.py` file, for
example to share it or keep a copy. The file holds the code only: inputs,
outputs and packages are part of the script in Liatir.

Saved scripts appear under **Scripts** in the pipeline's step menu. Connect their
declared outputs to compatible inputs. Each execution keeps a copy of its code,
contracts and package list in its own run folder, and the Job records the exact
installed package versions. Editing a saved script does not change an execution
already begun. The copy lives with the run's other files.

Scripts belong to one workspace. **Copy to workspace** creates a new independent
script in another workspace, without copying execution history or Results. Later
edits do not propagate between copies.

Earlier JavaScript scripts remain under **Older JavaScript scripts** on the
Scripts page, for reading and export. They are not run or automatically
translated to Python.
