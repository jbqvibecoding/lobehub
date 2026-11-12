package ai.biber.vendorpush

import android.content.Context
import com.heytap.msp.push.HeytapPushManager
import com.heytap.msp.push.callback.ICallBackResultService

/**
 * OPPO Push (HeyTap), on OPPO, OnePlus and realme phones. Compiled only when the SDK is in libs/;
 * written against OPPO Push SDK 3.5, whose callbacks carry the package names.
 */
internal class OppoChannel : VendorChannel {
  override val provider = "oppo"

  override fun isSupported(context: Context): Boolean {
    HeytapPushManager.init(context, false)
    return HeytapPushManager.isSupportPush(context)
  }

  override fun token(context: Context): String? {
    val appKey = manifestValue(context, "ai.biber.push.oppo.app_key") ?: return null
    val appSecret = manifestValue(context, "ai.biber.push.oppo.app_secret") ?: return null
    return TokenRelay.await(provider) {
      HeytapPushManager.register(
        context,
        appKey,
        appSecret,
        object : ICallBackResultService {
          override fun onRegister(code: Int, registerId: String?, packageName: String?, miniPackageName: String?) =
            TokenRelay.deliver(provider, if (code == 0) registerId else null)

          override fun onUnRegister(code: Int, packageName: String?, miniPackageName: String?) {}

          override fun onSetPushTime(code: Int, pushTime: String?) {}

          override fun onGetPushStatus(code: Int, status: Int) {}

          override fun onGetNotificationStatus(code: Int, status: Int) {}

          override fun onError(code: Int, message: String?, packageName: String?, miniPackageName: String?) =
            TokenRelay.deliver(provider, null)
        },
      )
    }
  }
}
