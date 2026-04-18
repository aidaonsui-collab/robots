// MUST be first - provides SWC private class method polyfills before any dapp-kit code
// Using CJS requires() to force inclusion - ESM imports might get tree-shaken
const _class_private_method_init = require('@swc/helpers/cjs/_class_private_method_init.cjs')
const _class_private_field_init = require('@swc/helpers/cjs/_class_private_field_init.cjs')

// @ts-ignore
if (typeof window !== 'undefined') {
  window._class_private_method_init = _class_private_method_init._class_private_method_init || _class_private_method_init._
  window._class_private_field_init = _class_private_field_init._class_private_field_init || _class_private_field_init._
}

export {}
