// X (Twitter) reads `twitter:image` separately from `og:image`, so expose
// the same generated card under the twitter-image convention. Re-export
// everything from opengraph-image so the rendered artwork stays in one
// place.
//
// `runtime` must be declared inline per Next's segment-config rules —
// re-exporting it from another module breaks the build parser.
export const runtime = 'edge'
export { default, alt, size, contentType } from './opengraph-image'
