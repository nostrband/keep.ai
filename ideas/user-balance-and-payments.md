# Idea: User Balance and Payments System

## Overview

When workflows hit PAYMENT_REQUIRED errors, it means the user's balance is low and ALL workflows may eventually fail. This needs a comprehensive solution beyond just error classification.

## Components Needed

### 1. User Balance Display
- Show current balance in settings screen
- Balance indicator in header/sidebar (optional)
- Visual warning when balance is low
- Clear units (credits, USD equivalent, API calls remaining?)

### 2. Top-up Flow
- "Add funds" / "Top up" button in settings
- Payment provider integration (Stripe likely)
- Amount selection (preset amounts or custom)
- Payment confirmation and receipt
- Balance updated after successful payment

### 3. Backend Support (User Server)
- Store user balance
- Track usage/deductions per API call
- Handle payment webhooks from Stripe
- Provide balance inquiry endpoint
- Low balance notifications

### 4. Payment Provider Integration (Stripe)
- Stripe Checkout or Payment Intents
- Webhook handling for payment confirmation
- Possibly subscription option for recurring credits
- Handle failed payments gracefully

### 5. Error Handling for PAYMENT_REQUIRED
- New error type classification (e.g., 'billing' or 'payment')
- Notification action: "Top up balance" (link to settings)
- All workflows paused/warned when balance critically low
- Proactive low-balance warning before workflows start failing

### 6. Usage Tracking
- Show usage history in settings
- Per-workflow cost breakdown (optional)
- Daily/weekly/monthly usage charts (optional)
- Spending alerts/limits (optional)

## User Experience Flow

1. User runs workflows that consume API credits
2. Balance decreases over time
3. When balance gets low:
   - Warning shown in UI
   - Optional email/notification
4. When balance hits zero:
   - Workflows fail with PAYMENT_REQUIRED
   - Clear notification: "Your balance is empty. Top up to continue."
   - Direct link to payment page
5. User clicks "Top up":
   - Redirected to Stripe Checkout
   - Completes payment
   - Balance credited immediately
   - Workflows resume automatically (or user manually resumes)

## Open Questions

- What pricing model? Per-API-call, per-token, flat monthly subscription?
- Free tier / trial credits for new users?
- What happens to scheduled workflows when balance is zero? Pause all? Queue for later?
- Refund policy?
- Multiple payment methods?
- Invoice/receipt generation for business users?

## Priority

This is essential for monetization but complex. May want to start with:
1. Basic balance display
2. Simple Stripe Checkout integration
3. PAYMENT_REQUIRED error classification and notification

Then iterate with usage tracking, subscriptions, etc.
