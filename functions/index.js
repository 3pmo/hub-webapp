// hub-3pmo Cloud Functions — deployed via GitHub Actions (FIREBASE_TOKEN)
const { onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const ANTHROPIC_ADMIN_KEY = defineSecret("ANTHROPIC_ADMIN_KEY");

/**
 * Fetches Claude Code usage from the Claude Code Analytics API and writes to RTDB.
 *
 * Uses /v1/organizations/usage_report/claude_code (NOT /usage_report/messages).
 * The messages endpoint tracks API billing tokens — always 0 for Claude Code
 * subscription users. The claude_code endpoint tracks actual Claude Code usage:
 * tokens, sessions, lines of code, commits, PRs, and estimated costs.
 *
 * Prerequisites:
 *   1. Firebase Blaze plan
 *   2. Set secret: firebase functions:secrets:set ANTHROPIC_ADMIN_KEY
 *   3. Deploy: firebase deploy --only functions
 *
 * Called from Status tab refresh button via firebase.functions().httpsCallable('fetchClaudeUsage')
 */
// NOTE: invoker: 'public' is required for Firebase Functions v2 onCall to allow
// unauthenticated browser requests. Without it, Cloud Run returns 403 on the
// CORS preflight (OPTIONS) before the function ever runs. This is a breaking
// change from v1 where onCall was public by default.
//
// PREREQUISITE: Set the Anthropic Admin API key as a Firebase secret before deploying:
//   firebase functions:secrets:set ANTHROPIC_ADMIN_KEY
// Then deploy: firebase deploy --only functions
exports.fetchClaudeUsage = onCall(
    { secrets: [ANTHROPIC_ADMIN_KEY], invoker: 'public' },
    async (request) => {
        const key = ANTHROPIC_ADMIN_KEY.value();
        if (!key) {
            throw new Error("ANTHROPIC_ADMIN_KEY not configured");
        }

        const now = new Date();
        const today = now.toISOString().split("T")[0]; // YYYY-MM-DD

        console.log("Fetching Claude Code analytics for", today);

        // Fetch today's data from the Claude Code Analytics API
        const url = `https://api.anthropic.com/v1/organizations/usage_report/claude_code?starting_at=${today}&limit=1000`;

        const resp = await fetch(url, {
            headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01"
            }
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error("Anthropic API error:", resp.status, errText);
            throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
        }

        const result = await resp.json();
        console.log("Records returned for today:", result.data?.length || 0);

        // If today has no data yet (1-hour freshness delay), try yesterday
        let records = result.data || [];
        let dateUsed = today;

        if (records.length === 0) {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split("T")[0];

            console.log("No data for today, trying yesterday:", yesterdayStr);

            const fallbackResp = await fetch(
                `https://api.anthropic.com/v1/organizations/usage_report/claude_code?starting_at=${yesterdayStr}&limit=1000`,
                {
                    headers: {
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01"
                    }
                }
            );

            if (fallbackResp.ok) {
                const fallbackResult = await fallbackResp.json();
                records = fallbackResult.data || [];
                dateUsed = yesterdayStr;
                console.log("Records returned for yesterday:", records.length);
            }
        }

        // Aggregate across all user records for the day
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheCreation = 0;
        let totalCostCents = 0;
        let totalSessions = 0;
        let totalLinesAdded = 0;
        let totalLinesRemoved = 0;
        let totalCommits = 0;
        let totalPRs = 0;

        for (const record of records) {
            // Core productivity metrics
            if (record.core_metrics) {
                totalSessions += record.core_metrics.num_sessions || 0;
                totalLinesAdded += (record.core_metrics.lines_of_code?.added) || 0;
                totalLinesRemoved += (record.core_metrics.lines_of_code?.removed) || 0;
                totalCommits += record.core_metrics.commits_by_claude_code || 0;
                totalPRs += record.core_metrics.pull_requests_by_claude_code || 0;
            }

            // Token usage and cost per model
            if (record.model_breakdown) {
                for (const model of record.model_breakdown) {
                    totalInput += model.tokens?.input || 0;
                    totalOutput += model.tokens?.output || 0;
                    totalCacheRead += model.tokens?.cache_read || 0;
                    totalCacheCreation += model.tokens?.cache_creation || 0;
                    totalCostCents += model.estimated_cost?.amount || 0;
                }
            }
        }

        console.log("Aggregated — input:", totalInput, "output:", totalOutput,
            "cost cents:", totalCostCents, "sessions:", totalSessions,
            "LOC: +" + totalLinesAdded + "/-" + totalLinesRemoved);

        const usageData = {
            input_tokens: totalInput,
            output_tokens: totalOutput,
            cache_read_tokens: totalCacheRead,
            cache_creation_tokens: totalCacheCreation,
            estimated_cost_cents: totalCostCents,
            sessions: totalSessions,
            lines_added: totalLinesAdded,
            lines_removed: totalLinesRemoved,
            commits: totalCommits,
            pull_requests: totalPRs,
            date: dateUsed,
            last_updated: Date.now(),
            // Keep limits for gauge compatibility (arbitrary daily estimate)
            limits: { daily_input: 700000, daily_output: 300000 }
        };

        // Write snapshot (current state — overwritten each refresh)
        await admin.database().ref("hub_status/token_usage/claude").set(usageData);

        // Write to time-series (keyed by date — accumulates historical data for chart)
        await admin.database()
            .ref(`hub_cost_tracker/daily/claude/${usageData.date}`)
            .set(usageData);

        return { success: true, data: usageData };
    }
);

// ── ISSUE TRACKER ────────────────────────────────────────────────────────────
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

/**
 * Triggered on any write to the /issues collection.
 * Recomputes the total number of open bugs and enhancements for the parent project.
 */
exports.onIssueWrite = onDocumentWritten("issues/{issueId}", async (event) => {
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    // Identify which project(s) to update. Usually it's just one.
    // If an issue was moved to another project, we should update both, 
    // but moving projects is rare. For safety, we recount both if they differ.
    const projectsToUpdate = new Set();
    if (beforeData?.project_slug) projectsToUpdate.add(beforeData.project_slug);
    if (afterData?.project_slug) projectsToUpdate.add(afterData.project_slug);

    if (projectsToUpdate.size === 0) return null;

    const db = admin.firestore();

    const updates = Array.from(projectsToUpdate).map(async (projectSlug) => {
        const querySnapshot = await db.collection("issues").where("project_slug", "==", projectSlug).get();
        let bugs = 0;
        let enhancements = 0;

        querySnapshot.forEach(doc => {
            const d = doc.data();
            // Done, Closed, and Parked mean the issue is resolved/archived
            if (["Done", "Closed", "Parked"].includes(d.status)) return;

            if (d.type === "bug") bugs++;
            if (d.type === "enhancement") enhancements++;
        });

        console.log(`Updating counts for project ${projectSlug} -> Bugs: ${bugs}, Enhancements: ${enhancements}`);
        // Only update if the project exists to avoid errors on deleted projects
        const projRef = db.collection("projects").doc(projectSlug);
        const projDoc = await projRef.get();
        if (projDoc.exists) {
            return projRef.update({
                backlog_bugs: bugs,
                backlog_enhancements: enhancements
            });
        }
    });

    return Promise.all(updates);
});
