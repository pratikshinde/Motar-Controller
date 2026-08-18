package com.example.pumpmonitor.ui

import android.Manifest
import android.content.Context
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
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

                // Reflects TokenStore.hasSession synchronously at ViewModel
                // construction — a resumed session skips straight past login,
                // a cold/logged-out install starts there. No demo shortcut.
                val startDestination = remember { if (authVm.signedIn.value) "pump" else "login" }

                NavHost(navController = nav, startDestination = startDestination) {
                    composable("login") {
                        LoginScreen(authVm) {
                            nav.navigate("pump") { popUpTo("login") { inclusive = true } }
                        }
                    }
                    composable("pumps") {
                        PumpsScreen(
                            vm,
                            onOpenPump = { pump ->
                                vm.selectPump(pump.id)
                                nav.navigate("pump")
                            },
                            onSignOut = { signOut(vm, authVm, nav) },
                        )
                    }
                    composable("pump") {
                        PumpSection(vm, nav, onSignOut = { signOut(vm, authVm, nav) })
                    }
                }
            }
        }
    }

    private fun signOut(vm: PumpViewModel, authVm: AuthViewModel, nav: NavHostController) {
        vm.closePump()
        authVm.signOut()
        nav.navigate("login") { popUpTo(0) }
    }
}

/** The per-pump area: Monitor / History / Alerts tabs for the selected pump. */
@Composable
private fun PumpSection(vm: PumpViewModel, nav: NavHostController, onSignOut: () -> Unit) {
    val pumps by vm.pumps.collectAsState()
    val loading by vm.pumpsLoading.collectAsState()
    val selectedPump by vm.selectedPump.collectAsState()

    // >5-pump accounts need the searchable list first (plan §3.2); everyone
    // else is auto-selected by PumpViewModel.refreshPumps() already.
    LaunchedEffect(pumps, selectedPump) {
        if (selectedPump == null && pumps.size > 5) {
            nav.navigate("pumps") { popUpTo("pump") { inclusive = false } }
        }
    }

    if (selectedPump == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (loading || pumps.size > 5) {
                CircularProgressIndicator(color = Neon.Cyan)
            } else {
                Text(stringResource(R.string.pumps_empty), color = Neon.TextMuted)
            }
        }
        return
    }

    val tabsNav = rememberNavController()
    val tabs = listOf(
        Tab("dashboard", R.string.tab_monitor, Icons.Filled.Dashboard),
        Tab("history", R.string.tab_history, Icons.Filled.History),
        Tab("alerts", R.string.tab_alerts, Icons.Filled.Notifications),
    )

    Scaffold(
        containerColor = Neon.Background,
        bottomBar = {
            NavigationBar(containerColor = Neon.Card) {
                val backStack by tabsNav.currentBackStackEntryAsState()
                val current = backStack?.destination?.route
                tabs.forEach { tab ->
                    NavigationBarItem(
                        selected = current == tab.route,
                        onClick = {
                            tabsNav.navigate(tab.route) {
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
            navController = tabsNav,
            startDestination = "dashboard",
            modifier = Modifier.padding(padding),
        ) {
            composable("dashboard") { DashboardScreen(vm, onSignOut = onSignOut) }
            composable("history") { HistoryScreen(vm) }
            composable("alerts") { AlertsScreen(vm) }
        }
    }
}
