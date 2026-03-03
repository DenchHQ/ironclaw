# CLI Edge Case Matrix

This matrix defines exhaustive CLI edge-case coverage by behavior/invariant.
It is intentionally user-facing: exit codes, stderr/stdout semantics, and
argument/env handling are treated as contract.

## Invariants

- Argument parsing is deterministic across equivalent forms.
- Safety gates (delegation loops, profile validation, migration guards) fail
  closed with clear user guidance.
- Cross-platform normalization does not alter user intent.
- IO failures are actionable and do not leave ambiguous state.

## Edge Matrix

| Module                  | Edge Case                                                                | Invariant Protected                                                                                     | Test File                                                         |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `argv.ts`               | `--` terminator handling                                                 | Flags after terminator are ignored for root parsing decisions                                           | `src/cli/argv.test.ts` (new)                                      |
| `argv.ts`               | `--profile` missing/empty/equals forms                                   | Missing value returns `null`/`undefined` exactly as designed; invalid values are not coerced            | `src/cli/argv.test.ts` (new)                                      |
| `argv.ts`               | Positive int flag parsing (`0`, negative, NaN)                           | Invalid positive-int values are rejected without accidental fallback                                    | `src/cli/argv.test.ts` (new)                                      |
| `argv.ts`               | Root `-v` alias vs command path                                          | Root version alias is honored only in root-flag contexts, never when a command path is present          | `src/cli/argv.test.ts` (new)                                      |
| `argv.ts`               | `buildParseArgv` runtime forms (`node`, `node-XX`, `bun`, direct binary) | Parse argv bootstrap is stable across runtimes and executable names                                     | `src/cli/argv.test.ts` (new)                                      |
| `argv.ts`               | `shouldMigrateState` exemptions                                          | Read-only/status commands never trigger migration path                                                  | `src/cli/argv.test.ts` (new)                                      |
| `run-main.ts`           | bootstrap cutover rollout stages                                         | `legacy` always disables cutover, `beta` requires explicit opt-in, `default/internal` enable by default | `src/cli/run-main.test.ts` (existing, expand)                     |
| `run-main.ts`           | delegation disabled flags                                                | Delegation is off when disable env is truthy in either namespace                                        | `src/cli/run-main.test.ts` (existing, expand)                     |
| `run-main.ts`           | delegation loop prevention                                               | Delegation loop env markers hard-stop with explicit error                                               | `src/cli/run-main.test.ts` (existing, expand)                     |
| `run-main.ts`           | `shouldEnsureCliPath` command carve-outs                                 | Health/status/read-only commands skip path mutations                                                    | `src/cli/run-main.test.ts` (existing, expand)                     |
| `profile-utils.ts`      | profile name normalization                                               | Only valid profile names are accepted; normalization is idempotent                                      | `src/cli/profile-utils.test.ts` (new)                             |
| `profile.ts`            | `--dev` + `--profile` conflict                                           | Conflict is rejected with non-zero outcome and actionable error text                                    | `src/cli/profile.test.ts` (new)                                   |
| `profile.ts`            | explicit profile propagation                                             | Parsed profile and env output are stable regardless of option ordering                                  | `src/cli/profile.test.ts` (new)                                   |
| `windows-argv.ts`       | control chars and duplicate exec path                                    | Normalization removes terminal control noise while preserving args                                      | `src/cli/windows-argv.test.ts` (new)                              |
| `windows-argv.ts`       | quoted executable path stripping                                         | Windows executable wrappers are normalized without dropping real args                                   | `src/cli/windows-argv.test.ts` (new)                              |
| `respawn-policy.ts`     | help/version short-circuit                                               | Help/version always bypass respawn behavior                                                             | `src/cli/respawn-policy.test.ts` (new)                            |
| `cli-name.ts`           | cli name resolution/replacement                                          | Name replacement only targets intended CLI token boundaries                                             | `src/cli/cli-name.test.ts` (new)                                  |
| `ports.ts`              | malformed `lsof` lines                                                   | Port parser tolerates malformed rows and only returns valid process records                             | `src/cli/ports.test.ts` (new)                                     |
| `cli-utils.ts`          | runtime command failure path                                             | Command failures return deterministic non-zero exit behavior                                            | `src/cli/cli-utils.test.ts` (new)                                 |
| `bootstrap-external.ts` | auth profile mismatch/missing                                            | Missing or mismatched provider auth fails with remediation                                              | `src/cli/bootstrap-external.test.ts` (existing)                   |
| `bootstrap-external.ts` | onboarding/gateway auto-fix workflow                                     | Bootstrap command executes expected fallback sequence and reports recovery outcome                      | `src/cli/bootstrap-external.bootstrap-command.test.ts` (existing) |

## Exit/Output Contract Checks

Each command-level scenario above must assert:

- exit code contract (`0` for success, non-zero on failure),
- user-visible output contract (`stdout`/`stderr` key lines),
- safety contract (no silent success when guardrails should trigger).

## Completion Criteria

- Every matrix row has a passing automated test.
- At least one negative/failure-path test exists per module.
- Existing tests continue to pass with no change to published CLI behavior.
