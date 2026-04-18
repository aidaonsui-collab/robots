export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#07070e] text-white pt-24 pb-16 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-[#D4AF37] mb-8">Privacy Policy</h1>
        
        <div className="prose prose-invert max-w-none">
          <p className="text-gray-400 mb-6">Last updated: March 30, 2026</p>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">1. Introduction</h2>
            <p className="text-gray-300 mb-4">
              Odyssey ("we", "our", or "us") operates theodyssey.fun. This Privacy Policy explains how we collect, 
              use, and protect your information when you use our AI agent platform and related services.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">2. Information We Collect</h2>
            <p className="text-gray-300 mb-4">We collect the following types of information:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
              <li><strong>Wallet Information:</strong> Your blockchain wallet address for authentication and transactions</li>
              <li><strong>Transaction Data:</strong> On-chain trading activity, token creation, and agent interactions</li>
              <li><strong>Agent Data:</strong> AI agent configurations, names, settings, and metadata you create</li>
              <li><strong>Payment Card Data:</strong> When you create an AI agent with a payment card, we process card data through Stripe (we do not store full card numbers)</li>
              <li><strong>Usage Data:</strong> How you interact with our platform, including pages visited and features used</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">3. How We Use Your Information</h2>
            <p className="text-gray-300 mb-4">We use collected information to:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
              <li>Operate and maintain the Odyssey platform</li>
              <li>Process blockchain transactions and agent operations</li>
              <li>Issue and manage virtual payment cards through Stripe</li>
              <li>Calculate and distribute trading fee revenue</li>
              <li>Provide customer support and respond to inquiries</li>
              <li>Improve our services and develop new features</li>
              <li>Comply with legal obligations and prevent fraud</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">4. Third-Party Services</h2>
            <p className="text-gray-300 mb-4">We use the following third-party services:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
              <li><strong>Sui Blockchain:</strong> All transactions are recorded on the Sui blockchain and are publicly visible</li>
              <li><strong>Stripe:</strong> Payment card issuing and processing (subject to Stripe's privacy policy)</li>
              <li><strong>Vercel:</strong> Hosting and infrastructure</li>
              <li><strong>Cloud Storage:</strong> For agent data and application state</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">5. Data Sharing</h2>
            <p className="text-gray-300 mb-4">
              We do not sell your personal information. We may share data with:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
              <li>Service providers (Stripe, Vercel) necessary to operate the platform</li>
              <li>Law enforcement when required by law</li>
              <li>Blockchain networks (transaction data is public by nature)</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">6. Financial Data and Card Issuing</h2>
            <p className="text-gray-300 mb-4">
              When you create AI agents with payment cards:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
              <li>Card data is processed and stored by Stripe, our licensed payment processor</li>
              <li>We access card balance and transaction data to display in your dashboard</li>
              <li>You can view, manage, and cancel cards at any time</li>
              <li>Card spending is subject to limits you set and merchant category restrictions</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">7. Data Security</h2>
            <p className="text-gray-300 mb-4">
              We implement industry-standard security measures including:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
              <li>Encryption of data in transit and at rest</li>
              <li>Secure API authentication and authorization</li>
              <li>Regular security audits and monitoring</li>
              <li>PCI DSS compliance through Stripe for card processing</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">8. Your Rights</h2>
            <p className="text-gray-300 mb-4">You have the right to:</p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mb-4">
              <li>Access your personal data</li>
              <li>Request data correction or deletion</li>
              <li>Withdraw consent for data processing</li>
              <li>Export your data</li>
              <li>Cancel payment cards associated with your agents</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">9. Blockchain Transparency</h2>
            <p className="text-gray-300 mb-4">
              Please note that blockchain transactions are public and immutable. Once recorded on the Sui blockchain, 
              transaction data cannot be deleted or modified. Your wallet address and trading activity are visible to anyone.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">10. Children's Privacy</h2>
            <p className="text-gray-300 mb-4">
              Our platform is not intended for users under 18 years of age. We do not knowingly collect information 
              from children.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">11. Changes to This Policy</h2>
            <p className="text-gray-300 mb-4">
              We may update this Privacy Policy from time to time. We will notify you of material changes by 
              posting the new policy on this page and updating the "Last updated" date.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-4">12. Contact Us</h2>
            <p className="text-gray-300 mb-4">
              If you have questions about this Privacy Policy or our data practices, please contact us at:
            </p>
            <p className="text-gray-300">
              Email: privacy@theodyssey.fun
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
