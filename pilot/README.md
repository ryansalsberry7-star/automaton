# Indie skincare competitor-watch pilot

## The offer

Create a human-reviewed weekly public-web brief for independent US skincare
brands focused on acne care. Track a small, agreed set of peer brands for
visible changes to product pages, prices, bundles, promotions, availability,
and positioning. Cite every observation with its source and capture date.

The deliverable is decision support, not medical, legal, investment, or sales
advice. It does not claim that a competitor change caused a business result.
Only use public pages; do not bypass access controls, collect customer data, or
repeat unverified health claims as facts.

## Low-cost validation

1. Run `node pilot/run.mjs` from the repository root. It fetches the small
   public-page list in `targets.json`, writes a report under `pilot/reports/`,
   and stores the last extracted fields under `pilot/state/` for comparison on
   the next run.
2. The report includes a draft email for the listed candidate. Verify the
   current site and choose an appropriate public contact channel before
   manually sending anything.
3. Ask whether this information would help them make a decision and which
   competitors or changes matter. Do not buy hosting, APIs, ads, or agent
   credits before someone confirms interest.
4. If there is interest, offer a one-time paid pilot with a mutually agreed
   scope. Treat any suggested price as a test, not a proven market rate.
5. Track actual time, expenses, feedback, and repeat interest before offering
   a subscription.

The runner is intentionally one-shot: it has no scheduler, email client,
account credentials, or send capability. Page collection is limited to the
URLs you put in `targets.json`; it does not search the web for new prospects.
Review each report because page extraction can be incomplete or affected by
site changes.

On this Mac, the weekly LaunchAgent in `com.local.automaton-pilot.plist` runs
the one-shot collector every Monday at 9:00 AM local time. It requires your
user session to be active and the Mac to be available. The job writes reports
locally and never sends email. To stop it, run:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.local.automaton-pilot.plist
```

## Candidate pricing to test

- One-time, 5-brand snapshot: $75-$100.
- If a customer finds it useful, test a weekly report at $100-$150/month.

These are hypotheses only. Do not promise revenue, customer growth, or a
specific return on investment.

## Using Automaton

`automaton-prompt.md` is a drafting prompt, not permission to start the runtime.
Automaton's first-run flow provisions an identity and its startup can attempt a
$5 USDC credit purchase. Keep the agent stopped until you deliberately review
the setup, costs, and permissions. This pilot can be validated manually first.
