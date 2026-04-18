import Stripe from "stripe";
import { getEnv, requireConfigured } from "@/lib/config/env";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { AccountRow, Plan, SubscriptionStateRow } from "@/lib/db/types";
import { assertSupabase } from "@/lib/db/utils";
import { ApiError } from "@/lib/errors";
import { addYears } from "@/lib/utils/date";

let stripeClient: Stripe | null = null;

function getStripe() {
  if (stripeClient) {
    return stripeClient;
  }

  stripeClient = new Stripe(requireConfigured(getEnv().STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"));
  return stripeClient;
}

export function getPlanLimits(plan: Plan) {
  const env = getEnv();

  if (plan === "paid") {
    return {
      annualSponsoredWriteLimit: env.OMATRUST_PAID_ANNUAL_SPONSORED_WRITES,
      annualPremiumReadLimit: env.OMATRUST_PAID_ANNUAL_PREMIUM_READS
    };
  }

  return {
    annualSponsoredWriteLimit: env.OMATRUST_FREE_ANNUAL_SPONSORED_WRITES,
    annualPremiumReadLimit: env.OMATRUST_FREE_ANNUAL_PREMIUM_READS
  };
}

export function assertPremiumReadAllowed(subscriptionState: SubscriptionStateRow) {
  if (subscriptionState.premium_reads_used_current_year >= subscriptionState.annual_premium_read_limit) {
    throw new ApiError("Premium read limit exceeded", 403, "PREMIUM_READ_LIMIT_EXCEEDED");
  }
}

export async function incrementPremiumReadUsage(subscriptionState: SubscriptionStateRow) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("subscription_state")
    .update({
      premium_reads_used_current_year: subscriptionState.premium_reads_used_current_year + 1
    })
    .eq("id", subscriptionState.id);

  assertSupabase(true, result.error, "Failed to increment premium read usage");
}

export async function consumePremiumReadEntitlement(subscriptionState: SubscriptionStateRow) {
  assertPremiumReadAllowed(subscriptionState);
  await incrementPremiumReadUsage(subscriptionState);
}

async function ensureStripeCustomer(account: AccountRow) {
  if (account.stripe_customer_id) {
    return account.stripe_customer_id;
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    metadata: {
      accountId: account.id
    },
    name: account.display_name ?? undefined
  });

  const supabase = getSupabaseAdmin();
  const update = await supabase
    .from("accounts")
    .update({ stripe_customer_id: customer.id })
    .eq("id", account.id);

  assertSupabase(true, update.error, "Failed to persist Stripe customer");
  return customer.id;
}

export async function createPaidCheckoutSession(params: {
  account: AccountRow;
  successUrl: string;
  cancelUrl: string;
}) {
  const env = getEnv();
  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(params.account);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    subscription_data: {
      metadata: {
        accountId: params.account.id,
        plan: "paid"
      }
    },
    line_items: [
      {
        price: requireConfigured(env.STRIPE_PAID_PRICE_ID, "STRIPE_PAID_PRICE_ID"),
        quantity: 1
      }
    ],
    metadata: {
      accountId: params.account.id,
      plan: "paid"
    }
  });

  if (!session.url) {
    throw new ApiError("Stripe error", 502, "STRIPE_ERROR");
  }

  return {
    checkoutUrl: session.url
  };
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStateRow["status"] {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
      return "past_due";
    case "incomplete":
      return "incomplete";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    default:
      return "active";
  }
}

function resolvePlanFromStripeSubscription(subscription: Stripe.Subscription): Plan {
  const env = getEnv();
  const metadataPlan = subscription.metadata.plan;

  if (metadataPlan === "free" || metadataPlan === "paid") {
    return metadataPlan;
  }

  if (subscription.items.data.some((item) => item.price.id === env.STRIPE_PAID_PRICE_ID)) {
    return "paid";
  }

  return "free";
}

function getSubscriptionPeriodDate(
  subscription: Stripe.Subscription,
  field: "current_period_start" | "current_period_end"
) {
  const timestamp = (subscription as Stripe.Subscription & Partial<Record<typeof field, number>>)[field];
  return typeof timestamp === "number" ? new Date(timestamp * 1000).toISOString() : null;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice) {
  const subscription = (invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  }).subscription;

  if (!subscription) {
    return null;
  }

  return typeof subscription === "string" ? subscription : subscription.id;
}

export async function handleStripeWebhook(rawBody: string, signature: string | null) {
  const env = getEnv();
  if (!signature) {
    throw new ApiError("Stripe signature missing", 400, "STRIPE_ERROR");
  }

  const stripe = getStripe();
  const event = stripe.webhooks.constructEvent(
    rawBody,
    signature,
    requireConfigured(env.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_SECRET")
  );
  const supabase = getSupabaseAdmin();

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    let subscriptionId: string | null = null;
    let stripeSubscription: Stripe.Subscription | null = null;

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
      if (subscriptionId) {
        stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      }
    } else {
      stripeSubscription = event.data.object as Stripe.Subscription;
      subscriptionId = stripeSubscription.id;
    }

    if (stripeSubscription) {
      const plan = resolvePlanFromStripeSubscription(stripeSubscription);
      const limits = getPlanLimits(plan);
      const accountId = String(
        stripeSubscription.metadata.accountId ||
          stripeSubscription.items.data[0]?.price?.metadata?.accountId ||
          ""
      );

      if (!accountId) {
        throw new ApiError("Stripe error", 400, "STRIPE_ERROR");
      }

      const currentPeriodEnd =
        getSubscriptionPeriodDate(stripeSubscription, "current_period_end") ??
        addYears(new Date(), 1).toISOString();

      const currentPeriodStart =
        getSubscriptionPeriodDate(stripeSubscription, "current_period_start") ??
        new Date().toISOString();

      const update = await supabase
        .from("subscription_state")
        .update({
          plan,
          status: mapStripeStatus(stripeSubscription.status),
          annual_sponsored_write_limit: limits.annualSponsoredWriteLimit,
          annual_premium_read_limit: limits.annualPremiumReadLimit,
          stripe_subscription_id: stripeSubscription.id,
          stripe_price_id: stripeSubscription.items.data[0]?.price?.id ?? null,
          entitlement_period_start: currentPeriodStart,
          entitlement_period_end: currentPeriodEnd
        })
        .eq("account_id", accountId);

      assertSupabase(true, update.error, "Failed to update subscription state");
    }
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = getInvoiceSubscriptionId(invoice);

    if (subscriptionId) {
      const update = await supabase
        .from("subscription_state")
        .update({ status: "past_due" })
        .eq("stripe_subscription_id", subscriptionId);

      assertSupabase(true, update.error, "Failed to update past due subscription state");
    }
  }

  return {
    received: true,
    type: event.type
  };
}
