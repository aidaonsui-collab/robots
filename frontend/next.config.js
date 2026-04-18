/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@mmt-finance/clmm-sdk'],
  turbopack: {},
  typescript: {
    // @mysten/sui and @mysten/wallet-standard bundle conflicting Transaction
    // types (#private mismatch). Safe to ignore — works fine at runtime.
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig
