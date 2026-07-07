---
title: deps.checkMany
description: Checks several command-line dependencies at once.
---

# .deps.checkMany

`Liatir.deps.checkMany()` checks several command-line binaries at once.

## Signature

<Tabs>
<Tab title="Node">

```ts
checkMany(binaries: string[]): Promise<DepCheckResult[]>
```

</Tab>
<Tab title="Python">

```python
check_many(binaries) -> list[dict]
```

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const deps = await Liatir.deps.checkMany(['samtools', 'bcftools', 'fastqc']);

deps.forEach(dep => {
  console.log(`${dep.binary}: ${dep.available ? '✓' : '✗'}`);
});
```

</Tab>
<Tab title="Python">

```python
deps = ctx.liatir.deps.check_many(['samtools', 'bcftools', 'fastqc'])

for dep in deps:
    print(f"{dep['binary']}: {'✓' if dep['available'] else '✗'}")
```

</Tab>
</Tabs>

## DepCheckResult

Each element in the returned array is a `DepCheckResult` object. See [`.deps.check`](./check.md#depcheckresult) for the full structure.

## Notes

Use this method when a workflow needs several external tools and you want to
show one dependency report to the user.