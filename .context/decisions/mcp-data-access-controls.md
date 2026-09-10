# MCP Data access controls

Decided while making the MCP file permissions usable at real workspace sizes.
The original Settings surface offered one Allow/Revoke button per registered
file in a scrollable list, with no filter and no bulk action: correct, and
unusable past a few dozen files.

## Decision

Four controls govern which registered files a local MCP client may read.

1. **A filter over the file list.** Purely visual; it changes nothing about
   permissions and needs no confirmation.
2. **Bulk allow over the filtered list**, labelled with the exact number of
   files it will allow and confirmed before it runs. The action is bound to what
   the user is looking at, so "allow everything" is always a bounded, visible
   set rather than a blanket.
3. **Revoke all Data access**, clearing every file grant and every folder grant
   in the active workspace in one write. Removing authority is always offered
   and never filtered: a panic button that only half fires is worse than none.
   It deliberately does not touch the separate workspace Result grant, which has
   its own control and its own meaning.
4. **A folder grant**: standing access to one named Data folder and everything
   nested under it, including files added later.

Both bulk operations are a single native command, a single atomic configuration
write and a single audit record — not N repetitions of the per-file command.

## What was rejected

**A global "allow new files by default" toggle.** It was the original proposal
and it is the one control that must not exist. It grants authority over files
that do not exist yet and that the user has not seen, so a dataset dropped into
Data tomorrow becomes readable by an external process with no decision taken and
— worse — no decision *event*: the audit index would hold no `data-file-allowed`
record, because nobody allowed anything. It converts explicit consent into
standing consent over an unbounded future set, which is precisely the property
the MCP boundary exists to deny.

The folder grant replaces it. It offers the same convenience — new files in a
known place work without another click — but the scope is named, chosen,
visible in Settings, revocable in one action, and recorded in the audit as
`data-folder-allowed`.

**A grant on the Data root.** Rejected for the same reason: with nested coverage
it is the rejected global toggle wearing a folder's name. Only a named folder is
grantable; the root is not.

**Distinguishing folder-granted files in the client-visible artifact
descriptor.** A folder grant and a per-file grant carry the same authority, so
both stay `access: "data-grant"`. How the user granted access is Liatir's
business, not the client's.

**Per-file audit records for a bulk action.** The audit index is capped at 1,000
records; one click that allows 300 files must not erase the history it belongs
to. A bulk action writes one record carrying the count, plus the artifact
identities while the list is short enough to stay readable.

## Consequences

- `Results` is never covered by a folder grant. Result readability is the
  separate workspace Result grant, and the exclusion is enforced in Rust, not
  only in the UI filter that used to be its only expression.
- The rule that decides which files a folder grant covers is exported from
  `packages/liatir-core` and mirrored in Rust, so the Settings list and the
  server cannot disagree about what was granted.
- A revoked folder denies waiting authorization requests whose inputs are no
  longer readable, exactly as revoking a single file already did.

## Records

- [Controlled local MCP boundary](../truth/architecture/mcp.md) — the boundary
  these controls administer.
