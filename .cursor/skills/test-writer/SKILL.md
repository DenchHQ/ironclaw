---
name: test-writer
description: Write effective tests that verify real behavior, not just easily-testable surface area. Use when asked to add tests, improve test coverage, or verify correctness of a feature. Core approach - (1) identify the actual behavior that matters (security invariants, business rules, decision logic), (2) refactor implementations to extract testable decision logic from I/O when needed, (3) write tests that name the threat or invariant they protect, (4) verify test quality by breaking the code under test and confirming failures. Triggers on requests like "add tests", "write tests", "test coverage", "verify this works", "make sure this is correct".
---

# Test Writer

Write tests that protect real behavior. Do not test what is trivially observable from reading the code.

The level of appropriate coverage differs for different types of code:

- **Core infrastructure** (auth, permissions, data access, security controls): aim for 100% coverage of all security invariants and edge cases, verified via mutation testing.
- **Business logic** (approval workflows, state machines, complex transformations): aim for coverage of expected behavior and edge cases that represent real failure modes, verified via mutation testing of critical paths.
- **UI components**: aim for coverage of critical user flows and edge cases that cause real bugs, not just snapshot tests of rendering.
- **Utility functions** (formatting, simple transformations): coverage is nice but not critical, unless the behavior is non-obvious or has edge cases. Focus on testing the business rules that use these utilities rather than the utilities themselves.
- **Bug fixes**: write a test that reproduces the bug before the fix ("regression testing"). This ensures the bug is actually fixed and prevents regressions. Write tests on similar and adjacent code paths to cover related logic that may have similar issues (e.g. if a bug was caused by incorrect handling of null values, write tests for other functions that handle nulls in similar ways).

## Process

### 1. Identify core behavior

Read the code under test. Identify:

- **Security invariants** (authorization checks, input validation, privilege boundaries, tenant isolation)
- **Business rules** (approval workflows, state machines, conditional logic)
- **Decision logic** (branching, prioritization, conflict resolution)
- **Data transformations** with non-obvious edge cases

Skip testing: default values, simple getters, type definitions, trivially-correct wiring.

### 2. Extract testable logic when needed

If the core behavior is buried inside I/O-coupled functions (database calls, API requests, file system), **refactor to extract it** rather than mocking. See [references/extraction-patterns.md](references/extraction-patterns.md) for patterns.

The goal: pure functions that take data as input, return decisions as output. The original function becomes an orchestrator that fetches data, calls the decision function, then acts on the result.

**Do not skip this step.** Testing only the easily-testable surface (utility functions, config schemas) while leaving core logic untested is the most common failure mode.

### 3. Write tests that name what they protect

Each test name should state the invariant or threat it guards against:

```typescript
// Good: names the threat
it("rejects when SSO account is linked to a different user (prevents cross-user linking)");
it("filters out records when incorrect permissions are present (enforces least privilege)");
it("rejects when provider org doesn't match target org (cross-org attack)");

// Bad: describes the mechanism
it("returns free-trial status");
it("filters array");
it("checks organization ID");
```

### 4. Cover edge cases that matter

Focus primarily on edges that represent real failure modes:

- **Case sensitivity** in identifiers (emails, slugs, provider IDs)
- **Empty vs null vs undefined** when the distinction affects behavior
- **Boundary conditions** in approval workflows (pending/approved/rejected transitions)
- **Ordering and priority** when multiple sources of truth exist
- **Concurrent/conflicting state** (multiple approved requests, race conditions)

Do not write edge case tests for scenarios that cannot occur in practice.
Do not reencode business rules or logic in tests - test the rules as they are, not as you wish they were.

### 5. De-flake integration-style tests

If a test touches the network, database, filesystem, or time, it's at risk of flakiness. See [references/flaky-tests.md](references/flaky-tests.md) for common causes and fixes.

Before moving on, run integration-style tests many times to verify they're stable:

```bash
for i in {1..20}; do pnpm vitest run path/to/test.ts || { echo "FAILED on run $i"; break; }; done
```

If a test is hard to stabilize, that's a signal to extract the decision logic into a pure function and test that instead.

### 6. Verify tests via mutation

After all tests pass, systematically break the code under test:

1. Pick a security-critical or business-critical code path
2. Break it (remove a check, invert a condition, skip a filter)
3. Run the tests - confirm at least one fails
4. Revert the break
5. Repeat for each critical path

If breaking the code does not cause a test failure, the test suite has a gap. Add the missing test, then continue.

Document which mutations were tested and how many tests caught each one. Print out the test coverage report and confirm that critical paths are covered.

## Test structure

```typescript
// Group by the function or decision being tested
describe("computeRecords", () => {
  // Test the security invariant
  it("filters out records when incorrect permissions are present (enforces least privilege)", () => {
    const result = computeRecords(userPermissions, records);
    expect(result).not.toContain(records[0]); // record only accessible to admins, user is not admin
  });

  // Test the business rule
  it("returns empty array when access is restricted, even if permissions configured", () => {
    const result = computeRecords(restrictedUserPermissions, records);
    expect(result).toEqual([]);
  });
});
```

## Anti-patterns

- **Testing defaults and types**: `expect(result.enabled).toBe(false)` on a Zod schema default adds no value. Test the validation rules that enforce business logic.
- **Mocking everything**: If a test mocks the database, the HTTP layer, and the config, it's testing the mock setup, not the code. Extract the logic instead.
- **One assertion per test (cargo cult)**: Multiple related assertions in one test are fine when they verify facets of the same behavior.
- **Testing the framework**: Don't test that Zod validates strings or that React renders components. Test your logic that uses them.
- **"Should work" tests**: `it("should work correctly")` - if you can't name what breaks if this test is removed, delete it.
- **Overly broad tests**: `it("tests the whole module")` - too vague to be useful. Focus on specific behaviors.
- **Copying implementation logic into tests**: Tests should verify behavior, not reimplement it. If you find yourself duplicating logic in tests, reconsider the test design.
