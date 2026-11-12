package ai.biber.vendorpush

import android.content.Context
import com.hihonor.push.sdk.HonorMessageService
import com.hihonor.push.sdk.HonorPushCallback
import com.hihonor.push.sdk.HonorPushClient

/** Honor Push, on Honor phones made after Honor left Huawei. */
internal class HonorChannel : VendorChannel {
  override val provider = "honor"

  override fun isSupported(context: Context) =
    HonorPushClient.getInstance().checkSupportHonorPush(context)

  override fun token(context: Context): String? =
    TokenRelay.await(provider) {
      HonorPushClient.getInstance().init(context, false)
      HonorPushClient.getInstance().getPushToken(
        object : HonorPushCallback<String> {
          override fun onSuccess(token: String?) = TokenRelay.deliver(provider, token)

          override fun onFailure(code: Int, message: String?) = TokenRelay.deliver(provider, null)
        },
      )
    }
}

class BiberHonorMessageService : HonorMessageService() {
  override fun onNewToken(token: String?) {
    if (!token.isNullOrEmpty()) TokenRelay.deliver("honor", token)
  }
}
