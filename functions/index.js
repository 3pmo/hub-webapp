const { onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();

const ANTHROPIC_ADMIN_KEY = defineSecret("ANTHROPIC_ADMIN_KEY");

/**
 * Fetches Claude usage data from Anthropic Admin API and writes to RTDB.
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

        // Get usage for current month
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const endOfMonth = now.toISOString();

        const url = `https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${startOfMonth}&ending_at=${endOfMonth}&bucket_width=1d&group_by[]=model`;

        const resp = await fetch(url, {
            headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01"
            }
        });

        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
        }

        const result = await resp.json();

        // Aggregate all buckets
        let totalInput = 0;
        let totalOutput = 0;
        if (result.data) {
            for (const bucket of result.data) {
                totalInput += (bucket.uncached_input_tokens || 0) + (bucket.cached_input_tokens || 0);
                totalOutput += bucket.output_tokens || 0;
            }
        }

        const usageData = {
            input_tokens: totalInput,
            output_tokens: totalOutput,
            last_updated: Date.now(),
            limits: {
                daily_input: 1000000,
                daily_output: 200000
            }
        };

        await admin.database().ref("hub_status/token_usage/claude").set(usageData);

        return { success: true, data: usageData };
    }
);
