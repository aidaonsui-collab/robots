// X (Twitter) reads `twitter:image` separately from `og:image`, so expose
// the same generated card under the twitter-image convention. Re-export
// everything from opengraph-image so the rendered artwork stays in one
// place.
export { default, alt, size, contentType, runtime } from './opengraph-image'
