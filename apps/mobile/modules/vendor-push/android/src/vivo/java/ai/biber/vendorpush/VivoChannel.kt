package ai.biber.vendorpush

import android.content.Context
import com.vivo.push.PushClient
import com.vivo.push.PushConfig
import com.vivo.push.listener.IPushQueryActionListener

/**
 * vivo Push, on vivo and iQOO phones. Compiled only when the SDK is in libs/. The SDK reads the
 * app id and API key from the manifest itself. The app registers only after sign-in, by which time
 * the user has accepted the privacy policy that the SDK asks about.
 */
internal class VivoChannel : VendorChannel {
  override val provider = "vivo"

  private fun client(context: Context) =
    PushClient.getInstance(context).also {
      it.initialize(PushConfig.Builder().agreePrivacyStatement(true).build())
    }

  override fun isSupported(context: Context) = client(context).isSupport

  override fun token(context: Context): String? =
    TokenRelay.await(provider) {
      val client = client(context)
      client.turnOnPush { state ->
        if (state != 0) {
          TokenRelay.deliver(provider, null)
          return@turnOnPush
        }
        client.getRegId(
          object : IPushQueryActionListener {
            override fun onSuccess(regId: String?) = TokenRelay.deliver(provider, regId)

            override fun onFail(code: Int?) = TokenRelay.deliver(provider, null)
          },
        )
      }
    }
}
