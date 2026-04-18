// SWC polyfills for browser - ensures private class method helpers are available
import _class_private_method_init from '@swc/helpers/esm/_class_private_method_init'
import _class_private_field_init from '@swc/helpers/esm/_class_private_field_init'
import _class_check_private_revoke from '@swc/helpers/esm/_class_check_private_revoke'

window.__swc_polyfills = {
  _class_private_method_init,
  _class_private_field_init,
  _class_check_private_revoke,
}
