package ai.biber.vendorpush

import android.content.Context
import com.huawei.hms.aaid.HmsInstanceId
import com.huawei.hms.api.ConnectionResult
import com.huawei.hms.api.HuaweiApiAvailability
import com.huawei.hms.push.HmsMessageService

/** Huawei Push Kit, on phones with Huawei Mobile Services. */
internal class HuaweiChannel : VendorChannel {
  override val provider = "huawei"

  override fun isSupported(context: Context) =
    HuaweiApiAvailability.getInstance().isHuaweiMobileServicesAvailable(context) ==
      ConnectionResult.SUCCESS

  override fun token(context: Context): String? {
    val appId = manifestValue(context, "com.huawei.hms.client.appid")?.removePrefix("appid=")
      ?: return null
    return TokenRelay.await(provider) {
      // Recent HMS versions answer here; older ones send the token to the service below
      val token = HmsInstanceId.getInstance(context).getToken(appId, "HCM")
      if (!token.isNullOrEmpty()) TokenRelay.deliver(provider, token)
    }
  }
}

class BiberHmsMessageService : HmsMessageService() {
  override fun onNewToken(token: String?) {
    if (!token.isNullOrEmpty()) TokenRelay.deliver("huawei", token)
  }
}
