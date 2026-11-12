package ai.biber.vendorpush

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Registers the phone with its maker's push service (Huawei, Honor, Xiaomi, OPPO, vivo), for
 * Android phones in mainland China, which have no Google services to deliver notifications.
 */
class VendorPushModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("VendorPush")

    AsyncFunction("register") { promise: Promise ->
      val context = appContext.reactContext?.applicationContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      // Makers' SDKs block or call back on their own threads; keep the JS thread free
      Thread {
        val registered = runCatching { VendorChannels.register(context) }.getOrNull()
        promise.resolve(registered?.let { mapOf("provider" to it.first, "token" to it.second) })
      }.start()
    }
  }
}
