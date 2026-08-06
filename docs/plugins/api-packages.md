# Liatir API packages

- **Node plugins** use `@liatir/api` Node module as typed API entry point, based on a shared `define_plugin` contract;

- **Python and WASM plugins** use the same `define_plugin` contract, but not as a
package: the CLI scaffolds a single managed module (`src/liatir.py` /
`src/liatir.rs`) into the project and `liatir build` keeps it in sync — there
is nothing to install or update separately. 


<center>
<small>

Check out the [Liatir plugin context guide](/plugins/plugin-context)

</small>
</center>

## Related

- [Plugin context](/plugins/plugin-context)
- [Plugin authoring](/plugins/define-plugin)
- [Declaring fields](/plugins/field)
- [Desktop API](/plugins/api/desktop/app)
- [Jobs API](/plugins/api/jobs/spawn)
- [Dependencies API](/plugins/api/deps/check)