// fixture: near-misses that must NOT trigger any secrets/* finding

// Mentions "AKIA" but not a valid-shaped key (too short, lowercase)
const comment = "our internal prefix akia is unrelated to AWS keys";

// Redacted/placeholder AWS-shaped value
const awsPlaceholder = "AKIA****************";

// Truncated GitHub token shape (fewer than 36 trailing chars)
const githubPlaceholder = "ghp_shorttoken";

// Slack-looking string that's too short to match the pattern
const slackPlaceholder = "xoxb-short";

// Mentions a private key without the real PEM header
const privateKeyMention = "// TODO: load the PRIVATE KEY from a secrets manager, not from source";

// Truncated Google API key shape
const googlePlaceholder = "AIzaShort";

// Stripe test key (not live) should not match the live-key pattern
const stripeTestKey = "sk_test_0123456789abcdefghijklmnopqrstuv";
