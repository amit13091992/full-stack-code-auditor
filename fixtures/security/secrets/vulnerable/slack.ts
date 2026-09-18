// fixture: fake, non-functional Slack token shape for secrets-analyzer tests.
// Deliberately non-numeric in the segments real Slack tokens use for team/bot IDs, and spelled
// out as obviously fake, so this satisfies our own (intentionally loose) detection regex without
// matching GitHub push protection's real Slack-token pattern (Section 56: never commit anything
// that looks like a live credential, even in a repo whose purpose is detecting exactly that).
export const slackToken = "xoxb-FAKE-NOTREAL-TESTTOKEN-PLACEHOLDERVALUE000";
