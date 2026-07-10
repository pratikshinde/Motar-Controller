package com.example.pumpmonitor.ui.common

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.example.pumpmonitor.R
import com.example.pumpmonitor.i18n.LocalePrefs
import com.example.pumpmonitor.ui.theme.Neon

/** Unwraps Compose's LocalContext to the hosting Activity. */
fun Context.findActivity(): Activity? {
    var ctx = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

/** Language picker — persists the choice and recreates the Activity to apply it. */
@Composable
fun LanguageDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val current = LocalePrefs.get(context).ifEmpty { "en" }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Neon.Card,
        titleContentColor = Neon.TextPrimary,
        textContentColor = Neon.TextPrimary,
        title = { Text(stringResource(R.string.language_choose)) },
        text = {
            Column {
                LocalePrefs.SUPPORTED.forEach { (tag, name) ->
                    val pick = {
                        LocalePrefs.set(context, tag)
                        onDismiss()
                        context.findActivity()?.recreate()
                        Unit
                    }
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable(onClick = pick)
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = current == tag, onClick = pick)
                        Text(name)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}
