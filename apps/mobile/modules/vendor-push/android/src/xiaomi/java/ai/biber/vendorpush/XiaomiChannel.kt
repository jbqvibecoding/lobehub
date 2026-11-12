package ai.biber.vendorpush

import android.content.Context
import com.xiaomi.mipush.sdk.MiPushClient
import com.xiaomi.mipush.sdk.MiPushCommandMessage
import com.xiaomi.mipush.sdk.PushMessageReceiver

/** Xiaomi Push, on Xiaomi, Redmi and POCO phones. Compiled only when the SDK is in libs/. */
internal class XiaomiChannel : VendorChannel {
  override val provider = "xiaomi"

  override fun isSupported(context: Context) = MiPushClient.shouldUseMIUIPush(context)

  override fun token(context: Context): String? {
    MiPushClient.getRegId(context)?.takeIf { it.isNotEmpty() }?.let { return it }
    val appId = manifestValue(context, "ai.biber.push.xiaomi.app_id") ?: return null
    val appKey = manifestValue(context, "ai.biber.push.xiaomi.app_key") ?: return null
    return TokenRelay.await(provider) { MiPushClient.registerPush(context, appId, appKey) }
  }
}

/** Xiaomi reports the registration result by broadcast; the build declares this receiver. */
class XiaomiReceiver : PushMessageReceiver() {
  override fun onReceiveRegisterResult(context: Context, message: MiPushCommandMessage) {
    if (message.command != MiPushClient.COMMAND_REGISTER) return
    val token = if (message.resultCode == 0L) message.commandArguments?.firstOrNull() else null
    TokenRelay.deliver("xiaomi", token)
  }
}
