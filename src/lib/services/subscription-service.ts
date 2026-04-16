import Stripe from "stripe";
import { getEnv, requireConfigured } from "@/lib/config/env";
import { getSupabaseAdmin } from "@/lib/db/admin";
import type { AccountRow, SubscriptionRow } from "@/lib/db/types";
import { assertSupabase } from "@/lib/db/utils";
import { ApiError } from "@/lib/errors";
import { addMonths } from "@/lib/utils/date";

let stripeClient: Stripe | null = null;

function getStripe() {
  if (stripeClient) {
    return stripeClient;
  }

  stripeClient = new Stripe(requireConfigured(getEnv().STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY"));
  return stripeClient;
}

export async function getCurrentSubscription(accountId: string) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("subscriptions")
    .select("*")
    .eq("account_id", accountId)
    .single();

  return assertSupabase(result.data as SubscriptionRow | null, result.error, "Subscription not found");
}

export function assertApiReadAllowed(subscription: SubscriptionRow) {
  if (subscription.api_reads_used_current_period >= subscription.monthly_api_read_limit) {
    throw new ApiError("API read limit exceeded", 403, "API_READ_LIMIT_EXCEEDED");
  }
}

export async function incrementApiReadUsage(subscription: SubscriptionRow) {
  const supabase = getSupabaseAdmin();
  const result = await supabase
    .from("subscriptions")
    .update({
      api_reads_used_current_period: subscription.api_reads_used_current_period + 1
    })
    .eq("id", subscription.id);

  assertSupabase(true, result.error, "Failed to increment API read usage");
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

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionRow["status"] {
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
      const accountId = String(
        stripeSubscription.metadata.accountId ||
          stripeSubscription.items.data[0]?.price?.metadata?.accountId ||
          ""
      );

      if (!accountId) {
        throw new ApiError("Stripe error", 400, "STRIPE_ERROR");
      }

      const currentPeriodEnd = "current_period_end" in stripeSubscription && stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000).toISOString()
        : addMonths(new Date(), 1).toISOString();

      const currentPeriodStart = "current_period_start" in stripeSubscription && stripeSubscription.current_period_start
        ? new Date(stripeSubscription.current_period_start * 1000).toISOString()
        : new Date().toISOString();

      const update = await supabase
        .from("subscriptions")
        .update({
          plan: stripeSubscription.status === "active" || stripeSubscription.status === "trialing" ? "paid" : "free",
          status: mapStripeStatus(stripeSubscription.status),
          stripe_subscription_id: stripeSubscription.id,
          stripe_price_id: stripeSubscription.items.data[0]?.price?.id ?? null,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd
        })
        .eq("account_id", accountId);

      assertSupabase(true, update.error, "Failed to update subscription");
    }
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId =
      typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id ?? null;

    if (subscriptionId) {
      const update = await supabase
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("stripe_subscription_id", subscriptionId);

      assertSupabase(true, update.error, "Failed to update past due subscription");
    }
  }

  return {
    received: true,
    type: event.type
  };
}
