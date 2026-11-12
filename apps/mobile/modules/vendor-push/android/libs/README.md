# Phone makers' push SDKs

Xiaomi, OPPO and vivo distribute their Android push SDKs as downloads from their developer
consoles. Put each file here; the module compiles that maker's channel only when its file is
present, so a build without one simply cannot register with that maker.

| Maker                       | Download                          | File name must match                     |
| --------------------------- | --------------------------------- | ---------------------------------------- |
| Xiaomi                      | Xiaomi Push console, Android SDK  | `*MiPush*.aar`                           |
| OPPO (also OnePlus, realme) | OPPO Open Platform, Push SDK      | `*heytap*.aar` or `*com.heytap.msp*.aar` |
| vivo (also iQOO)            | vivo Developer Platform, Push SDK | `*vivo*push*.aar`                        |

Huawei and Honor need nothing here: their SDKs come from their Maven repositories.

OPPO's SDK also needs `com.google.code.gson:gson` and `commons-codec:commons-codec` if the app
does not already have them.
