# Stripe Issuing Setup Guide

## Step 1: Create Stripe Account

1. Go to https://dashboard.stripe.com/register
2. Fill out:
   - Email
   - Password
   - Business name: "Odyssey AI" (or your legal entity)
   - Country: **United States** (required for Issuing)

3. Complete business verification:
   - Business type (LLC, Corporation, etc.)
   - Tax ID / EIN
   - Business address
   - Personal info (for owner/director)

**Note:** You can start in Test Mode immediately, but Production Mode requires full verification.

---

## Step 2: Enable Stripe Issuing

1. Log into Stripe Dashboard
2. Go to **Products** → **Issuing**
3. Click **"Get Started"**
4. Choose your card program model:
   - Select **"Comprehensive program management"** (Stripe handles banking)
5. Review terms and enable Issuing

**This may take 1-2 business days for approval.**

---

## Step 3: Get API Keys

### Test Mode (Start Here):
1. Click **Developers** in left sidebar
2. Click **API keys**
3. Copy:
   - **Publishable key** (starts with `pk_test_`)
   - **Secret key** (starts with `sk_test_`)

### Production Mode (After Verification):
1. Toggle from "Test mode" to "Live mode" (top right)
2. Copy:
   - **Publishable key** (starts with `pk_live_`)
   - **Secret key** (starts with `sk_live_`)

---

## Step 4: Configure Environment Variables

Create `.env.local` in your project root:

```bash
# Stripe Test Keys (start here)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx

# Later: Stripe Live Keys
# STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
# STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
```

**Important:** Never commit `.env.local` to git! (Already in .gitignore)

---

## Step 5: Deploy to Vercel

Add environment variables to Vercel:

```bash
cd ~/Downloads/theodyssey2

# Add to Vercel (Production)
vercel env add STRIPE_SECRET_KEY
# Paste: sk_test_xxxxx (or sk_live_xxxxx)

vercel env add STRIPE_PUBLISHABLE_KEY
# Paste: pk_test_xxxxx (or pk_live_xxxxx)
```

Or via Vercel Dashboard:
1. Go to https://vercel.com/your-project/settings/environment-variables
2. Add `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`
3. Choose "Production" and "Preview" environments
4. Save

---

## Step 6: Test Card Creation

```bash
# Test the API
curl -X POST http://localhost:3000/api/agents/{agent-id}/card \
  -H "Content-Type: application/json" \
  -d '{"initialBalance": 5000}'

# Should return:
{
  "success": true,
  "card": {
    "id": "ic_xxxxx",
    "last4": "4242",
    "expMonth": 12,
    "expYear": 2027,
    "status": "active"
  }
}
```

---

## Step 7: View in Stripe Dashboard

1. Go to **Issuing** → **Cards**
2. You should see the test card
3. Click to view:
   - Card number (virtual)
   - CVV
   - Expiry
   - Cardholder details
   - Spending limits

---

## Costs (Stripe Issuing Pricing)

### Test Mode:
- **FREE** - Create unlimited test cards

### Production Mode:
- **Virtual cards:** $0.10 per card
- **Physical cards:** $3.50 per card (+ shipping)
- **No monthly fees**
- **Interchange revenue:** You earn ~0.5-2% on every purchase

**Estimated cost for 100 agents:**
- 100 virtual cards × $0.10 = **$10.00 total**
- Average $25/month spend per agent → Earn ~$0.50/agent/month
- **Break-even at 20 transactions**

---

## Security Best Practices

1. **Use Test Mode first** - Don't go live until fully tested
2. **Set spending limits** - Default $50-$200 per month
3. **Block risky categories** - Gambling, crypto exchanges, adult content
4. **Monitor transactions** - Set up Stripe webhooks for alerts
5. **Rotate keys regularly** - Especially if exposed in logs

---

## Webhooks (Optional but Recommended)

Set up webhooks to get real-time transaction notifications:

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. URL: `https://theodyssey.fun/api/webhooks/stripe`
4. Select events:
   - `issuing_authorization.created`
   - `issuing_transaction.created`
   - `issuing_card.updated`
5. Get signing secret (starts with `whsec_`)
6. Add to `.env.local`: `STRIPE_WEBHOOK_SECRET=whsec_xxxxx`

---

## Next Steps

Once Stripe is set up:

1. ✅ Create test agent
2. ✅ Issue virtual card
3. ✅ View card in dashboard
4. ✅ Test card controls (freeze, limits)
5. ✅ Monitor transactions
6. 🚀 Launch to production!

---

## Troubleshooting

**Error: "Issuing is not enabled"**
- Go to Products → Issuing and enable it
- May need to wait 1-2 days for approval

**Error: "Invalid API key"**
- Check `.env.local` has correct keys
- Make sure using `sk_test_` for test mode

**Error: "Insufficient funds"**
- Test mode has unlimited balance
- Live mode requires funding your Stripe balance

**Card shows "inactive"**
- Call `stripe.issuing.cards.update(cardId, { status: 'active' })`
- Or activate via Stripe Dashboard

---

## Support

- **Stripe Docs:** https://docs.stripe.com/issuing
- **Stripe Support:** https://support.stripe.com
- **Odyssey Discord:** [Your Discord link]

