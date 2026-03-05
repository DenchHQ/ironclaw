# Extraction Patterns

How to extract testable decision logic from I/O-coupled functions.

## Pattern: Decision function extraction

### Before (untestable)

`getUserSubscriptionTier` in `packages/db/src/utils/subscription.utils.ts` determines a user's subscription tier. The decision logic (which tier to assign based on seat status, pilot program, trial dates) is interleaved with a complex database query:

```typescript
// packages/db/src/utils/subscription.utils.ts
async function getUserSubscriptionTier(userId: number): Promise<SubscriptionTier> {
  try {
    // DB call: complex join across users, seats, subscriptions, prices, products, whitelisted domains
    const [user] = await db
      .select({
        userId: users.id,
        email: users.email,
        trialStartDate: users.trialStartDate,
        seatActive: seats.active,
        subscriptionStatus: subscriptions.status,
        stripeProductId: products.stripeProductId,
        whitelistedDomainEnabled: whitelistedPilotDomains.enabled,
        pilotEndDate: whitelistedPilotDomains.pilotEndDate,
      })
      .from(users)
      .leftJoin(seats, eq(seats.userId, users.id))
      .leftJoin(subscriptions, eq(seats.subscriptionId, subscriptions.id))
      .leftJoin(prices, eq(subscriptions.priceId, prices.id))
      .leftJoin(products, eq(prices.productId, products.id))
      .leftJoin(whitelistedPilotDomains /* domain matching logic */)
      .where(eq(users.id, userId))
      .orderBy(desc(seats.active), desc(whitelistedPilotDomains.enabled))
      .limit(1);

    if (!user) return "none";

    // Decision (buried): active seat with recognized product
    if (
      user.seatActive &&
      ACTIVE_STRIPE_STATUSES.includes(user.subscriptionStatus ?? "") &&
      user.stripeProductId
    ) {
      const tier = PRODUCT_ID_TO_TIER[user.stripeProductId];
      if (tier) return tier;
      return "individual"; // fallback for unrecognized products
    }

    // Decision (buried): pilot program check
    if (user.whitelistedDomainEnabled) {
      if (
        user.pilotEndDate &&
        calculateDaysLeftInTeamsTrial(new Date(user.pilotEndDate)) > 0 &&
        !isPilotEndDatePast(new Date(user.pilotEndDate))
      ) {
        return "pilot";
      }
    }

    // Decision (buried): solo trial check
    if (user.trialStartDate) {
      if (calculateDaysLeftInSoloTrial(new Date(user.trialStartDate)) > 0) return "trial";
    }

    return "none";
  } catch (error) {
    return "none";
  }
}
```

Testing this requires mocking a 5-table join. The test ends up reconstructing database state rather than verifying the tier-selection decisions.

### After (testable)

Extract the decision logic into a pure function. This is what `computeTrialState` in `packages/shared-iso/src/trial-state.ts` does:

```typescript
// packages/shared-iso/src/trial-state.ts — Pure decision function (no I/O)

export interface ComputeTrialStateParams {
  hasActiveSeat: boolean;
  trialStartDate: Date | null;
  isWhitelistedDomain: boolean;
  pilotEndDate: Date | null;
}

export function computeTrialState({
  hasActiveSeat,
  trialStartDate,
  isWhitelistedDomain,
  pilotEndDate,
}: ComputeTrialStateParams): TrialState {
  if (hasActiveSeat) {
    return { status: "active", source: "seat", daysRemaining: null /* ... */ };
  }

  const soloDaysRemaining = trialStartDate ? calculateDaysLeftInSoloTrial(trialStartDate) : null;
  const teamDaysRemaining =
    isWhitelistedDomain && pilotEndDate ? calculateDaysLeftInTeamsTrial(pilotEndDate) : null;

  const isSoloActive = (soloDaysRemaining ?? 0) > 0;
  const isTeamActive = (teamDaysRemaining ?? 0) > 0;

  // Whitelisted domains: prefer the larger active trial window
  if (isWhitelistedDomain) {
    if (isSoloActive && (!isTeamActive || soloDaysRemaining! > teamDaysRemaining!)) {
      return {
        status: "free-trial",
        source: "solo",
        daysRemaining: soloDaysRemaining! /* ... */,
      };
    }
    if (isTeamActive) {
      return {
        status: "pilot",
        source: "pilot",
        daysRemaining: teamDaysRemaining! /* ... */,
      };
    }
    return {
      status: "pilot-enabled-past-end",
      source: pilotEndDate ? "pilot" : "none" /* ... */,
    };
  }

  if (isSoloActive) {
    return {
      status: "free-trial",
      source: "solo",
      daysRemaining: soloDaysRemaining! /* ... */,
    };
  }

  return { status: "inactive", source: "none", daysRemaining: 0 /* ... */ };
}
```

The orchestrator fetches data, then calls the decision function:

```typescript
// apps/nextjs-app/lib/server/authorization.ts — Orchestrator (I/O + decision)
export async function getIsNotAuthorizedFromServer(
  id: number,
  email: string | null,
  trialStartDate: Date | null,
) {
  const seatsResult = await getSeatsWithSubscriptionByUserId(id);
  const seats = seatsResult.isOk() ? seatsResult.value : [];
  const hasActiveSeat = seats?.find((seat) => seat.active) ? true : false;
  const whitelisted = await getWhitelistedDomainByEmail(email!);

  return isNotAuthorized({
    hasActiveSeat,
    trialStartDate,
    isWhitelistedDomain: Boolean(whitelisted),
    pilotEndDate: whitelisted?.pilotEndDate ?? null,
  });
}
```

Now the decision logic is independently testable without any database:

```typescript
// packages/shared-iso/src/__tests__/trial-state.test.ts
describe("computeTrialState", () => {
  it("returns active when user has active seat", () => {
    vi.setSystemTime(new Date("2026-02-04T12:00:00.000Z"));
    const result = computeTrialState({
      hasActiveSeat: true,
      trialStartDate: new Date("2026-01-01T00:00:00.000Z"),
      isWhitelistedDomain: true,
      pilotEndDate: new Date("2026-06-01T12:00:00.000Z"),
    });
    expect(result.status).toBe("active");
    expect(result.daysRemaining).toBe(null);
  });

  it("prefers solo trial over team trial if solo has more days remaining", () => {
    vi.setSystemTime(new Date("2025-06-25T12:00:00.000Z"));
    const result = computeTrialState({
      hasActiveSeat: false,
      trialStartDate: new Date("2025-06-20T00:00:00.000Z"),
      isWhitelistedDomain: true,
      pilotEndDate: new Date("2025-06-26T12:00:00.000Z"),
    });
    expect(result.status).toBe("free-trial");
    expect(result.source).toBe("solo");
  });

  it("prefers team trial when solo and team days are equal", () => {
    vi.setSystemTime(new Date("2025-07-01T00:00:00.000Z"));
    const result = computeTrialState({
      hasActiveSeat: false,
      trialStartDate: new Date("2025-06-25T00:00:00.000Z"),
      isWhitelistedDomain: true,
      pilotEndDate: new Date("2025-07-09T12:00:00.000Z"),
    });
    expect(result.status).toBe("pilot");
    expect(result.source).toBe("pilot");
  });

  it("returns free-trial for whitelisted user when team trial expired but solo trial active", () => {
    vi.setSystemTime(new Date("2025-07-10T00:00:00.000Z"));
    const result = computeTrialState({
      hasActiveSeat: false,
      trialStartDate: new Date("2025-07-05T00:00:00.000Z"),
      isWhitelistedDomain: true,
      pilotEndDate: new Date("2025-07-01T12:00:00.000Z"),
    });
    expect(result.status).toBe("free-trial");
    expect(result.source).toBe("solo");
    expect(result.soloDaysRemaining).toBeGreaterThan(0);
    expect(result.teamDaysRemaining).toBe(0);
  });

  it("returns inactive for non-whitelisted user with no trial start date", () => {
    vi.setSystemTime(new Date("2025-06-25T12:00:00.000Z"));
    const result = computeTrialState({
      hasActiveSeat: false,
      trialStartDate: null,
      isWhitelistedDomain: false,
      pilotEndDate: null,
    });
    expect(result.status).toBe("inactive");
    expect(result.source).toBe("none");
  });
});
```

## When to extract vs. when to mock

Extract when:

- The function has 3+ decision branches interleaved with I/O
- The decisions encode security invariants or business rules
- The same decision logic is reused across multiple callers
- Testing via mocks would require reconstructing complex state

Mock (or use integration tests) when:

- The logic IS the I/O (e.g., "does this query return the right rows?")
- The function is simple orchestration with no significant branching
- You're testing that components are wired together correctly

## Return type design for decision functions

Use discriminated unions that force callers to handle all cases:

```typescript
// Status union with source tracking — from packages/shared-iso/src/trial-state.ts
type TrialStateStatus =
  | "active" // paid seat
  | "pilot" // whitelisted domain, active team trial
  | "free-trial" // active individual trial
  | "pilot-enabled-past-end" // whitelisted but expired
  | "inactive"; // no access

interface TrialState {
  status: TrialStateStatus;
  source: "seat" | "pilot" | "solo" | "none";
  daysRemaining: number | null;
  soloDaysRemaining: number | null;
  teamDaysRemaining: number | null;
  isWhitelistedDomain: boolean;
}
```

Benefits:

- The status + source fields make tests self-documenting
- The discriminated union prevents "forgot to handle this case" bugs
- Downstream consumers like `isNotAuthorizedFromTrialState` can make simple decisions on the result

## Granularity

Each extracted function should represent one coherent decision:

- `computeTrialState` — determines subscription/trial status from user attributes
- `isNotAuthorizedFromTrialState` — derives a boolean access check from trial state
- `isNotAuthorized` — convenience wrapper combining both

The orchestrator (`getIsNotAuthorizedFromServer`) handles I/O: fetching seats, looking up whitelisted domains, then passing plain data to the decision functions.

Avoid extracting a single `checkAllAccess(allTheData)` function. That just moves the untestable monolith. The value is in small, focused functions where each test clearly states what invariant it protects.
