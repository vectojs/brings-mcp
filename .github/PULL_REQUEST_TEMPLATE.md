## Summary

Describe the MCP capability, local-file impact, and any protocol compatibility change.

## Verification

- [ ] `bun run verify`
- [ ] JSON-RPC stdio smoke test for an affected tool

## Checklist

- [ ] README and CHANGELOG reflect user-visible tool changes.
- [ ] Tool input validation is explicit and no credentials or user documents are committed.
- [ ] Mutation behavior is backed by a versioned Brings Core command.
