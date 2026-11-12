package ai.biber.vendorpush

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** One phone maker's push service. Implementations are found by name, so a missing SDK is fine. */
internal interface VendorChannel {
  val provider: String

  fun isSupported(context: Context): Boolean

  /** Blocks (never on the main thread) until the maker issues a token; null if it does not. */
  fun token(context: Context): String?
}

internal object VendorChannels {
  /** Which channels to try for a manufacturer, in order. Older Honor phones still run Huawei's. */
  private fun channelsFor(manufacturer: String): List<String> =
    when (manufacturer) {
      "huawei" -> listOf("HuaweiChannel")
      "honor" -> listOf("HonorChannel", "HuaweiChannel")
      "xiaomi", "redmi", "poco" -> listOf("XiaomiChannel")
      "oppo", "oneplus", "realme" -> listOf("OppoChannel")
      "vivo", "iqoo" -> listOf("VivoChannel")
      else -> emptyList()
    }

  private fun load(name: String): VendorChannel? =
    runCatching {
      Class.forName("ai.biber.vendorpush.$name").getDeclaredConstructor().newInstance()
        as VendorChannel
    }.getOrNull()

  fun register(context: Context): Pair<String, String>? {
    for (name in channelsFor(Build.MANUFACTURER.lowercase())) {
      val channel = load(name) ?: continue
      if (!runCatching { channel.isSupported(context) }.getOrDefault(false)) continue
      val token = runCatching { channel.token(context) }.getOrNull()
      if (!token.isNullOrEmpty()) return channel.provider to token
    }
    return null
  }
}

/**
 * Makers hand tokens back through callbacks, services or broadcast receivers. A registration
 * waits here for whichever of them answers first.
 */
internal object TokenRelay {
  private const val TIMEOUT_MS = 15_000L

  private val waiting = ConcurrentHashMap<String, Pair<CountDownLatch, AtomicReference<String?>>>()

  fun await(provider: String, start: () -> Unit): String? {
    val latch = CountDownLatch(1)
    val token = AtomicReference<String?>()
    waiting[provider] = latch to token
    try {
      start()
      latch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
      return token.get()
    } finally {
      waiting.remove(provider)
    }
  }

  fun deliver(provider: String, token: String?) {
    waiting[provider]?.let { (latch, slot) ->
      slot.set(token)
      latch.countDown()
    }
  }
}

/**
 * A value the build put in the app's manifest. Ours carry a `biber:` prefix, because Android
 * reads digit-only values as numbers and long app ids lose digits that way.
 */
internal fun manifestValue(context: Context, name: String): String? {
  val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
  return info.metaData?.get(name)?.toString()?.removePrefix("biber:")?.takeIf { it.isNotEmpty() }
}
