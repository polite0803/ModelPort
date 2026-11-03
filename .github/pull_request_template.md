## Summary

<!-- What problem does this change solve, and why is this the right fix? -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] Build / CI
- [ ] Other

## Related issue

<!-- Closes #... or links to the discussion that motivated this change. -->

## Verification

- [ ] `npm run gate` passes locally (build + both `tsc --noEmit` programs + full test suite)
- [ ] I did not modify tests or the gate just to make CI green
- [ ] Manual verification, if applicable:

<!-- Describe the scenario you exercised and the observed result. -->

## Checklist

- [ ] The change stays within the files it needs to touch
- [ ] The gateway still authors no prompt text (no injected system/user turns or rewritten content)
- [ ] Generated sidecars (`src/shared/aggregateQuota.ts`, `aggregatePricing.ts`,
      `aggregateCapabilities.ts`) were regenerated from `docs/data/**`, not hand-edited
- [ ] User-visible behavior or configuration changes are reflected in the documentation
- [ ] No credentials, API keys, tokens, `data.json`, build output or local scratch files are included
