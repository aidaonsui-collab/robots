/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@mmt-finance/clmm-sdk'],
  turbopack: {},
  typescript: {
    // Fail the build on type errors. If @mysten/sui and
    // @mysten/wallet-standard ship conflicting Transaction types, pin
    // them via `overrides` in package.json or suppress the single
    // offending line with `@ts-expect-error` — do NOT re-enable this.
    ignoreBuildErrors: false,
  },
}

module.exports = nextConfig
