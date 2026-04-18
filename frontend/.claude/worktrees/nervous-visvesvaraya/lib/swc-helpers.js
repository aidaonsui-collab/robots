// SWC helpers polyfill - MUST be loaded before any code using private class methods
import _class_private_method_init from '@swc/helpers/esm/_class_private_method_init'
import _class_private_field_init from '@swc/helpers/esm/_class_private_field_init'
import _class_check_private_revoke from '@swc/helpers/esm/_class_check_private_revoke'

// Make globally available so bundles can reference them
if (typeof window !== 'undefined') {
  window._class_private_method_init = _class_private_method_init
  window._class_private_field_init = _class_private_field_init
  window._class_check_private_revoke = _class_check_private_revoke
}
