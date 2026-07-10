package com.example.pumpmonitor.i18n

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * In-app language selection, persisted in SharedPreferences and applied by
 * wrapping the Activity context in [wrap] (see MainActivity.attachBaseContext).
 * Changing the language requires an Activity.recreate().
 */
object LocalePrefs {

    private const val PREFS = "app_locale"
    private const val KEY_LANG = "lang"

    /** Language tag -> display name in its own script. Empty tag = follow system. */
    val SUPPORTED = listOf(
        "en" to "English",
        "hi" to "हिन्दी",
        "kn" to "ಕನ್ನಡ",
        "mr" to "मराठी",
        "ta" to "தமிழ்",
        "te" to "తెలుగు",
    )

    fun get(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LANG, "") ?: ""

    fun set(context: Context, lang: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LANG, lang).apply()
    }

    fun wrap(base: Context): Context {
        val lang = get(base)
        if (lang.isEmpty()) return base
        val locale = Locale(lang)
        Locale.setDefault(locale)
        val config = Configuration(base.resources.configuration)
        config.setLocale(locale)
        return base.createConfigurationContext(config)
    }
}
