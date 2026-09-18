// fixture: fake, non-functional Stripe live secret key shape for secrets-analyzer tests.
// Contains an underscore in the key body — real Stripe secret keys never do — which our
// detection regex deliberately accepts (see patterns.ts) precisely so a fixture like this one
// can be unambiguously fake without matching GitHub push protection's real, stricter,
// alnum-only Stripe-key pattern (Section 56).
export const stripeSecretKey = "sk_live_NOTAREAL_STRIPE_KEY_FAKEVALUE_PLACEHOLDER";
