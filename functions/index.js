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
exports.fetchClaudeUsage = onCall(
    { secrets: [ANTHROPIC_ADMIN_KEY] },
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

        await admin.database().ref("hub_status/token_usage/claude").set(usageData);

        return { success: true, data: usageData };
    }
);
