package com.example.pumpmonitor.ui

import android.Manifest
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.example.pumpmonitor.R
import com.example.pumpmonitor.i18n.LocalePrefs
import com.example.pumpmonitor.ui.alerts.AlertsScreen
import com.example.pumpmonitor.ui.dashboard.DashboardScreen
import com.example.pumpmonitor.ui.history.HistoryScreen
import com.example.pumpmonitor.ui.login.AuthViewModel
import com.example.pumpmonitor.ui.login.LoginScreen
import com.example.pumpmonitor.ui.pumps.PumpsScreen
import com.example.pumpmonitor.ui.theme.Neon
import com.example.pumpmonitor.ui.theme.PumpTheme

private data class Tab(val route: String, val labelRes: Int, val icon: ImageVector)

class MainActivity : ComponentActivity() {

    private val notifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(LocalePrefs.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        setContent {
            PumpTheme {
                val nav = rememberNavController()
                val vm: PumpViewModel = viewModel()
                val authVm: AuthViewModel = viewModel()

                NavHost(
                    navController = nav,
                    startDestination = "pump", // Directly open DashboardScreen on app launch!
                ) {
                    composable("login") {
                        LoginScreen(authVm) {
                            nav.navigate("pump") { popUpTo("login") { inclusive = true } }
                        }
                    }
                    composable("pumps") {
                        PumpsScreen(
                            vm, authVm,
                            onOpenPump = { pump ->
                                vm.selectPump(pump)
                                nav.navigate("pump")
                            },
                            onSignOut = {
                                vm.closePump()
                                authVm.signOut()
                                nav.navigate("login") { popUpTo(0) }
                            },
                        )
                    }
                    composable("pump") {
                        PumpSection(vm, onBack = {
                            nav.popBackStack()
                        })
                    }
                }
            }
        }
    }
}

/** The per-pump area: Monitor / History / Alerts tabs for the selected pump. */
@Composable
private fun PumpSection(vm: PumpViewModel, onBack: () -> Unit) {
    val pump by vm.selectedPump.collectAsState()
    if (pump == null) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    BackHandler(onBack = onBack)

    val nav = rememberNavController()
    val tabs = listOf(
        Tab("dashboard", R.string.tab_monitor, Icons.Filled.Dashboard),
        Tab("history", R.string.tab_history, Icons.Filled.History),
        Tab("alerts", R.string.tab_alerts, Icons.Filled.Notifications),
    )

    Scaffold(
        containerColor = Neon.Background,
        bottomBar = {
            NavigationBar(containerColor = Neon.Card) {
                val backStack by nav.currentBackStackEntryAsState()
                val current = backStack?.destination?.route
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = current == tab.route,
                        onClick = {
                            nav.navigate(tab.route) {
                                popUpTo("dashboard"); launchSingleTop = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = stringResource(tab.labelRes)) },
                        label = { Text(stringResource(tab.labelRes)) },
                    )
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = nav,
            startDestination = "dashboard",
            modifier = Modifier.padding(padding),
        ) {
            composable("dashboard") { DashboardScreen(vm, onBack = onBack) }
            composable("history") { HistoryScreen(vm) }
            composable("alerts") { AlertsScreen(vm) }
        }
    }
}
