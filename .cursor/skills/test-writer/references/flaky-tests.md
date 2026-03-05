# Flaky Tests

How to identify, diagnose, and fix tests that pass sometimes and fail sometimes.

## Common causes in this codebase

### 1. Time-dependent logic without frozen clocks

Tests that depend on `new Date()` or `Date.now()` are inherently flaky because results change depending on when they run.

**Fix**: Use `vi.useFakeTimers()` and `vi.setSystemTime()` to pin the clock:

```typescript
// From packages/shared-iso/src/__tests__/trial-state.test.ts
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("returns pilot when whitelisted and team trial is active", () => {
  vi.setSystemTime(new Date(2025, 6, 10, 12, 0, 0));
  const result = computeTrialState({
    hasActiveSeat: false,
    trialStartDate: null,
    isWhitelistedDomain: true,
    pilotEndDate: new Date("2025-07-15T12:00:00.000Z"),
  });
  expect(result.status).toBe("pilot");
});
```

**Warning signs**: Tests that use relative dates like `new Date()` in assertions, or tests that pass during the workday but fail at midnight/month boundaries.

### 2. Test order dependence (shared mutable state)

Tests that modify shared state (module-level variables, singletons, environment variables) can pass in isolation but fail when run with other tests.

**Fix**: Reset state in `beforeEach`/`afterEach`:

```typescript
beforeEach(() => {
  vi.restoreAllMocks();
});
```

**Diagnosis**: Run the failing test in isolation (`pnpm vitest run path/to/test.ts -t "test name"`). If it passes alone but fails in the full suite, it's order-dependent.

### 3. Async race conditions

Tests that don't properly await async operations can produce intermittent failures.

**Warning signs**: Tests that fail with "expected X but received undefined", or assertions on state that hasn't been updated yet.

**Fix**: Always `await` async operations. Use `vi.waitFor()` or `expect.poll()` for eventually-consistent checks rather than arbitrary `setTimeout` delays.

### 4. Floating-point and boundary arithmetic

Date calculations that use day arithmetic can produce off-by-one errors depending on timezone and time of day.

**Warning signs**: Tests that fail around midnight UTC, or that produce results like 13.999999 instead of 14.

**Fix**: Pin times to noon UTC (as `pilotEndDate` does in this codebase) and use `Math.ceil`/`Math.floor` explicitly rather than relying on implicit truncation.

## Diagnosing a flaky test

1. **Reproduce**: Run the test 10+ times (`for i in {1..10}; do pnpm vitest run path/to/test.ts; done`). If it doesn't fail, try running the full suite instead of the single file.
2. **Isolate**: Run the single test file alone vs. with the full suite. If it only fails in the full suite, it's order-dependent.
3. **Check the clock**: If the test involves dates/times, check if the failure correlates with time of day or day of month.
4. **Check for shared state**: Look for module-level variables, `process.env` mutations, or singleton patterns that tests might be sharing.
5. **Check async**: Look for missing `await`, fire-and-forget promises, or `setTimeout` used as a synchronization mechanism.

## Flakiness as a design signal

If a test is hard to de-flake, that's often a sign it's too integration-y — it's testing too many things at once through too many layers. Before adding retries or sleeps, ask whether the test should exist in its current form.

The fix is usually the same as the extraction pattern: pull the decision logic out of the I/O-heavy code path and test the decision directly. The integration-level test that was flaky might not even be needed once the core logic has proper unit coverage.

**Rule of thumb**: If you're writing a new test and it touches the network, database, or filesystem, first try to de-flake it by extracting the logic you actually care about into a pure function. Only write the integration-style test if you genuinely need to verify the wiring, and accept that it may need more careful setup/teardown.

**Verify stability**: After writing or fixing an integration-style test, run it many times to confirm it's not flaky before moving on:

```bash
# Run a single test file 20 times to check for flakiness
for i in {1..20}; do
  if ! pnpm vitest run path/to/test.ts; then
    echo "FAILED on run $i"
    break
  fi
done
```

If it fails even once, don't ship it — diagnose and fix the root cause first.

## Prevention

- Always freeze time in tests that involve dates
- Reset all mocks in `afterEach`
- Don't rely on test execution order
- Avoid `setTimeout`/`sleep` for synchronization — use proper async primitives
- Use deterministic test data, not random or time-based values
- Prefer testing extracted decision logic over testing through I/O layers
